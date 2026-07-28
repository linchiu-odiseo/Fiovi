import { Injectable, inject } from '@angular/core';
import {
  AnswersMap,
  AlternativaValue,
  EnvioPendiente,
  MarkingsStorage,
  SubmissionSnapshot,
} from '../../L1_domain/ports/markings-storage';
import { OutboxStoragePort } from '../../L1_domain/ports/outbox-storage.port';
import { AdmissionArea, isAdmissionArea } from '../../L1_domain/value-objects/admission-area';
import { SubmissionAck } from '../../L1_domain/value-objects/submission-ack';
import { OfflineStorageUnavailableError } from '../../L1_domain/errors/offline-storage-unavailable.error';
import { IDENTITY_STORAGE } from '../tokens';

const DB_NAME = 'fiovi-cartilla';
const DB_VERSION = 1;
const STORE = 'data';

// Patrón de keys planas en un único object store. La key encapsula el
// scope por usuario (`userEmail`) y la entidad (marcacion vs queue vs
// ack vs admission-area vs submission-snapshot).
//   marcacion:      cartilla.<email>.simulacro.<examId>.<pregunta>
//   queue:          cartilla.<email>.queue.<examId>
//   ack:            cartilla.<email>.ack.<examId>
//   admission-area: cartilla.<email>.admission-area.<examId>
//   snapshot:       cartilla.<email>.submission-snapshot.<examId>
// El prefijo `cartilla.<email>.` permite que `wipeUserScope()` use un
// rango de IDBKeyRange.bound(...) sin tocar datos de otros usuarios.
//
// El segmento literal "simulacro" en la key se MANTIENE adrede (sin
// migración de schema en este change) — corresponde al cleanup futuro
// per design D4 y openspec/changes/fase-3-exam-list-learnex/specs/offline-storage.
const KEY_ROOT = 'cartilla';

// También implementa `OutboxStoragePort.clear()` para que el `LogoutUseCase`
// pueda limpiar la cola sin conocer este adapter directamente. Ambas
// interfaces se bindean al mismo adapter en `app.config.ts` (useExisting).
@Injectable({ providedIn: 'root' })
export class IndexedDbMarkingsStorage implements MarkingsStorage, OutboxStoragePort {
  private readonly identityStorage = inject(IDENTITY_STORAGE);
  private dbPromise: Promise<IDBDatabase> | null = null;

  async setMarcacion(
    examId: string,
    pregunta: number,
    alternativa: AlternativaValue,
  ): Promise<void> {
    const email = await this.requireUserEmail();
    const db = await this.db();
    await this.put(db, marcacionKey(email, examId, pregunta), { alternativa });
  }

  async getMarcaciones(examId: string): Promise<AnswersMap> {
    const email = await this.requireUserEmail();
    const db = await this.db();
    const prefix = `${KEY_ROOT}.${email}.simulacro.${examId}.`;
    const entries = await this.getRange(db, prefix);
    const out: AnswersMap = {};
    for (const { key, value } of entries) {
      const pregunta = key.slice(prefix.length);
      out[pregunta] = (value as { alternativa: AlternativaValue }).alternativa;
    }
    return out;
  }

  async clearMarcaciones(examId: string): Promise<void> {
    const email = await this.requireUserEmail();
    const db = await this.db();
    const prefix = `${KEY_ROOT}.${email}.simulacro.${examId}.`;
    await this.deleteRange(db, prefix);
    // También borra el AdmissionArea para no dejar estado stale del examen
    // anterior (design.md D3 de `add-admission-area`).
    await this.delete(db, admissionAreaKey(email, examId));
  }

  async enqueueEnvio(envio: EnvioPendiente): Promise<void> {
    const email = await this.requireUserEmail();
    const db = await this.db();
    await this.put(db, queueKey(email, envio.examId), envio);
  }

  async getEnviosPendientes(): Promise<EnvioPendiente[]> {
    const email = await this.requireUserEmail();
    const db = await this.db();
    const prefix = `${KEY_ROOT}.${email}.queue.`;
    const entries = await this.getRange(db, prefix);
    return entries.map(({ value }) => value as EnvioPendiente);
  }

  async dequeueEnvio(examId: string): Promise<void> {
    const email = await this.requireUserEmail();
    const db = await this.db();
    await this.delete(db, queueKey(email, examId));
  }

  // Persistencia del comprobante criptográfico devuelto por el server.
  // Serializamos `submittedAt` como ISO string para que IDB structured-clone
  // no nos guarde un Date "vivo" (más fácil de inspeccionar y migrar).
  async setSubmissionAck(examId: string, ack: SubmissionAck): Promise<void> {
    const email = await this.requireUserEmail();
    const db = await this.db();
    await this.put(db, ackKey(email, examId), {
      id: ack.id,
      submissionHash: ack.submissionHash,
      submittedAt: ack.submittedAt.toISOString(),
    });
  }

  // Reconstruye el VO desde el shape serializado. Si la entrada no existe
  // → null (el caller usa esto para decidir si la card de /home muestra
  // "enviado"). El constructor del VO re-valida shape — defensivo contra
  // datos IDB corruptos de versiones previas.
  async getSubmissionAck(examId: string): Promise<SubmissionAck | null> {
    const email = await this.requireUserEmail();
    const db = await this.db();
    const raw = await this.get(db, ackKey(email, examId));
    if (raw === undefined) return null;
    const stored = raw as { id: string; submissionHash: string; submittedAt: string };
    return new SubmissionAck(stored.id, stored.submissionHash, new Date(stored.submittedAt));
  }

  // Scan de todos los acks del usuario actual (prefijo `cartilla.<email>.ack.`).
  // Cada entry es tolerante a shape stale: si el VO no puede reconstruirse
  // (datos corruptos de versiones previas), se omite silenciosamente en vez
  // de romper la lista entera.
  async getAllSubmissionAcks(): Promise<ReadonlyMap<string, SubmissionAck>> {
    const email = await this.requireUserEmail();
    const db = await this.db();
    const prefix = `${KEY_ROOT}.${email}.ack.`;
    const entries = await this.getRange(db, prefix);
    const out = new Map<string, SubmissionAck>();
    for (const { key, value } of entries) {
      const examId = key.slice(prefix.length);
      const stored = value as { id?: unknown; submissionHash?: unknown; submittedAt?: unknown };
      if (
        typeof stored.id !== 'string' ||
        typeof stored.submissionHash !== 'string' ||
        typeof stored.submittedAt !== 'string'
      ) {
        continue;
      }
      try {
        out.set(examId, new SubmissionAck(stored.id, stored.submissionHash, new Date(stored.submittedAt)));
      } catch {
        // shape válido pero VO rechaza (hash mal, date inválido): skip.
      }
    }
    return out;
  }

  // Persistencia del área de POSTULACIÓN del alumno (ver AdmissionArea VO).
  // Idempotente (última llamada gana). NO confundir con Exam.area (curso).
  async setAdmissionArea(examId: string, area: AdmissionArea): Promise<void> {
    const email = await this.requireUserEmail();
    const db = await this.db();
    await this.put(db, admissionAreaKey(email, examId), { area });
  }

  // Retorna null si el alumno nunca eligió expresamente para este examen.
  // El use case interpreta null como DEFAULT_ADMISSION_AREA sin persistir
  // (design.md D3). Guard defensivo contra shapes stale de IDB.
  async getAdmissionArea(examId: string): Promise<AdmissionArea | null> {
    const email = await this.requireUserEmail();
    const db = await this.db();
    const raw = await this.get(db, admissionAreaKey(email, examId));
    if (raw === undefined) return null;
    const stored = raw as { area?: unknown };
    return isAdmissionArea(stored.area) ? stored.area : null;
  }

  // Snapshot congelado del envío. El use case de envío lo llama antes de
  // borrar marcaciones activas para que el historial pueda mostrar las
  // respuestas que se mandaron.
  async saveSubmissionSnapshot(examId: string, snapshot: SubmissionSnapshot): Promise<void> {
    const email = await this.requireUserEmail();
    const db = await this.db();
    await this.put(db, snapshotKey(email, examId), {
      answers: snapshot.answers,
      admissionArea: snapshot.admissionArea,
    });
  }

  async getSubmissionSnapshot(examId: string): Promise<SubmissionSnapshot | null> {
    const email = await this.requireUserEmail();
    const db = await this.db();
    const raw = await this.get(db, snapshotKey(email, examId));
    if (raw === undefined) return null;
    const stored = raw as { answers?: unknown; admissionArea?: unknown };
    if (typeof stored.answers !== 'object' || stored.answers === null) return null;
    if (!isAdmissionArea(stored.admissionArea)) return null;
    return {
      answers: stored.answers as AnswersMap,
      admissionArea: stored.admissionArea,
    };
  }

  // Sin identity → no-op (caso normal durante logout cuando el storage ya
  // fue limpiado, o cuando se llama defensivamente). NO throw.
  async wipeUserScope(): Promise<void> {
    const email = await this.getUserEmailOrNull();
    if (!email) return;
    const db = await this.db();
    const prefix = `${KEY_ROOT}.${email}.`;
    await this.deleteRange(db, prefix);
  }

  // Implementación de `OutboxStoragePort.clear()`. Borra sólo la cola del
  // usuario actual; los simulacros marcados se conservan (eso lo limpia
  // `wipeUserScope`). Sin identity → no-op.
  async clear(): Promise<void> {
    const email = await this.getUserEmailOrNull();
    if (!email) return;
    const db = await this.db();
    const prefix = `${KEY_ROOT}.${email}.queue.`;
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
    // No cachear el rechazo: si falla, el próximo intento reabre.
    this.dbPromise.catch(() => {
      this.dbPromise = null;
    });
    return this.dbPromise;
  }

  // Para operaciones que SÍ requieren sesión activa (set/get/clear de
  // marcaciones, enqueue/dequeue de envíos). Si no hay identity → throw.
  private async requireUserEmail(): Promise<string> {
    const email = await this.getUserEmailOrNull();
    if (!email) {
      throw new OfflineStorageUnavailableError(
        'No hay identidad activa para resolver el scope del storage.',
      );
    }
    return email;
  }

  // Para operaciones tolerantes a "sin identity" (wipeUserScope, clear de
  // outbox durante logout). Devuelve null en vez de lanzar.
  private async getUserEmailOrNull(): Promise<string | null> {
    const identity = await this.identityStorage.read();
    return identity?.email ?? null;
  }

  private put(db: IDBDatabase, key: string, value: unknown): Promise<void> {
    return runTx(db, 'readwrite', (store) => store.put(value, key));
  }

  private delete(db: IDBDatabase, key: string): Promise<void> {
    return runTx(db, 'readwrite', (store) => store.delete(key));
  }

  // Lee una key puntual. Resuelve con `undefined` si no existe. Errores de
  // IDB se mapean a OfflineStorageUnavailableError, consistente con el
  // resto del adapter.
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

  private async deleteRange(db: IDBDatabase, prefix: string): Promise<void> {
    const range = prefixRange(prefix);
    return runTx(db, 'readwrite', (store) => store.delete(range));
  }
}

// --- utilidades libres ---

function marcacionKey(email: string, examId: string, pregunta: number): string {
  return `${KEY_ROOT}.${email}.simulacro.${examId}.${pregunta}`;
}

function queueKey(email: string, examId: string): string {
  return `${KEY_ROOT}.${email}.queue.${examId}`;
}

function ackKey(email: string, examId: string): string {
  return `${KEY_ROOT}.${email}.ack.${examId}`;
}

function admissionAreaKey(email: string, examId: string): string {
  return `${KEY_ROOT}.${email}.admission-area.${examId}`;
}

function snapshotKey(email: string, examId: string): string {
  return `${KEY_ROOT}.${email}.submission-snapshot.${examId}`;
}

// Rango "key starts with prefix" — IndexedDB ordena keys lexicográficamente,
// así que el sufijo '￿' cubre todas las claves que empiezan con el prefijo.
function prefixRange(prefix: string): IDBKeyRange {
  return IDBKeyRange.bound(prefix, prefix + '￿');
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
