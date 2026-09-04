import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { timeout } from 'rxjs/operators';
import { AuditLogSerializer } from './audit-log-serializer';
import { AuditLogStore } from './audit-log-store.service';
import { startOfTodayLocalMs } from './day-key';
import { ENDPOINT_ID_TOKEN } from './tokens';
import { ENDPOINT_IDS } from './audit-log-dictionaries';
import { apiPath } from '../http/api-paths';
import { SlugStore } from '../http/slug-store';
import { environment } from '../../environments/environment';

// Nombre del lock de Web Locks API — coordina el upload entre pestañas del
// mismo origen (PWA instalada + navegador abierto es un caso realista) Y
// entre ticks del propio setInterval si uno tarda más que el intervalo
// (reentrancia intra-tab). Sin esto, dos llamadas concurrentes pueden leer
// el mismo cursor, armar slices con ventana solapada, y subir los mismos
// eventos dos veces bajo batchId distintos (el dedup server-side por
// batchId no lo detecta). `ifAvailable: true` = si ya hay un upload en
// curso, esta invocación no espera ni reintenta — el próximo intervalo
// vuelve a intentar con el cursor que haya quedado.
const UPLOAD_LOCK_NAME = 'fiovi-audit-log-upload';

// AuditLogUploadDispatcher — Fase 1 del audit-log: sube periódicamente al
// back los eventos capturados localmente (Fase 0), vía el puente
// serializeSlice/clearRange (design.md § Fase 1 Bridge, design Revision Log
// Cambio 5).
//
// Primer caso en el repo de un servicio L3 puro que llama HttpClient directo
// SIN implementar un puerto L1: es infra de telemetría, no un adapter de
// dominio (no hay use case L2 que orqueste "subir logs"). Decisión deliberada
// — no inventar un puerto L1 con un solo consumidor.
//
// Fire-and-forget con la misma filosofía del resto del audit-log: un fallo
// de red NUNCA rompe la app ni pierde datos. Si el POST falla, el cursor NO
// avanza y el próximo intervalo reintenta la MISMA ventana — at-least-once
// del lado cliente. El back deduplica por `batchId` (ULID/UUID por slice).
//
// El cursor vive en localStorage (no en IndexedDB): mantiene el contrato de
// AuditLogStore sin tocar, y no necesita sobrevivir un wipe del store.
const CURSOR_KEY = 'fiovi-audit-log-last-upload-ms';

// Ventana mínima antes de intentar un upload — evita POSTs vacíos si el
// intervalo dispara más seguido que el ritmo real de eventos.
const MIN_WINDOW_MS = 30_000;

@Injectable({ providedIn: 'root' })
export class AuditLogUploadDispatcherService {
  private readonly http = inject(HttpClient);
  private readonly serializer = inject(AuditLogSerializer);
  private readonly store = inject(AuditLogStore);
  private readonly slugStore = inject(SlugStore);

  async uploadPending(): Promise<void> {
    if (typeof navigator === 'undefined' || !('locks' in navigator)) {
      // Sin Web Locks API disponible (navegador viejo): corré sin
      // coordinación — best-effort, mismo riesgo de duplicado que antes,
      // pero no rompe nada (el dedup por batchId sigue siendo defensa
      // parcial del lado server).
      await this.uploadPendingLocked();
      return;
    }

    await navigator.locks.request(UPLOAD_LOCK_NAME, { ifAvailable: true }, async (lock) => {
      if (!lock) return; // otra pestaña/tick ya está subiendo — no reintentamos ahora.
      await this.uploadPendingLocked();
    });
  }

  private async uploadPendingLocked(): Promise<void> {
    try {
      const slug = this.slugStore.current();
      if (!slug) return; // Sin identity activa — nada que subir todavía.

      const sinceMs = this.readCursor();
      const untilMs = Date.now();
      if (untilMs - sinceMs < MIN_WINDOW_MS) return;

      const { payload, batchId, eventCount, appVersion } = await this.buildSlice(sinceMs, untilMs);

      if (eventCount === 0) {
        // Nada que subir en esta ventana — no tiene sentido re-escanearla
        // en el próximo intervalo.
        this.writeCursor(untilMs);
        return;
      }

      const payloadGz = await gzipToBase64(payload);
      await firstValueFrom(
        this.http
          .post<void>(
            apiPath.auditLogBatch(slug),
            { batchId, payload: payloadGz, eventCount, appVersion },
            { context: new HttpContext().set(ENDPOINT_ID_TOKEN, ENDPOINT_IDS.auditLogBatch) },
          )
          .pipe(timeout(15_000)),
      );

      // Éxito: solo acá se confirma la ventana — limpiar IDB y avanzar el
      // cursor. Un fallo del POST no llega a este punto (throw antes).
      await this.store.clearRange(sinceMs, untilMs);
      this.writeCursor(untilMs);
    } catch {
      // Best-effort: el próximo intervalo reintenta la misma ventana
      // (cursor sin avanzar). Nunca romper la app por esto.
    }
  }

  private async buildSlice(
    sinceMs: number,
    untilMs: number,
  ): Promise<{ payload: string; batchId: string; eventCount: number; appVersion: string }> {
    const slice = await this.serializer.serializeSlice(sinceMs, untilMs);
    return { ...slice, appVersion: environment.appVersion };
  }

  private readCursor(): number {
    try {
      const raw = localStorage.getItem(CURSOR_KEY);
      const parsed = raw !== null ? Number(raw) : NaN;
      // Cursor en el futuro (reloj del dispositivo retrocedido, o valor
      // corrupto previo) queda atascado para siempre sin este chequeo:
      // untilMs - sinceMs nunca supera MIN_WINDOW_MS. Fallback al mismo
      // default que "sin cursor".
      if (!Number.isFinite(parsed) || parsed > Date.now()) return startOfTodayLocalMs();
      return parsed;
    } catch {
      return startOfTodayLocalMs();
    }
  }

  private writeCursor(ms: number): void {
    try {
      localStorage.setItem(CURSOR_KEY, String(ms));
    } catch {
      // Best-effort — si localStorage falla (privado, cuota), el próximo
      // intervalo simplemente vuelve a arrancar desde startOfTodayLocalMs.
    }
  }
}

// gzip(payload) → base64. CompressionStream('gzip') es nativo del navegador,
// no hay librería. Chunking manual en la conversión a base64 para no pegarle
// un array gigante a String.fromCharCode(...bytes) (límite práctico de
// argumentos por call stack) — el payload es de pocos KB, pero es gratis
// hacerlo robusto.
async function gzipToBase64(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  void writer.write(bytes);
  void writer.close();

  const compressed = await new Response(cs.readable).arrayBuffer();
  return bytesToBase64(new Uint8Array(compressed));
}

function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
