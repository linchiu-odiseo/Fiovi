// Tests del adapter L3 `IndexedDbMarkingsStorage`.
//
// Cubre los scenarios del spec `offline-storage` y el fix de layer
// violation introducido en PR2 de `fase-3-login-learnex`:
// - El adapter ya NO depende de `LocalStorageSessionStorage` (clase
//   concreta). Inyecta `IdentityStorage` (port) vía el token `IDENTITY_STORAGE`.
// - El `email` del scope viene de `identity.email`.
// - `wipeUserScope()` sin identity = no-op (no lanza).
// - `clear()` (OutboxStoragePort) sin identity = no-op.
//
// En `fase-3-exam-submit-learnex` el puerto MarkingsStorage:
// - reemplaza `hasSubmittedAck → getSubmissionAck` (retorna VO en vez de boolean)
// - agrega `setSubmissionAck` para persistir el comprobante criptográfico
// - extiende `wipeUserScope` para borrar también acks
// - `EnvioPendiente` incluye `code` (DNI) para reconstruir el body en retry
//
// `fake-indexeddb/auto` reemplaza `globalThis.indexedDB` al importarse.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { IndexedDbMarkingsStorage } from '../../../../src/L3_periphery/storage/indexed-db-markings-storage';
import { IDENTITY_STORAGE } from '../../../../src/L3_periphery/tokens';
import { IdentityStorage } from '../../../../src/L1_domain/ports/identity-storage';
import { Identity } from '../../../../src/L1_domain/entities/identity';
import { SubmissionAck } from '../../../../src/L1_domain/value-objects/submission-ack';
import { OfflineStorageUnavailableError } from '../../../../src/L1_domain/errors/offline-storage-unavailable.error';

const DB_NAME = 'fiovi-cartilla';
const STORE = 'data';

// Hash sha256 válido para construir SubmissionAck en tests.
const VALID_HASH = 'a3f5c8d1b2e4f6a8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
const ALT_HASH = 'b4f6c7d8e9f0a1b2a3f5c8d1b2e4f6a8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4';

// Doble manual del port `IdentityStorage`. Permite alternar la identity
// "activa" entre tests sin tocar IndexedDB ni localStorage real.
class StubIdentityStorage implements IdentityStorage {
  private current: Identity | null = null;

  setIdentity(i: Identity | null): void {
    this.current = i;
  }

  async read(): Promise<Identity | null> {
    return this.current;
  }

  async write(identity: Identity): Promise<void> {
    this.current = identity;
  }

  async clear(): Promise<void> {
    this.current = null;
  }
}

function makeIdentity(email: string): Identity {
  return new Identity(
    'user-id',
    'tenant-id',
    'vonex',
    email,
    '79507732',
    ['student'],
    Date.now() + 900_000,
  );
}

// Lee todas las claves del object store para tests que verifican el
// formato literal de la key (segmento "simulacro" / "queue" / "ack").
function readAllKeys(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const openReq = indexedDB.open(DB_NAME);
    openReq.onupgradeneeded = () => {
      const db = openReq.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    openReq.onsuccess = () => {
      const db = openReq.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.close();
        resolve([]);
        return;
      }
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAllKeys();
      req.onsuccess = () => {
        db.close();
        resolve((req.result as IDBValidKey[]).map((k) => String(k)));
      };
      req.onerror = () => {
        db.close();
        reject(req.error);
      };
    };
    openReq.onerror = () => reject(openReq.error);
  });
}

// Vacía el único object store entre tests (mismo patrón que el spec viejo).
function wipeAllKeys(): Promise<void> {
  return new Promise((resolve, reject) => {
    const openReq = indexedDB.open(DB_NAME);
    openReq.onupgradeneeded = () => {
      const db = openReq.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    openReq.onsuccess = () => {
      const db = openReq.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.close();
        resolve();
        return;
      }
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
    openReq.onerror = () => reject(openReq.error);
  });
}

describe('IndexedDbMarkingsStorage', () => {
  let identityStorage: StubIdentityStorage;
  let adapter: IndexedDbMarkingsStorage;

  beforeEach(async () => {
    await wipeAllKeys();
    identityStorage = new StubIdentityStorage();
    identityStorage.setIdentity(makeIdentity('alumno-a@vonex.edu.pe'));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        IndexedDbMarkingsStorage,
        { provide: IDENTITY_STORAGE, useValue: identityStorage },
      ],
    });
    adapter = TestBed.inject(IndexedDbMarkingsStorage);
  });

  afterEach(async () => {
    await wipeAllKeys();
  });

  describe('marcaciones — operaciones básicas', () => {
    it('persiste una marcación y la devuelve en getMarcaciones', async () => {
      await adapter.setMarcacion('sim-1', 5, 'C');
      const map = await adapter.getMarcaciones('sim-1');
      expect(map).toEqual({ '5': 'C' });
    });

    it('cambia la alternativa al sobreescribir la misma pregunta', async () => {
      await adapter.setMarcacion('sim-1', 5, 'C');
      await adapter.setMarcacion('sim-1', 5, 'A');
      const map = await adapter.getMarcaciones('sim-1');
      expect(map).toEqual({ '5': 'A' });
    });

    it('desmarcar (alternativa=null) deja el valor null en el map', async () => {
      await adapter.setMarcacion('sim-1', 5, 'C');
      await adapter.setMarcacion('sim-1', 5, null);
      const map = await adapter.getMarcaciones('sim-1');
      expect(map).toEqual({ '5': null });
    });

    it('getMarcaciones de un simulacro sin marcas devuelve objeto vacío', async () => {
      const map = await adapter.getMarcaciones('sim-vacio');
      expect(map).toEqual({});
    });

    it('persiste múltiples preguntas del mismo simulacro', async () => {
      await adapter.setMarcacion('sim-1', 1, 'A');
      await adapter.setMarcacion('sim-1', 2, 'B');
      await adapter.setMarcacion('sim-1', 3, null);
      const map = await adapter.getMarcaciones('sim-1');
      expect(map).toEqual({ '1': 'A', '2': 'B', '3': null });
    });

    it('clearMarcaciones vacía un simulacro sin tocar otros del mismo usuario', async () => {
      await adapter.setMarcacion('sim-1', 1, 'A');
      await adapter.setMarcacion('sim-1', 2, 'B');
      await adapter.setMarcacion('sim-2', 1, 'C');

      await adapter.clearMarcaciones('sim-1');

      expect(await adapter.getMarcaciones('sim-1')).toEqual({});
      expect(await adapter.getMarcaciones('sim-2')).toEqual({ '1': 'C' });
    });
  });

  describe('scope por email (vía IdentityStorage)', () => {
    it('usuario B no ve marcaciones del usuario A', async () => {
      identityStorage.setIdentity(makeIdentity('alumno-a@vonex.edu.pe'));
      await adapter.setMarcacion('sim-1', 1, 'A');
      await adapter.setMarcacion('sim-1', 2, 'B');

      identityStorage.setIdentity(makeIdentity('alumno-b@vonex.edu.pe'));
      const mapB = await adapter.getMarcaciones('sim-1');
      expect(mapB).toEqual({});

      identityStorage.setIdentity(makeIdentity('alumno-a@vonex.edu.pe'));
      const mapA = await adapter.getMarcaciones('sim-1');
      expect(mapA).toEqual({ '1': 'A', '2': 'B' });
    });

    it('wipeUserScope de B no afecta los datos de A (incluyendo acks)', async () => {
      identityStorage.setIdentity(makeIdentity('alumno-a@vonex.edu.pe'));
      await adapter.setMarcacion('sim-1', 1, 'A');
      await adapter.enqueueEnvio({
        examId: 'sim-1',
        code: '79507732',
        answers: { '1': 'A' },
        clientFinishedAt: '2026-06-11T12:00:00.000Z',
      });
      const ackA = new SubmissionAck('ack-A', VALID_HASH, new Date('2026-06-11T12:05:00.000Z'));
      await adapter.setSubmissionAck('sim-1', ackA);

      identityStorage.setIdentity(makeIdentity('alumno-b@vonex.edu.pe'));
      await adapter.setMarcacion('sim-9', 1, 'D');
      const ackB = new SubmissionAck('ack-B', ALT_HASH, new Date('2026-06-11T13:00:00.000Z'));
      await adapter.setSubmissionAck('sim-9', ackB);
      await adapter.wipeUserScope();

      // B quedó vacío.
      expect(await adapter.getMarcaciones('sim-9')).toEqual({});
      expect(await adapter.getEnviosPendientes()).toEqual([]);
      expect(await adapter.getSubmissionAck('sim-9')).toBeNull();

      // A intacto (marcaciones, queue y ack).
      identityStorage.setIdentity(makeIdentity('alumno-a@vonex.edu.pe'));
      expect(await adapter.getMarcaciones('sim-1')).toEqual({ '1': 'A' });
      expect(await adapter.getEnviosPendientes()).toEqual([
        {
          examId: 'sim-1',
          code: '79507732',
          answers: { '1': 'A' },
          clientFinishedAt: '2026-06-11T12:00:00.000Z',
        },
      ]);
      const persistedAckA = await adapter.getSubmissionAck('sim-1');
      expect(persistedAckA?.id).toBe('ack-A');
      expect(persistedAckA?.submissionHash).toBe(VALID_HASH);
    });

    it('wipeUserScope borra marcaciones, cola Y acks del usuario actual', async () => {
      await adapter.setMarcacion('sim-1', 1, 'A');
      await adapter.setMarcacion('sim-2', 1, 'B');
      await adapter.enqueueEnvio({
        examId: 'sim-1',
        code: '79507732',
        answers: { '1': 'A' },
        clientFinishedAt: '2026-06-11T12:00:00.000Z',
      });
      const ack = new SubmissionAck('ack-1', VALID_HASH, new Date('2026-06-11T12:05:00.000Z'));
      await adapter.setSubmissionAck('sim-1', ack);

      await adapter.wipeUserScope();

      expect(await adapter.getMarcaciones('sim-1')).toEqual({});
      expect(await adapter.getMarcaciones('sim-2')).toEqual({});
      expect(await adapter.getEnviosPendientes()).toEqual([]);
      expect(await adapter.getSubmissionAck('sim-1')).toBeNull();
    });
  });

  describe('cola de envíos pendientes (preserva `code` round-trip)', () => {
    it('enqueueEnvio + getEnviosPendientes roundtrip preserva code', async () => {
      const envio = {
        examId: 'sim-1',
        code: '30303011',
        answers: { '1': 'A' as const, '2': null },
        clientFinishedAt: '2026-06-11T12:00:00.000Z',
      };
      await adapter.enqueueEnvio(envio);
      const pending = await adapter.getEnviosPendientes();
      expect(pending).toEqual([envio]);
      expect(pending[0].code).toBe('30303011');
    });

    it('getEnviosPendientes devuelve [] cuando la cola está vacía', async () => {
      expect(await adapter.getEnviosPendientes()).toEqual([]);
    });

    it('enqueueEnvio del mismo examId sobreescribe el envío previo (incluyendo code)', async () => {
      await adapter.enqueueEnvio({
        examId: 'sim-1',
        code: 'old-code',
        answers: { '1': 'A' },
        clientFinishedAt: '2026-06-11T12:00:00.000Z',
      });
      await adapter.enqueueEnvio({
        examId: 'sim-1',
        code: 'new-code',
        answers: { '1': 'B' },
        clientFinishedAt: '2026-06-11T12:05:00.000Z',
      });
      const pending = await adapter.getEnviosPendientes();
      expect(pending).toHaveLength(1);
      expect(pending[0].answers).toEqual({ '1': 'B' });
      expect(pending[0].code).toBe('new-code');
    });

    it('dequeueEnvio elimina sólo el examId indicado', async () => {
      await adapter.enqueueEnvio({
        examId: 'sim-1',
        code: '30303011',
        answers: { '1': 'A' },
        clientFinishedAt: '2026-06-11T12:00:00.000Z',
      });
      await adapter.enqueueEnvio({
        examId: 'sim-2',
        code: '30303011',
        answers: { '1': 'B' },
        clientFinishedAt: '2026-06-11T12:05:00.000Z',
      });

      await adapter.dequeueEnvio('sim-1');

      const pending = await adapter.getEnviosPendientes();
      expect(pending).toHaveLength(1);
      expect(pending[0].examId).toBe('sim-2');
    });
  });

  describe('SubmissionAck — setSubmissionAck / getSubmissionAck round-trip', () => {
    it('setSubmissionAck persiste el ack y getSubmissionAck reconstruye el VO con shape original', async () => {
      const submittedAt = new Date('2026-06-17T15:29:54.531Z');
      const ack = new SubmissionAck('ack-uuid-1', VALID_HASH, submittedAt);

      await adapter.setSubmissionAck('exam-42', ack);
      const retrieved = await adapter.getSubmissionAck('exam-42');

      expect(retrieved).toBeInstanceOf(SubmissionAck);
      expect(retrieved?.id).toBe('ack-uuid-1');
      expect(retrieved?.submissionHash).toBe(VALID_HASH);
      // Equality por getTime — el VO reconstruye Date desde ISO string en IDB.
      expect(retrieved?.submittedAt.getTime()).toBe(submittedAt.getTime());
    });

    it('getSubmissionAck retorna null para examId sin ack persistido', async () => {
      expect(await adapter.getSubmissionAck('exam-no-existe')).toBeNull();
    });

    it('setSubmissionAck sobreescribe el ack anterior para el mismo examId', async () => {
      const ack1 = new SubmissionAck('ack-1', VALID_HASH, new Date('2026-06-17T10:00:00.000Z'));
      const ack2 = new SubmissionAck('ack-2', ALT_HASH, new Date('2026-06-17T11:00:00.000Z'));

      await adapter.setSubmissionAck('exam-42', ack1);
      await adapter.setSubmissionAck('exam-42', ack2);

      const retrieved = await adapter.getSubmissionAck('exam-42');
      expect(retrieved?.id).toBe('ack-2');
      expect(retrieved?.submissionHash).toBe(ALT_HASH);
    });

    it('persiste ack independiente de marcaciones (cada uno tiene su clave)', async () => {
      await adapter.setMarcacion('exam-42', 1, 'A');
      const ack = new SubmissionAck('ack-1', VALID_HASH, new Date('2026-06-17T10:00:00.000Z'));
      await adapter.setSubmissionAck('exam-42', ack);

      // Borrar marcaciones NO borra el ack.
      await adapter.clearMarcaciones('exam-42');
      expect(await adapter.getMarcaciones('exam-42')).toEqual({});
      expect(await adapter.getSubmissionAck('exam-42')).not.toBeNull();
    });

    it('ack persiste al reabrir el adapter (mismo DB)', async () => {
      const ack = new SubmissionAck('ack-1', VALID_HASH, new Date('2026-06-17T10:00:00.000Z'));
      await adapter.setSubmissionAck('exam-42', ack);

      TestBed.resetTestingModule();
      const reopenedIdentity = new StubIdentityStorage();
      reopenedIdentity.setIdentity(makeIdentity('alumno-a@vonex.edu.pe'));
      TestBed.configureTestingModule({
        providers: [
          IndexedDbMarkingsStorage,
          { provide: IDENTITY_STORAGE, useValue: reopenedIdentity },
        ],
      });
      const reopened = TestBed.inject(IndexedDbMarkingsStorage);

      const retrieved = await reopened.getSubmissionAck('exam-42');
      expect(retrieved?.id).toBe('ack-1');
      expect(retrieved?.submissionHash).toBe(VALID_HASH);
    });
  });

  describe('AdmissionArea — get/set/clear + guard defensivo contra stale', () => {
    // Área de POSTULACIÓN (NO Exam.area). Persiste en la misma DB con key
    // `cartilla.<email>.admission-area.<examId>`. clearMarcaciones borra
    // también el area del mismo examen (design.md D3 de `add-admission-area`).
    it('getAdmissionArea retorna null sin persistencia previa', async () => {
      expect(await adapter.getAdmissionArea('exam-X')).toBeNull();
    });

    it('setAdmissionArea + getAdmissionArea round-trip', async () => {
      await adapter.setAdmissionArea('exam-X', 'MAT');
      expect(await adapter.getAdmissionArea('exam-X')).toBe('MAT');
    });

    it('setAdmissionArea es idempotente (última llamada gana)', async () => {
      await adapter.setAdmissionArea('exam-X', 'MAT');
      await adapter.setAdmissionArea('exam-X', 'CIE');
      await adapter.setAdmissionArea('exam-X', 'GENERAL');
      expect(await adapter.getAdmissionArea('exam-X')).toBe('GENERAL');
    });

    it('clearMarcaciones(X) borra también el area de X', async () => {
      await adapter.setMarcacion('exam-X', 1, 'A');
      await adapter.setAdmissionArea('exam-X', 'MAT');

      await adapter.clearMarcaciones('exam-X');

      expect(await adapter.getMarcaciones('exam-X')).toEqual({});
      expect(await adapter.getAdmissionArea('exam-X')).toBeNull();
    });

    it('clearMarcaciones(X) NO afecta el area de otro examen Y', async () => {
      await adapter.setAdmissionArea('exam-X', 'MAT');
      await adapter.setAdmissionArea('exam-Y', 'CIE');

      await adapter.clearMarcaciones('exam-X');

      expect(await adapter.getAdmissionArea('exam-X')).toBeNull();
      expect(await adapter.getAdmissionArea('exam-Y')).toBe('CIE');
    });

    it('wipeUserScope limpia también el area (todos los examId del usuario)', async () => {
      await adapter.setAdmissionArea('exam-X', 'MAT');
      await adapter.setAdmissionArea('exam-Y', 'CIE');

      await adapter.wipeUserScope();

      expect(await adapter.getAdmissionArea('exam-X')).toBeNull();
      expect(await adapter.getAdmissionArea('exam-Y')).toBeNull();
    });

    // Guard defensivo del adapter: si IDB devuelve una entry con `area`
    // fuera del set (stale de una versión previa o corrupción), el getter
    // retorna null en vez de propagar el valor inválido al dominio.
    it('guard defensivo: entry con area stale ("VI" fuera del set) → getAdmissionArea retorna null', async () => {
      // Escribimos directo en IDB con un shape stale, sin pasar por el setter.
      const rawKey = `cartilla.alumno-a@vonex.edu.pe.admission-area.exam-stale`;
      await new Promise<void>((resolve, reject) => {
        const openReq = indexedDB.open(DB_NAME);
        openReq.onsuccess = () => {
          const db = openReq.result;
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put({ area: 'VI' }, rawKey);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
        openReq.onerror = () => reject(openReq.error);
      });

      expect(await adapter.getAdmissionArea('exam-stale')).toBeNull();
    });
  });

  describe('key format en IDB sigue el patrón `cartilla.<email>.{simulacro|queue|ack}.<examId>`', () => {
    it('marcaciones se escriben con clave que contiene ".simulacro." literal', async () => {
      await adapter.setMarcacion('exam-key-test', 7, 'D');

      const keys = await readAllKeys();
      const matched = keys.filter((k) => k.includes('.simulacro.'));
      expect(matched.length).toBeGreaterThan(0);
      expect(matched.some((k) => k.endsWith('.simulacro.exam-key-test.7'))).toBe(true);
    });

    it('cola de envíos se escribe con clave que contiene ".queue." literal', async () => {
      await adapter.enqueueEnvio({
        examId: 'queue-key-test',
        code: '30303011',
        answers: { '1': 'A' },
        clientFinishedAt: '2026-06-11T12:00:00.000Z',
      });

      const keys = await readAllKeys();
      const queueKeys = keys.filter((k) => k.includes('.queue.'));
      expect(queueKeys.length).toBeGreaterThan(0);
      expect(queueKeys.some((k) => k.endsWith('.queue.queue-key-test'))).toBe(true);
    });

    it('acks se escriben con clave `cartilla.<email>.ack.<examId>`', async () => {
      const ack = new SubmissionAck('ack-1', VALID_HASH, new Date('2026-06-17T10:00:00.000Z'));
      await adapter.setSubmissionAck('ack-key-test', ack);

      const keys = await readAllKeys();
      const ackKeys = keys.filter((k) => k.includes('.ack.'));
      expect(ackKeys.length).toBeGreaterThan(0);
      // El patrón exacto requerido por el spec offline-storage.
      expect(ackKeys.some((k) => k === 'cartilla.alumno-a@vonex.edu.pe.ack.ack-key-test')).toBe(
        true,
      );
    });
  });

  describe('IndexedDB no disponible', () => {
    it('rechaza con OfflineStorageUnavailableError si indexedDB es undefined', async () => {
      const g = globalThis as unknown as { indexedDB?: IDBFactory };
      const saved = g.indexedDB;
      g.indexedDB = undefined;
      try {
        TestBed.resetTestingModule();
        const freshIdentity = new StubIdentityStorage();
        freshIdentity.setIdentity(makeIdentity('alumno-a@vonex.edu.pe'));
        TestBed.configureTestingModule({
          providers: [
            IndexedDbMarkingsStorage,
            { provide: IDENTITY_STORAGE, useValue: freshIdentity },
          ],
        });
        const fresh = TestBed.inject(IndexedDbMarkingsStorage);

        await expect(fresh.setMarcacion('sim-1', 1, 'A')).rejects.toBeInstanceOf(
          OfflineStorageUnavailableError,
        );
        await expect(fresh.getMarcaciones('sim-1')).rejects.toBeInstanceOf(
          OfflineStorageUnavailableError,
        );
        await expect(
          fresh.enqueueEnvio({
            examId: 'sim-1',
            code: '30303011',
            answers: {},
            clientFinishedAt: '2026-06-11T12:00:00.000Z',
          }),
        ).rejects.toBeInstanceOf(OfflineStorageUnavailableError);
        await expect(fresh.wipeUserScope()).rejects.toBeInstanceOf(OfflineStorageUnavailableError);
      } finally {
        g.indexedDB = saved;
      }
    });
  });

  describe('sin identity activa', () => {
    it('setMarcacion rechaza con OfflineStorageUnavailableError', async () => {
      identityStorage.setIdentity(null);
      await expect(adapter.setMarcacion('sim-1', 1, 'A')).rejects.toBeInstanceOf(
        OfflineStorageUnavailableError,
      );
    });

    it('setSubmissionAck sin identity rechaza con OfflineStorageUnavailableError', async () => {
      identityStorage.setIdentity(null);
      const ack = new SubmissionAck('ack-1', VALID_HASH, new Date());
      await expect(adapter.setSubmissionAck('sim-1', ack)).rejects.toBeInstanceOf(
        OfflineStorageUnavailableError,
      );
    });

    it('getSubmissionAck sin identity rechaza con OfflineStorageUnavailableError', async () => {
      identityStorage.setIdentity(null);
      await expect(adapter.getSubmissionAck('sim-1')).rejects.toBeInstanceOf(
        OfflineStorageUnavailableError,
      );
    });

    it('wipeUserScope sin identity es no-op (no lanza, no borra nada)', async () => {
      // Primero dejamos datos de A.
      identityStorage.setIdentity(makeIdentity('alumno-a@vonex.edu.pe'));
      await adapter.setMarcacion('sim-1', 1, 'A');
      await adapter.enqueueEnvio({
        examId: 'sim-1',
        code: '79507732',
        answers: { '1': 'A' },
        clientFinishedAt: '2026-06-11T12:00:00.000Z',
      });

      // Ahora sin identity → wipe no debe lanzar ni borrar.
      identityStorage.setIdentity(null);
      await expect(adapter.wipeUserScope()).resolves.toBeUndefined();

      // Reponemos identity de A y verificamos que los datos siguen intactos.
      identityStorage.setIdentity(makeIdentity('alumno-a@vonex.edu.pe'));
      expect(await adapter.getMarcaciones('sim-1')).toEqual({ '1': 'A' });
      expect(await adapter.getEnviosPendientes()).toHaveLength(1);
    });

    it('clear (OutboxStoragePort) sin identity es no-op (no lanza, no borra nada)', async () => {
      identityStorage.setIdentity(makeIdentity('alumno-a@vonex.edu.pe'));
      await adapter.enqueueEnvio({
        examId: 'sim-1',
        code: '79507732',
        answers: { '1': 'A' },
        clientFinishedAt: '2026-06-11T12:00:00.000Z',
      });

      identityStorage.setIdentity(null);
      await expect(adapter.clear()).resolves.toBeUndefined();

      identityStorage.setIdentity(makeIdentity('alumno-a@vonex.edu.pe'));
      expect(await adapter.getEnviosPendientes()).toHaveLength(1);
    });
  });

  describe('clear (OutboxStoragePort) — comportamiento con identity', () => {
    it('borra sólo cartilla.<email>.queue.* y preserva marcaciones y acks', async () => {
      identityStorage.setIdentity(makeIdentity('alumno-a@vonex.edu.pe'));
      await adapter.setMarcacion('sim-1', 1, 'A');
      await adapter.setMarcacion('sim-2', 1, 'B');
      await adapter.enqueueEnvio({
        examId: 'sim-1',
        code: '79507732',
        answers: { '1': 'A' },
        clientFinishedAt: '2026-06-11T12:00:00.000Z',
      });
      await adapter.enqueueEnvio({
        examId: 'sim-2',
        code: '79507732',
        answers: { '1': 'B' },
        clientFinishedAt: '2026-06-11T12:05:00.000Z',
      });
      const ack = new SubmissionAck('ack-1', VALID_HASH, new Date('2026-06-11T12:10:00.000Z'));
      await adapter.setSubmissionAck('sim-1', ack);

      await adapter.clear();

      // Cola vacía…
      expect(await adapter.getEnviosPendientes()).toEqual([]);
      // …pero las marcaciones siguen ahí (las borra wipeUserScope, no clear).
      expect(await adapter.getMarcaciones('sim-1')).toEqual({ '1': 'A' });
      expect(await adapter.getMarcaciones('sim-2')).toEqual({ '1': 'B' });
      // El ack tampoco se borra con clear() — solo wipeUserScope hace eso.
      expect(await adapter.getSubmissionAck('sim-1')).not.toBeNull();
    });

    it('clear NO afecta la cola de otro usuario', async () => {
      identityStorage.setIdentity(makeIdentity('alumno-a@vonex.edu.pe'));
      await adapter.enqueueEnvio({
        examId: 'sim-1',
        code: '79507732',
        answers: { '1': 'A' },
        clientFinishedAt: '2026-06-11T12:00:00.000Z',
      });

      identityStorage.setIdentity(makeIdentity('alumno-b@vonex.edu.pe'));
      await adapter.enqueueEnvio({
        examId: 'sim-9',
        code: '79507732',
        answers: { '1': 'D' },
        clientFinishedAt: '2026-06-11T13:00:00.000Z',
      });
      await adapter.clear();

      // B vacío.
      expect(await adapter.getEnviosPendientes()).toEqual([]);
      // A sigue con su cola.
      identityStorage.setIdentity(makeIdentity('alumno-a@vonex.edu.pe'));
      expect(await adapter.getEnviosPendientes()).toHaveLength(1);
    });
  });

  describe('recuperación tras cierre de app', () => {
    it('marcaciones persisten al reabrir el adapter (mismo DB)', async () => {
      await adapter.setMarcacion('sim-1', 1, 'A');
      await adapter.setMarcacion('sim-1', 2, 'B');

      TestBed.resetTestingModule();
      const reopenedIdentity = new StubIdentityStorage();
      reopenedIdentity.setIdentity(makeIdentity('alumno-a@vonex.edu.pe'));
      TestBed.configureTestingModule({
        providers: [
          IndexedDbMarkingsStorage,
          { provide: IDENTITY_STORAGE, useValue: reopenedIdentity },
        ],
      });
      const reopened = TestBed.inject(IndexedDbMarkingsStorage);

      expect(await reopened.getMarcaciones('sim-1')).toEqual({ '1': 'A', '2': 'B' });
    });

    it('cola de envíos pendientes persiste al reabrir el adapter (incluyendo code)', async () => {
      await adapter.enqueueEnvio({
        examId: 'sim-1',
        code: '30303011',
        answers: { '1': 'A' },
        clientFinishedAt: '2026-06-11T12:00:00.000Z',
      });

      TestBed.resetTestingModule();
      const reopenedIdentity = new StubIdentityStorage();
      reopenedIdentity.setIdentity(makeIdentity('alumno-a@vonex.edu.pe'));
      TestBed.configureTestingModule({
        providers: [
          IndexedDbMarkingsStorage,
          { provide: IDENTITY_STORAGE, useValue: reopenedIdentity },
        ],
      });
      const reopened = TestBed.inject(IndexedDbMarkingsStorage);

      const pending = await reopened.getEnviosPendientes();
      expect(pending).toEqual([
        {
          examId: 'sim-1',
          code: '30303011',
          answers: { '1': 'A' },
          clientFinishedAt: '2026-06-11T12:00:00.000Z',
        },
      ]);
    });
  });
});
