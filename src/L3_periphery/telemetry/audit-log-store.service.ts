import { Injectable } from '@angular/core';
import { AuditLogEvent } from './audit-log-event';
import { todayLocalKey } from './day-key';

// AuditLogStore — captura local de eventos audit-log (Fase 0).
//
// Retención = 1 día natural (00:00 local del dispositivo). La rotación
// ocurre INLINE en el primer `append` del día siguiente: sin scheduler
// dedicado, sin setInterval (design Decision 5).
//
// `append` es fire-and-forget async: el llamador no espera IDB, las
// excepciones (incluso QuotaExceededError) se cachan silenciosamente.
// La telemetría es best-effort por diseño (design Decision 8).
//
// Puente a Fase 1: `currentDayBatch()` y `clearDay()` son el API público
// que consumirá el futuro `AuditLogUploadDispatcher`. Ningún cambio al
// store cuando llegue Fase 1 (spec REQ-AL-06, design Puente).

const DB_NAME = 'fiovi-audit-log';
const DB_VERSION = 1;
const STORE_EVENTS = 'events';
const STORE_META = 'meta';
const META_DAY_KEY = 'dayKey';

@Injectable({ providedIn: 'root' })
export class AuditLogStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  // Fire-and-forget. No retorna Promise: el llamador (view-model, interceptor,
  // listener) no debe esperar IDB. Excepciones cachadas silenciosamente.
  append(event: AuditLogEvent): void {
    void this.doAppend(event).catch(() => {
      // Silenciamos QuotaExceededError, VersionError, y cualquier fallo de IDB.
      // La telemetría es best-effort por diseño — perder un evento no rompe la app.
    });
  }

  // Retorna todos los eventos del día actual en orden cronológico ascendente.
  // Idempotente y read-only: puede invocarse por múltiples consumidores (botón
  // de descarga HOY, upload dispatcher en Fase 1) sin consumir el batch.
  async currentDayBatch(): Promise<AuditLogEvent[]> {
    try {
      const db = await this.db();
      return await new Promise<AuditLogEvent[]>((resolve, reject) => {
        const tx = db.transaction(STORE_EVENTS, 'readonly');
        const store = tx.objectStore(STORE_EVENTS);
        const req = store.openCursor();
        const out: AuditLogEvent[] = [];
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) {
            resolve(out);
            return;
          }
          out.push(cursor.value as AuditLogEvent);
          cursor.continue();
        };
        req.onerror = () => reject(req.error ?? new Error('IDB cursor error'));
      });
    } catch {
      return [];
    }
  }

  // Borra todos los eventos del store. Si `dayKey` es provisto y difiere del
  // day-key actual almacenado en meta, es no-op (protege contra clears
  // cross-day accidentales de un consumidor futuro que confirma upload).
  // Sin argumento borra siempre (uso interno de rotación).
  async clearDay(dayKey?: string): Promise<void> {
    try {
      const db = await this.db();
      if (dayKey !== undefined) {
        const storedKey = await this.readMetaDayKey(db);
        if (storedKey !== null && storedKey !== dayKey) {
          return;
        }
      }
      await this.wipeEvents(db);
      await this.writeMetaDayKey(db, todayLocalKey());
    } catch {
      // Silencioso — no propagamos errores de IDB.
    }
  }

  // Puente a Fase 1 (Sub-bloque E, design.md Revision Log 2026-09-04):
  // borra solo los eventos cuyo `t` cae en [sinceMs, untilMs) -- half-open,
  // simetrico con AuditLogSerializer.serializeSlice. Usado por el futuro
  // AuditLogUploadDispatcher tras confirmar 2xx de un slice subido, sin
  // afectar eventos fuera de esa ventana (a diferencia de clearDay).
  async clearRange(sinceMs: number, untilMs: number): Promise<void> {
    try {
      const db = await this.db();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_EVENTS, 'readwrite');
        const store = tx.objectStore(STORE_EVENTS);
        const req = store.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return;
          const ev = cursor.value as AuditLogEvent;
          if (ev.t >= sinceMs && ev.t < untilMs) {
            cursor.delete();
          }
          cursor.continue();
        };
        req.onerror = () => reject(req.error ?? new Error('IDB cursor error'));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IDB clearRange error'));
        tx.onabort = () => reject(tx.error ?? new Error('IDB tx aborted'));
      });
    } catch {
      // Silencioso -- no propagamos errores de IDB.
    }
  }

  // --- privados ---

  private async doAppend(event: AuditLogEvent): Promise<void> {
    const db = await this.db();
    const currentKey = todayLocalKey();
    const storedKey = await this.readMetaDayKey(db);
    if (storedKey === null || storedKey !== currentKey) {
      // Rotación: día cambió (o primer append de la instalación).
      await this.wipeEvents(db);
      await this.writeMetaDayKey(db, currentKey);
    }
    await this.putEvent(db, event);
  }

  private async db(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    if (typeof indexedDB === 'undefined') {
      throw new Error('IndexedDB no está disponible');
    }
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_EVENTS)) {
          db.createObjectStore(STORE_EVENTS, { autoIncrement: true });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IDB open error'));
    });
    // No cachear el rechazo: reintentar en el próximo append.
    this.dbPromise.catch(() => {
      this.dbPromise = null;
    });
    return this.dbPromise;
  }

  private putEvent(db: IDBDatabase, event: AuditLogEvent): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_EVENTS, 'readwrite');
      const store = tx.objectStore(STORE_EVENTS);
      store.add(event);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IDB put error'));
      tx.onabort = () => reject(tx.error ?? new Error('IDB tx aborted'));
    });
  }

  private wipeEvents(db: IDBDatabase): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_EVENTS, 'readwrite');
      const store = tx.objectStore(STORE_EVENTS);
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IDB wipe error'));
      tx.onabort = () => reject(tx.error ?? new Error('IDB tx aborted'));
    });
  }

  private readMetaDayKey(db: IDBDatabase): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readonly');
      const store = tx.objectStore(STORE_META);
      const req = store.get(META_DAY_KEY);
      req.onsuccess = () => {
        const v = req.result;
        resolve(typeof v === 'string' ? v : null);
      };
      req.onerror = () => reject(req.error ?? new Error('IDB meta read error'));
    });
  }

  private writeMetaDayKey(db: IDBDatabase, dayKey: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readwrite');
      const store = tx.objectStore(STORE_META);
      store.put(dayKey, META_DAY_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IDB meta write error'));
      tx.onabort = () => reject(tx.error ?? new Error('IDB tx aborted'));
    });
  }
}
