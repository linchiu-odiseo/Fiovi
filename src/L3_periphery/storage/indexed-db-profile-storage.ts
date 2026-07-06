import { Injectable } from '@angular/core';
import { Role } from '../../L1_domain/entities/identity';
import { CachedProfile, ProfileStorage } from '../../L1_domain/ports/profile-storage';
import { StudentProfile } from '../../L1_domain/value-objects/student-profile';
import { TutorProfile } from '../../L1_domain/value-objects/tutor-profile';
import { OfflineStorageUnavailableError } from '../../L1_domain/errors/offline-storage-unavailable.error';

const DB_NAME = 'fiovi-profile';
const DB_VERSION = 1;
const STORE = 'profile';

// Keys planas por rol: `profile.student`, `profile.tutor`. La evaluación
// de TTL queda a cargo del use case (`GetProfileUseCase`) — el storage
// sólo persiste y devuelve. Esto mantiene la responsabilidad del adapter
// acotada y permite cambiar la política de cache sin tocar IDB.
const KEY_PREFIX = 'profile';

interface PersistedShape {
  profile?: unknown;
  cachedAt?: number;
}

@Injectable({ providedIn: 'root' })
export class IndexedDbProfileStorage implements ProfileStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;

  async read(role: Role): Promise<CachedProfile | null> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(profileKey(role));
      req.onsuccess = () => {
        const value = req.result as PersistedShape | undefined;
        if (!value || typeof value.cachedAt !== 'number' || !value.profile) {
          resolve(null);
          return;
        }
        resolve({
          profile: value.profile as StudentProfile | TutorProfile,
          cachedAt: value.cachedAt,
        });
      };
      req.onerror = () =>
        reject(
          new OfflineStorageUnavailableError(
            `Fallo al leer profile cache: ${req.error?.message ?? 'error desconocido'}.`,
          ),
        );
    });
  }

  async write(role: Role, profile: StudentProfile | TutorProfile): Promise<void> {
    const db = await this.db();
    const value: PersistedShape = { profile, cachedAt: Date.now() };
    return runTx(db, 'readwrite', (store) => store.put(value, profileKey(role)));
  }

  async clear(): Promise<void> {
    const db = await this.db();
    return runTx(db, 'readwrite', (store) => store.clear());
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
            `No se pudo abrir IndexedDB profile: ${req.error?.message ?? 'error desconocido'}.`,
          ),
        );
    });
    this.dbPromise.catch(() => {
      this.dbPromise = null;
    });
    return this.dbPromise;
  }
}

function profileKey(role: Role): string {
  return `${KEY_PREFIX}.${role}`;
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
          `Fallo en transacción IndexedDB profile: ${tx.error?.message ?? 'error desconocido'}.`,
        ),
      );
    tx.onabort = () =>
      reject(
        new OfflineStorageUnavailableError(
          `Transacción IndexedDB profile abortada: ${tx.error?.message ?? 'error desconocido'}.`,
        ),
      );
  });
}
