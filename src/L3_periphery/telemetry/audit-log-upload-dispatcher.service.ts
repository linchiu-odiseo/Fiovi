import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { timeout } from 'rxjs/operators';
import { serializeBatchedNdjson } from './audit-log-serializer';
import { AuditLogStore, type AuditLogPackage } from './audit-log-store.service';
import { ENDPOINT_ID_TOKEN } from './tokens';
import { ENDPOINT_IDS } from './audit-log-dictionaries';
import { apiPath } from '../http/api-paths';
import { SlugStore } from '../http/slug-store';
import { environment } from '../../environments/environment';

// Nombre del lock de Web Locks API — coordina la subida entre pestañas del
// mismo origen (PWA instalada + navegador abierto es un caso realista) Y entre
// invocaciones concurrentes en la misma pestaña. Sin esto, dos llamadas
// pueden leer la misma lista de paquetes pendientes y subir cada una por su
// cuenta; el dedup del back por batchId lo cubre, pero es tráfico al pedo.
// `ifAvailable: true` = si ya hay una subida en curso, esta invocación no
// espera ni reintenta.
const UPLOAD_LOCK_NAME = 'fiovi-audit-log-upload';

// Tope del body HTTP por paquete.
//
// 48KB y no 100kb (el default del body parser de Express) porque
// `fetch(..., {keepalive: true})` — la única forma de que un POST sobreviva
// al cierre de la pestaña — tiene un tope de 64KB por spec. Con un solo
// número por debajo de los dos, el mismo paquete sirve para las dos vías de
// envío sin lógica partida.
//
// Es una válvula de seguridad, no el camino normal: los envíos los dispara el
// reloj, no el tamaño. Un día de logs con el formato compacto entra holgado.
const MAX_PACKAGE_BYTES = 48 * 1024;

@Injectable({ providedIn: 'root' })
export class AuditLogUploadDispatcherService {
  private readonly http = inject(HttpClient);
  private readonly store = inject(AuditLogStore);
  private readonly slugStore = inject(SlugStore);

  // Sella lo pendiente y sube todo lo que haya en cola. Es el único punto de
  // entrada: lo llaman el scheduler periódico, el flush al cerrar la app y el
  // botón de Soporte.
  async uploadPending(): Promise<void> {
    if (typeof navigator === 'undefined' || !('locks' in navigator)) {
      // Sin Web Locks API (navegador viejo): corre sin coordinación —
      // best-effort, y el dedup por batchId del back sigue cubriendo el
      // duplicado.
      await this.runLocked();
      return;
    }

    await navigator.locks.request(UPLOAD_LOCK_NAME, { ifAvailable: true }, async (lock) => {
      if (!lock) return; // otra pestaña ya está subiendo.
      await this.runLocked();
    });
  }

  private async runLocked(): Promise<void> {
    try {
      await this.sealPending();
      await this.drainPending();
    } catch {
      // Best-effort: nunca romper la app por telemetría. Lo que no se pudo
      // sellar o subir queda en IDB para el próximo intento.
    }
  }

  // Convierte los eventos sueltos en paquetes sellados, partiendo en varios
  // si no entran en MAX_PACKAGE_BYTES.
  async sealPending(): Promise<void> {
    let remaining = await this.store.pendingEvents();

    while (remaining.length > 0) {
      const take = await this.largestFittingPrefix(remaining);
      const chunk = remaining.slice(0, take);
      const built = await this.buildPayload(chunk.map((it) => it.event));

      await this.store.sealPackage(
        {
          batchId: crypto.randomUUID(),
          payload: built.payload,
          enc: built.enc,
          eventCount: chunk.length,
          sealedAt: Date.now(),
        },
        chunk.map((it) => it.key),
      );

      remaining = remaining.slice(take);
    }
  }

  // Cuántos eventos del principio entran en un paquete. Se mide sobre el body
  // final (ya comprimido y en base64), porque el ratio de compresión varía y
  // no se sabe hasta comprimir. Va partiendo al medio: O(log n) compresiones
  // en el peor caso, y en el caso normal una sola, porque entra todo.
  private async largestFittingPrefix(
    items: readonly { key: IDBValidKey; event: unknown }[],
  ): Promise<number> {
    let take = items.length;
    while (take > 1) {
      const built = await this.buildPayload(items.slice(0, take).map((it) => it.event));
      if (bodySizeOf(built.payload) <= MAX_PACKAGE_BYTES) return take;
      take = Math.floor(take / 2);
    }
    // Un solo evento que no entra es patológico (un `chg` gigantesco, un
    // bug). Se sella igual: si el back lo rechaza con 4xx, `drainPending` lo
    // descarta en vez de reintentarlo para siempre.
    return 1;
  }

  private async buildPayload(
    events: readonly unknown[],
  ): Promise<{ payload: string; enc: 'gzip' | 'none' }> {
    const ndjson = serializeBatchedNdjson(events as never);
    // Safari < 16.4 no tiene CompressionStream. Antes esto tiraba un
    // ReferenceError que moría en un catch silencioso: la subida fallaba para
    // siempre en esos equipos sin que nadie se enterara. Ahora se manda el
    // NDJSON crudo con `enc: 'none'` y comprime el back.
    if (typeof CompressionStream === 'undefined') {
      return { payload: textToBase64(ndjson), enc: 'none' };
    }
    return { payload: await gzipToBase64(ndjson), enc: 'gzip' };
  }

  // Sube los paquetes en orden, del más viejo al más nuevo.
  private async drainPending(): Promise<void> {
    const slug = this.slugStore.current();
    if (!slug) return; // Sin identity activa — nada que subir todavía.

    for (const pkg of await this.store.pendingPackages()) {
      try {
        await this.post(slug, pkg);
        // Solo acá se borra: el 2xx es la confirmación de que el back se
        // hizo cargo.
        await this.store.deletePackage(pkg.batchId);
      } catch (err) {
        if (isPermanentRejection(err)) {
          // Un 4xx no se arregla reintentando: el alumno no está vinculado,
          // el payload es inválido o es demasiado grande. Reintentarlo para
          // siempre dejaría la cola trabada y el IndexedDB creciendo.
          await this.store.deletePackage(pkg.batchId);
          continue;
        }
        // Fallo transitorio (sin red, 5xx, 429): no seguimos con el resto —
        // si este no salió, los que siguen tampoco. Quedan para el próximo
        // intento.
        return;
      }
    }
  }

  private async post(slug: string, pkg: AuditLogPackage): Promise<void> {
    await firstValueFrom(
      this.http
        .post<void>(
          apiPath.auditLogBatch(slug),
          {
            batchId: pkg.batchId,
            payload: pkg.payload,
            enc: pkg.enc,
            eventCount: pkg.eventCount,
            appVersion: environment.appVersion,
          },
          { context: new HttpContext().set(ENDPOINT_ID_TOKEN, ENDPOINT_IDS.auditLogBatch) },
        )
        .pipe(timeout(15_000)),
    );
  }
}

// Un 4xx significa que el back entendió el pedido y lo rechazó — reintentarlo
// idéntico no puede cambiar el resultado. Las dos excepciones son 408
// (timeout) y 429 (rate limit), que sí piden esperar y volver.
function isPermanentRejection(err: unknown): boolean {
  if (!(err instanceof HttpErrorResponse)) return false;
  if (err.status === 408 || err.status === 429) return false;
  return err.status >= 400 && err.status < 500;
}

// El body real es el JSON entero, no solo el payload; los otros campos suman
// poco pero medirlos es gratis y evita quedar justo en el límite.
function bodySizeOf(payload: string): number {
  const ENVELOPE_OVERHEAD = 200;
  return payload.length + ENVELOPE_OVERHEAD;
}

// gzip(text) → base64. CompressionStream('gzip') es nativo del navegador, no
// hay librería.
//
// El stream se drena con un reader en vez de `new Response(cs.readable)`:
// envolver un stream de compresión en un Response mezcla dos
// implementaciones de streams cuando el entorno no es un navegador de
// verdad (jsdom en los tests) y se cuelga sin error. El reader es la vía
// directa y no depende de la Fetch API.
async function gzipToBase64(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const cs = new CompressionStream('gzip');

  const writer = cs.writable.getWriter();
  void writer.write(bytes);
  void writer.close();

  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
    }
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return bytesToBase64(merged);
}

function textToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

// Chunking manual para no pegarle un array gigante a
// String.fromCharCode(...bytes) (límite práctico de argumentos por call
// stack) — el payload es de pocos KB, pero es gratis hacerlo robusto.
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
