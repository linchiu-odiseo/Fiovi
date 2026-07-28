import { Injectable, inject } from '@angular/core';
import { TutorActivityStorage } from '../../L1_domain/ports/tutor-activity-storage';
import { TutorActivityEvent } from '../../L1_domain/value-objects/tutor-activity-event';
import { OfflineStorageUnavailableError } from '../../L1_domain/errors/offline-storage-unavailable.error';
import { IDENTITY_STORAGE } from '../tokens';

// Comparte la misma DB que `IndexedDbMarkingsStorage` (`fiovi-cartilla`, store
// `data`) — el prefijo `cartilla.<email>.` de `wipeUserScope()` cubre acks,
// marcaciones, queue, admission-area Y ahora eventos de actividad del tutor.
// El único cambio es un nuevo tramo de key: `cartilla.<email>.tutor-activity.<eventId>`.
//
// NO se usa `IndexedDbMarkingsStorage` directamente para no forzar un import
// cruzado adapter → adapter. Ambos abren la misma DB con el mismo schema
// (single object store) — IDB es tolerante a múltiples `open()` de la misma
// versión.
const DB_NAME = 'fiovi-cartilla';
const DB_VERSION = 1;
const STORE = 'data';
const KEY_ROOT = 'cartilla';
const NAMESPACE = 'tutor-activity';

@Injectable({ providedIn: 'root' })
export class IndexedDbTutorActivityStorage implements TutorActivityStorage {
  private readonly identityStorage = inject(IDENTITY_STORAGE);
  private dbPromise: Promise<IDBDatabase> | null = null;

  async append(event: TutorActivityEvent): Promise<void> {
    const email = await this.requireUserEmail();
    const db = await this.db();
    await this.put(db, eventKey(email, event.id), serialize(event));
  }

  async list(): Promise<TutorActivityEvent[]> {
    const email = await this.requireUserEmail();
    const db = await this.db();
    const prefix = `${KEY_ROOT}.${email}.${NAMESPACE}.`;
    const entries = await this.getRange(db, prefix);
    const out: TutorActivityEvent[] = [];
    for (const { value } of entries) {
      const parsed = parse(value);
      if (parsed !== null) out.push(parsed);
    }
    return out;
  }

  async archive(eventId: string): Promise<void> {
    const email = await this.requireUserEmail();
    const db = await this.db();
    const key = eventKey(email, eventId);
    const raw = await this.get(db, key);
    if (raw === undefined) return; // no existe → no-op
    const parsed = parse(raw);
    if (parsed === null) return; // shape corrupto → skip
    await this.put(db, key, serialize({ ...parsed, archived: true }));
  }

  // Sin identity → no-op (misma semántica defensiva que MarkingsStorage:
  // se llama durante el logout después de que el storage ya podría estar
  // limpio, y no debe throw).
  async wipeUserScope(): Promise<void> {
    const email = await this.getUserEmailOrNull();
    if (!email) return;
    const db = await this.db();
    const prefix = `${KEY_ROOT}.${email}.${NAMESPACE}.`;
    await this.deleteRange(db, prefix);
  }

  // --- helpers privados ---

  private async db(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    if (typeof indexedDB === 'undefined') {
      throw new OfflineStorageUnavailableError('IndexedDB no está disponible en este navegador.');
    }
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () =>
        reject(
          new OfflineStorageUnavailableError(
            `No se pudo abrir IndexedDB: ${req.error?.message ?? 'error desconocido'}.`,
          ),
        );
    });
    this.dbPromise.catch(() => {
      this.dbPromise = null;
    });
    return this.dbPromise;
  }

  private async requireUserEmail(): Promise<string> {
    const email = await this.getUserEmailOrNull();
    if (!email) {
      throw new OfflineStorageUnavailableError(
        'No hay identidad activa para resolver el scope del storage.',
      );
    }
    return email;
  }

  private async getUserEmailOrNull(): Promise<string | null> {
    const identity = await this.identityStorage.read();
    return identity?.email ?? null;
  }

  private put(db: IDBDatabase, key: string, value: unknown): Promise<void> {
    return runTx(db, 'readwrite', (store) => store.put(value, key));
  }

  private get(db: IDBDatabase, key: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () =>
        reject(
          new OfflineStorageUnavailableError(
            `Fallo al leer key: ${req.error?.message ?? 'error desconocido'}.`,
          ),
        );
    });
  }

  private async getRange(
    db: IDBDatabase,
    prefix: string,
  ): Promise<{ key: string; value: unknown }[]> {
    const range = prefixRange(prefix);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const req = store.openCursor(range);
      const out: { key: string; value: unknown }[] = [];
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(out);
          return;
        }
        out.push({ key: String(cursor.key), value: cursor.value });
        cursor.continue();
      };
      req.onerror = () =>
        reject(
          new OfflineStorageUnavailableError(
            `Fallo al leer rango: ${req.error?.message ?? 'error desconocido'}.`,
          ),
        );
    });
  }

  private deleteRange(db: IDBDatabase, prefix: string): Promise<void> {
    const range = prefixRange(prefix);
    return runTx(db, 'readwrite', (store) => store.delete(range));
  }
}

function eventKey(email: string, eventId: string): string {
  return `${KEY_ROOT}.${email}.${NAMESPACE}.${eventId}`;
}

function prefixRange(prefix: string): IDBKeyRange {
  return IDBKeyRange.bound(prefix, prefix + '￿');
}

function serialize(event: TutorActivityEvent): Record<string, unknown> {
  return {
    id: event.id,
    recordId: event.recordId,
    examName: event.examName,
    courseName: event.courseName,
    finalizedAt: event.finalizedAt.toISOString(),
    archived: event.archived,
  };
}

function parse(raw: unknown): TutorActivityEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r['id'] !== 'string' ||
    typeof r['recordId'] !== 'string' ||
    typeof r['examName'] !== 'string' ||
    typeof r['finalizedAt'] !== 'string' ||
    typeof r['archived'] !== 'boolean'
  ) {
    return null;
  }
  const finalizedAt = new Date(r['finalizedAt']);
  if (Number.isNaN(finalizedAt.getTime())) return null;
  return {
    id: r['id'],
    recordId: r['recordId'],
    examName: r['examName'],
    courseName: typeof r['courseName'] === 'string' ? r['courseName'] : null,
    finalizedAt,
    archived: r['archived'],
  };
}

function runTx(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    op(store);
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(
        new OfflineStorageUnavailableError(
          `Fallo en transacción IndexedDB: ${tx.error?.message ?? 'error desconocido'}.`,
        ),
      );
    tx.onabort = () =>
      reject(
        new OfflineStorageUnavailableError(
          `Transacción IndexedDB abortada: ${tx.error?.message ?? 'error desconocido'}.`,
        ),
      );
  });
}
