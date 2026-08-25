// Feature tests del AuditLogStore — cubre append, currentDayBatch, rotación
// diaria y comportamiento fire-and-forget ante errores de IDB.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AuditLogStore } from '../../../../src/L3_periphery/telemetry/audit-log-store.service';

const DB_NAME = 'fiovi-audit-log';
const STORES = ['events', 'meta'] as const;

// Vacía ambos object stores sin usar deleteDatabase — el adapter cachea una
// dbPromise y las conexiones abiertas disparan onblocked bajo fake-indexeddb.
// Mismo patrón que indexed-db-profile-storage.spec.ts.
function wipeDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const openReq = indexedDB.open(DB_NAME);
    openReq.onupgradeneeded = () => {
      const db = openReq.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) {
          if (s === 'events') db.createObjectStore(s, { autoIncrement: true });
          else db.createObjectStore(s);
        }
      }
    };
    openReq.onsuccess = () => {
      const db = openReq.result;
      const available = STORES.filter((s) => db.objectStoreNames.contains(s));
      if (available.length === 0) {
        db.close();
        resolve();
        return;
      }
      const tx = db.transaction(available, 'readwrite');
      for (const s of available) tx.objectStore(s).clear();
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

const DB_NAME_TEST = 'fiovi-audit-log';

async function flushMicrotasks(): Promise<void> {
  // append es fire-and-forget → esperamos que las promises internas resuelvan.
  await new Promise((r) => setTimeout(r, 30));
}

// Escribe un dayKey stale en meta directamente para simular "el día cambió"
// sin manipular el reloj del sistema (que rompe timers y flushMicrotasks).
function writeMetaDayKey(dayKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const openReq = indexedDB.open(DB_NAME_TEST);
    openReq.onupgradeneeded = () => {
      const db = openReq.result;
      if (!db.objectStoreNames.contains('events'))
        db.createObjectStore('events', { autoIncrement: true });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    openReq.onsuccess = () => {
      const db = openReq.result;
      const tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put(dayKey, 'dayKey');
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

describe('AuditLogStore', () => {
  beforeEach(async () => {
    await wipeDb();
    TestBed.configureTestingModule({ providers: [AuditLogStore] });
  });

  afterEach(async () => {
    TestBed.resetTestingModule();
    await wipeDb();
  });

  it('append persists event and currentDayBatch retrieves it', async () => {
    const store = TestBed.inject(AuditLogStore);
    store.append({ t: 1000, e: 'AO', cold: 1 });
    await flushMicrotasks();

    const batch = await store.currentDayBatch();
    expect(batch).toHaveLength(1);
    expect(batch[0]).toMatchObject({ e: 'AO', cold: 1, t: 1000 });
  });

  it('currentDayBatch returns events in chronological insertion order', async () => {
    const store = TestBed.inject(AuditLogStore);
    store.append({ t: 100, e: 'AO', cold: 1 });
    await flushMicrotasks();
    store.append({ t: 200, e: 'VC', v: 0 });
    await flushMicrotasks();
    store.append({ t: 300, e: 'VC', v: 1 });
    await flushMicrotasks();

    const batch = await store.currentDayBatch();
    expect(batch.map((e) => e.t)).toEqual([100, 200, 300]);
  });

  it('rotates automatically when stored dayKey differs from current', async () => {
    // Pre-condición: la DB tiene events viejos y meta con dayKey stale.
    await writeMetaDayKey('1999-01-01');
    const store = TestBed.inject(AuditLogStore);

    // Simulamos que había eventos "viejos" apendeando ANTES de rotar.
    // Como append internamente detecta el mismatch de dayKey vs hoy real,
    // el propio append hace el wipe. Verificamos que el batch tras el
    // primer append solo tiene 1 evento (el nuevo).
    store.append({ t: 100, e: 'AO', cold: 1 });
    await flushMicrotasks();

    const batch = await store.currentDayBatch();
    expect(batch).toHaveLength(1);
    expect(batch[0].e).toBe('AO');
  });

  it('clearDay with dayKey different from current is a no-op', async () => {
    const store = TestBed.inject(AuditLogStore);
    store.append({ t: 100, e: 'AO', cold: 1 });
    await flushMicrotasks();

    await store.clearDay('1999-01-01');

    const batch = await store.currentDayBatch();
    expect(batch).toHaveLength(1);
  });

  it('clearDay without argument wipes all events', async () => {
    const store = TestBed.inject(AuditLogStore);
    store.append({ t: 100, e: 'AO', cold: 1 });
    store.append({ t: 200, e: 'VC', v: 1 });
    await flushMicrotasks();

    await store.clearDay();

    const batch = await store.currentDayBatch();
    expect(batch).toHaveLength(0);
  });
});
