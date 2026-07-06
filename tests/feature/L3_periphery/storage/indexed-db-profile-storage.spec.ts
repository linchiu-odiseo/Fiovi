// Tests del adapter L3 `IndexedDbProfileStorage` — cache de perfiles por rol.
//
// Cubre los scenarios del spec `auth-profile` y `session-storage`:
// - write + read fresh devuelve `{profile, cachedAt}`
// - scopes separados por rol (`profile.student` vs `profile.tutor`)
// - read sin write previo → null
// - clear() limpia ambos roles
// - reemplazo: segundo write sobre el mismo rol pisa al primero
// - cachedAt lo setea el storage internamente (no se acepta como argumento)
//
// `fake-indexeddb/auto` reemplaza `globalThis.indexedDB` al importarse.
// Cada test vacía el único object store en beforeEach/afterEach para
// aislamiento.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { IndexedDbProfileStorage } from '../../../../src/L3_periphery/storage/indexed-db-profile-storage';
import { StudentProfile } from '../../../../src/L1_domain/value-objects/student-profile';
import { TutorProfile } from '../../../../src/L1_domain/value-objects/tutor-profile';

const DB_NAME = 'fiovi-profile';
const STORE = 'profile';

const STUDENT: StudentProfile = {
  id: '573e8dfa-faf4-4846-b05f-14143710515d',
  code: '79507732',
  firstName: 'Gabriel',
  lastName: 'Acuña Acuña',
  area: null,
};

const TUTOR: TutorProfile = {
  id: '19cabb89-c81d-4882-91be-3ab0e1414fae',
  code: 'T001',
  firstName: 'Carlos',
  lastName: 'Mendoza',
  email: 'tutor1@vonex.pe',
  classrooms: [
    {
      id: 'a957e020-14d6-41fb-af47-c52531d10b41',
      code: 'LIMA0001',
      name: 'Lima 01',
      modality: 'presencial',
      shift: 'manana',
      campusName: 'Lima Cercado',
      cycleId: 'e720709f-f499-4c77-974b-a4854bdd9632',
      cycleName: 'San Marcos - Semi Anual 0326',
      studentCount: 60,
    },
    {
      id: '5741e2db-a339-4466-99e5-1a4eb1d4339f',
      code: 'LIMA0002',
      name: 'Lima 02',
      modality: 'presencial',
      shift: 'manana',
      campusName: 'Lima San Juan De Lurigancho',
      cycleId: 'e720709f-f499-4c77-974b-a4854bdd9632',
      cycleName: 'San Marcos - Semi Anual 0326',
      studentCount: 60,
    },
  ],
};

// Vacía el único object store entre tests. Similar al patrón ya usado
// en `markings-storage.spec.ts` — evitamos `deleteDatabase` porque el
// adapter cachea una `dbPromise` y bajo fake-indexeddb las conexiones
// abiertas disparan `onblocked` indefinidamente.
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

describe('IndexedDbProfileStorage', () => {
  let adapter: IndexedDbProfileStorage;

  beforeEach(async () => {
    await wipeAllKeys();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [IndexedDbProfileStorage],
    });
    adapter = TestBed.inject(IndexedDbProfileStorage);
  });

  afterEach(async () => {
    await wipeAllKeys();
  });

  describe('write + read (round-trip)', () => {
    it('student: write + read devuelve CachedProfile con cachedAt cercano a Date.now()', async () => {
      const t0 = Date.now();
      await adapter.write('student', STUDENT);
      const cached = await adapter.read('student');
      const t1 = Date.now();

      expect(cached).not.toBeNull();
      expect(cached?.profile).toEqual(STUDENT);
      // El storage setea `cachedAt` internamente con Date.now(). Verificamos
      // que cae en el intervalo [t0, t1] del test (tolerante a la velocidad
      // del runner).
      expect(cached?.cachedAt).toBeGreaterThanOrEqual(t0);
      expect(cached?.cachedAt).toBeLessThanOrEqual(t1);
    });

    it('tutor: write + read devuelve el profile con las 2 aulas', async () => {
      await adapter.write('tutor', TUTOR);
      const cached = await adapter.read('tutor');
      expect(cached).not.toBeNull();
      expect(cached?.profile).toEqual(TUTOR);
      const profile = cached?.profile as TutorProfile;
      expect(profile.classrooms.length).toBe(2);
      expect(profile.classrooms[0].name).toBe('Lima 01');
    });
  });

  describe('read sin write previo', () => {
    it('student: devuelve null', async () => {
      expect(await adapter.read('student')).toBeNull();
    });

    it('tutor: devuelve null', async () => {
      expect(await adapter.read('tutor')).toBeNull();
    });
  });

  describe('scopes separados por rol', () => {
    it('write student no afecta a tutor (y vice versa)', async () => {
      await adapter.write('student', STUDENT);
      // Tutor NO debería ver el profile del student.
      expect(await adapter.read('tutor')).toBeNull();
      // Student sí lo ve.
      const s = await adapter.read('student');
      expect(s?.profile).toEqual(STUDENT);

      // Ahora también escribimos un tutor y verificamos que ambos coexisten.
      await adapter.write('tutor', TUTOR);
      const t = await adapter.read('tutor');
      expect(t?.profile).toEqual(TUTOR);
      const sAgain = await adapter.read('student');
      expect(sAgain?.profile).toEqual(STUDENT);
    });
  });

  describe('clear', () => {
    it('limpia ambos roles', async () => {
      await adapter.write('student', STUDENT);
      await adapter.write('tutor', TUTOR);
      await adapter.clear();
      expect(await adapter.read('student')).toBeNull();
      expect(await adapter.read('tutor')).toBeNull();
    });
  });

  describe('reemplazo en write sucesivo', () => {
    it('segundo write con datos distintos pisa al primero', async () => {
      await adapter.write('student', STUDENT);
      const updated: StudentProfile = { ...STUDENT, firstName: 'Gabriel M.' };
      await adapter.write('student', updated);
      const cached = await adapter.read('student');
      expect(cached?.profile).toEqual(updated);
    });
  });
});
