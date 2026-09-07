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

// Qué pasó en un intento de subida.
//
// `empty` no es un error: no había nada que mandar. Distinguirlo de `ok`
// importa para el botón de Soporte — decirle "listo, enviado" a alguien que
// no tenía nada pendiente es mentirle.
export type UploadOutcome =
  | { readonly status: 'ok'; readonly sent: number }
  | { readonly status: 'partial'; readonly sent: number; readonly pending: number }
  | { readonly status: 'empty' }
  | { readonly status: 'busy' };

@Injectable({ providedIn: 'root' })
export class AuditLogUploadDispatcherService {
  private readonly http = inject(HttpClient);
  private readonly store = inject(AuditLogStore);
  private readonly slugStore = inject(SlugStore);

  // Sella lo pendiente y sube todo lo que haya en cola. Es el único punto de
  // entrada: lo llaman el scheduler periódico, el flush al cerrar la app y el
  // botón de Soporte.
  //
  // Devuelve qué pasó en vez de tragarse todo en silencio: el scheduler
  // ignora el resultado, pero el botón de Soporte necesita poder decirle al
  // alumno si su paquete llegó o no. Aun así NUNCA lanza — un fallo de
  // telemetría no puede romper la app.
  async uploadPending(): Promise<UploadOutcome> {
    if (typeof navigator === 'undefined' || !('locks' in navigator)) {
      // Sin Web Locks API (navegador viejo): corre sin coordinación —
      // best-effort, y el dedup por batchId del back sigue cubriendo el
      // duplicado.
      return this.runLocked();
    }

    const outcome = await navigator.locks.request(
      UPLOAD_LOCK_NAME,
      { ifAvailable: true },
      async (lock) => {
        if (!lock) return { status: 'busy' } as const; // otra pestaña ya está subiendo.
        return this.runLocked();
      },
    );
    return outcome ?? { status: 'busy' };
  }

  private async runLocked(): Promise<UploadOutcome> {
    try {
      await this.sealPending();
      return await this.drainPending();
    } catch {
      // Nunca romper la app por telemetría. Lo que no se pudo sellar o subir
      // queda en IDB para el próximo intento.
      const pending = (await this.store.pendingPackages()).length;
      return pending === 0 ? { status: 'empty' } : { status: 'partial', sent: 0, pending };
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
  private async drainPending(): Promise<UploadOutcome> {
    const packages = await this.store.pendingPackages();
    if (packages.length === 0) return { status: 'empty' };

    const slug = this.slugStore.current();
    // Sin identity activa no se puede armar la URL tenant-scoped. No es un
    // fallo del paquete: queda esperando a que haya sesión.
    if (!slug) return { status: 'partial', sent: 0, pending: packages.length };

    let sent = 0;
    let index = 0;

    for (const pkg of packages) {
      index++;
      try {
        await this.post(slug, pkg);
        // Solo acá se borra: el 2xx es la confirmación de que el back se
        // hizo cargo.
        await this.store.deletePackage(pkg.batchId);
        sent++;
      } catch (err) {
        if (isPermanentRejection(err)) {
          // El back no va a aceptar estos bytes nunca. Se descarta para no
          // trabar la cola ni hacer crecer el IndexedDB — pero NO cuenta
          // como enviado.
          await this.store.deletePackage(pkg.batchId);
          continue;
        }
        // Fallo transitorio (sin red, 5xx, 401/403/404): no seguimos con el
        // resto — si este no salió, los que siguen tampoco.
        return { status: 'partial', sent, pending: packages.length - index + 1 };
      }
    }

    const pending = (await this.store.pendingPackages()).length;
    return pending === 0 ? { status: 'ok', sent } : { status: 'partial', sent, pending };
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

// Se descarta un paquete SOLO cuando el problema es el paquete mismo:
// reenviar exactamente los mismos bytes no puede dar otro resultado.
//
// Todo lo demás se conserva, incluidos 401/403/404. La tentación es tratar
// cualquier 4xx como definitivo, pero esos tres hablan del estado del
// sistema, no del payload, y ese estado cambia: un 403 puede ser una
// migración de permisos que todavía no se aplicó, y un 404 de alumno no
// vinculado se arregla cuando lo vinculan. Descartarlos tiraría a la basura
// justo los logs del período en que algo estaba mal configurado — que es
// cuando más falta hacen. Lo retenido está acotado por el techo de 7 días,
// así que conservarlos no puede crecer sin control.
const PAYLOAD_REJECTED_STATUSES = new Set([
  400, // body inválido según el contrato
  413, // demasiado grande para el server
  422, // semánticamente inaceptable
]);

function isPermanentRejection(err: unknown): boolean {
  if (!(err instanceof HttpErrorResponse)) return false;
  return PAYLOAD_REJECTED_STATUSES.has(err.status);
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
