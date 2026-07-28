// Tests del adapter L3 `IndexedDbTutorActivityStorage`.
//
// Comparte la DB `fiovi-cartilla` con `IndexedDbMarkingsStorage` — el
// prefijo `cartilla.<email>.tutor-activity.<eventId>` mantiene el scope
// aislado del resto (acks, marcaciones, queue).
//
// `fake-indexeddb/auto` reemplaza `globalThis.indexedDB` al importarse.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { IndexedDbTutorActivityStorage } from '../../../../src/L3_periphery/storage/indexed-db-tutor-activity-storage';
import { IDENTITY_STORAGE } from '../../../../src/L3_periphery/tokens';
import { IdentityStorage } from '../../../../src/L1_domain/ports/identity-storage';
import { Identity } from '../../../../src/L1_domain/entities/identity';
import { TutorActivityEvent } from '../../../../src/L1_domain/value-objects/tutor-activity-event';
import { OfflineStorageUnavailableError } from '../../../../src/L1_domain/errors/offline-storage-unavailable.error';

const DB_NAME = 'fiovi-cartilla';

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
    'DNI-01',
    ['tutor'],
    Date.now() + 900_000,
  );
}

function buildEvent(overrides: Partial<TutorActivityEvent> = {}): TutorActivityEvent {
  return {
    id: 'ev-1',
    recordId: 'rec-1',
    examName: 'Anatomía sem1',
    courseName: 'Anatomía',
    finalizedAt: new Date('2026-07-27T10:47:00.000Z'),
    archived: false,
    ...overrides,
  };
}

const STORE = 'data';

// Vacía el único object store entre tests. NO usa deleteDatabase para no
// bloquearse por conexiones abiertas del adapter singleton.
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
      const req = tx.objectStore(STORE).clear();
      req.onsuccess = () => {
        db.close();
        resolve();
      };
      req.onerror = () => {
        db.close();
        reject(req.error);
      };
    };
    openReq.onerror = () => reject(openReq.error);
  });
}

describe('IndexedDbTutorActivityStorage', () => {
  let adapter: IndexedDbTutorActivityStorage;
  let identityStorage: StubIdentityStorage;

  beforeEach(async () => {
    await wipeAllKeys();
    TestBed.resetTestingModule();
    identityStorage = new StubIdentityStorage();
    identityStorage.setIdentity(makeIdentity('tutor-a@vonex.pe'));
    TestBed.configureTestingModule({
      providers: [
        IndexedDbTutorActivityStorage,
        { provide: IDENTITY_STORAGE, useValue: identityStorage },
      ],
    });
    adapter = TestBed.inject(IndexedDbTutorActivityStorage);
  });

  afterEach(async () => {
    await wipeAllKeys();
  });

  describe('append + list round-trip', () => {
    it('append persiste el evento y list lo devuelve reconstruido', async () => {
      await adapter.append(buildEvent());

      const events = await adapter.list();
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('ev-1');
      expect(events[0].examName).toBe('Anatomía sem1');
      expect(events[0].courseName).toBe('Anatomía');
      expect(events[0].finalizedAt.getTime()).toBe(
        new Date('2026-07-27T10:47:00.000Z').getTime(),
      );
      expect(events[0].archived).toBe(false);
    });

    it('list retorna array vacío cuando no hay eventos persistidos', async () => {
      expect(await adapter.list()).toEqual([]);
    });

    it('append idempotente por id — segundo write sobrescribe (no duplica)', async () => {
      await adapter.append(buildEvent({ id: 'e1', examName: 'Original' }));
      await adapter.append(buildEvent({ id: 'e1', examName: 'Sobrescrito' }));

      const events = await adapter.list();
      expect(events).toHaveLength(1);
      expect(events[0].examName).toBe('Sobrescrito');
    });
  });

  describe('archive', () => {
    it('archive marca archived=true sin remover el registro', async () => {
      await adapter.append(buildEvent({ id: 'e1' }));

      await adapter.archive('e1');

      const events = await adapter.list();
      expect(events).toHaveLength(1);
      expect(events[0].archived).toBe(true);
    });

    it('archive es no-op si el eventId no existe', async () => {
      await expect(adapter.archive('inexistente')).resolves.toBeUndefined();
      expect(await adapter.list()).toEqual([]);
    });
  });

  describe('wipeUserScope', () => {
    it('borra todos los eventos del usuario actual', async () => {
      await adapter.append(buildEvent({ id: 'e1' }));
      await adapter.append(buildEvent({ id: 'e2' }));

      await adapter.wipeUserScope();

      expect(await adapter.list()).toEqual([]);
    });

    it('sin identity → no-op (no throw)', async () => {
      identityStorage.setIdentity(null);
      await expect(adapter.wipeUserScope()).resolves.toBeUndefined();
    });

    it('scope por usuario: no borra los eventos de otro tutor bajo el mismo IDB', async () => {
      await adapter.append(buildEvent({ id: 'tutor-a-ev' }));

      // Cambio de identity: mismo storage, otro usuario.
      TestBed.resetTestingModule();
      const otroIdentity = new StubIdentityStorage();
      otroIdentity.setIdentity(makeIdentity('tutor-b@vonex.pe'));
      TestBed.configureTestingModule({
        providers: [
          IndexedDbTutorActivityStorage,
          { provide: IDENTITY_STORAGE, useValue: otroIdentity },
        ],
      });
      const otroAdapter = TestBed.inject(IndexedDbTutorActivityStorage);
      await otroAdapter.append(buildEvent({ id: 'tutor-b-ev' }));

      // El tutor B wipea → solo se lleva los suyos.
      await otroAdapter.wipeUserScope();
      expect(await otroAdapter.list()).toEqual([]);

      // Tutor A sigue teniendo sus eventos.
      TestBed.resetTestingModule();
      const tutorAIdentity = new StubIdentityStorage();
      tutorAIdentity.setIdentity(makeIdentity('tutor-a@vonex.pe'));
      TestBed.configureTestingModule({
        providers: [
          IndexedDbTutorActivityStorage,
          { provide: IDENTITY_STORAGE, useValue: tutorAIdentity },
        ],
      });
      const tutorAAdapter = TestBed.inject(IndexedDbTutorActivityStorage);
      const events = await tutorAAdapter.list();
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('tutor-a-ev');
    });
  });

  describe('errores', () => {
    it('append sin identity rechaza con OfflineStorageUnavailableError', async () => {
      identityStorage.setIdentity(null);
      await expect(adapter.append(buildEvent())).rejects.toBeInstanceOf(
        OfflineStorageUnavailableError,
      );
    });

    it('list sin identity rechaza con OfflineStorageUnavailableError', async () => {
      identityStorage.setIdentity(null);
      await expect(adapter.list()).rejects.toBeInstanceOf(OfflineStorageUnavailableError);
    });
  });
});
