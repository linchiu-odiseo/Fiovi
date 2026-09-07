// Feature tests del AuditLogStore — cubre append, filtrado por día, retención
// multi-día con techo de edad, y comportamiento fire-and-forget ante errores
// de IDB.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AuditLogStore } from '../../../../src/L3_periphery/telemetry/audit-log-store.service';
import { startOfTodayLocalMs } from '../../../../src/L3_periphery/telemetry/day-key';

// Timestamps anclados al día local real, porque `currentDayBatch` filtra por
// las 00:00 locales. Un `t: 1000` (enero de 1970) nunca es "hoy".
const TODAY_AM = startOfTodayLocalMs() + 60_000;
const YESTERDAY_PM = startOfTodayLocalMs() - 60_000;
const LONG_EXPIRED = Date.now() - 8 * 24 * 60 * 60 * 1000; // más de los 7 días de techo

// Lee TODO el store sin filtrar por día — para aseverar sobre lo retenido de
// días anteriores, que es justamente lo que `currentDayBatch` esconde.
function readAll(store: AuditLogStore) {
  return store.eventsInRange(0, Number.MAX_SAFE_INTEGER);
}

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
    store.append({ t: TODAY_AM, e: 'AO', cold: 1 });
    await flushMicrotasks();

    const batch = await store.currentDayBatch();
    expect(batch).toHaveLength(1);
    expect(batch[0]).toMatchObject({ e: 'AO', cold: 1, t: TODAY_AM });
  });

  it('currentDayBatch returns events in chronological insertion order', async () => {
    const store = TestBed.inject(AuditLogStore);
    store.append({ t: TODAY_AM, e: 'AO', cold: 1 });
    await flushMicrotasks();
    store.append({ t: TODAY_AM + 100, e: 'VC', v: 0 });
    await flushMicrotasks();
    store.append({ t: TODAY_AM + 200, e: 'VC', v: 1 });
    await flushMicrotasks();

    const batch = await store.currentDayBatch();
    expect(batch.map((e) => e.t)).toEqual([TODAY_AM, TODAY_AM + 100, TODAY_AM + 200]);
  });

  // El test que más importa de todo el archivo. El modelo viejo borraba el
  // store entero en el primer append del día nuevo, y como los listeners
  // emiten un AO al arrancar la app, lo de ayer moría antes de que el
  // dispatcher tuviera oportunidad de subirlo. Escenario real: el alumno
  // cierra a las 6pm y abre a las 8am del día siguiente.
  it('NO borra lo pendiente de ayer cuando cambia el día', async () => {
    const store = TestBed.inject(AuditLogStore);
    store.append({ t: YESTERDAY_PM, e: 'VC', v: 0 });
    await flushMicrotasks();

    // Simula que la app se abre al día siguiente: el day-key guardado quedó
    // viejo y el primer append del arranque es el AO de los listeners.
    await writeMetaDayKey('1999-01-01');
    store.append({ t: TODAY_AM, e: 'AO', cold: 1 });
    await flushMicrotasks();

    const all = await readAll(store);
    expect(all.map((e) => e.t)).toEqual([YESTERDAY_PM, TODAY_AM]);
  });

  it('currentDayBatch esconde los eventos de días anteriores', async () => {
    const store = TestBed.inject(AuditLogStore);
    store.append({ t: YESTERDAY_PM, e: 'VC', v: 0 });
    store.append({ t: TODAY_AM, e: 'AO', cold: 1 });
    await flushMicrotasks();

    // La descarga manual es "los logs de hoy", y el chequeo de "¿ya emití DP
    // hoy?" de los listeners depende de esto: sin el filtro daría true para
    // siempre y esos eventos se apagarían a partir del segundo día.
    const batch = await store.currentDayBatch();
    expect(batch.map((e) => e.t)).toEqual([TODAY_AM]);
  });

  it('eventsInRange sí ve días anteriores — es lo que consume la subida', async () => {
    const store = TestBed.inject(AuditLogStore);
    store.append({ t: YESTERDAY_PM, e: 'VC', v: 0 });
    store.append({ t: TODAY_AM, e: 'AO', cold: 1 });
    await flushMicrotasks();

    const range = await store.eventsInRange(YESTERDAY_PM, TODAY_AM + 1);
    expect(range.map((e) => e.t)).toEqual([YESTERDAY_PM, TODAY_AM]);
  });

  describe('techo de retención', () => {
    it('pruneExpired borra lo más viejo que el techo y deja el resto', async () => {
      const store = TestBed.inject(AuditLogStore);
      store.append({ t: LONG_EXPIRED, e: 'VC', v: 0 });
      store.append({ t: YESTERDAY_PM, e: 'VC', v: 1 });
      store.append({ t: TODAY_AM, e: 'AO', cold: 1 });
      await flushMicrotasks();

      await store.pruneExpired();

      const all = await readAll(store);
      expect(all.map((e) => e.t)).toEqual([YESTERDAY_PM, TODAY_AM]);
    });

    it('el cambio de día dispara la poda del vencido', async () => {
      const store = TestBed.inject(AuditLogStore);
      store.append({ t: LONG_EXPIRED, e: 'VC', v: 0 });
      await flushMicrotasks();

      await writeMetaDayKey('1999-01-01');
      store.append({ t: TODAY_AM, e: 'AO', cold: 1 });
      await flushMicrotasks();

      const all = await readAll(store);
      expect(all.map((e) => e.t)).toEqual([TODAY_AM]);
    });
  });
});
