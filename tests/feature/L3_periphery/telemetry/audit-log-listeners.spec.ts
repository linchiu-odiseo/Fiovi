// Feature tests de audit-log-listeners — cubre eventos VC, OF, AO, AI, DP.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AuditLogStore } from '../../../../src/L3_periphery/telemetry/audit-log-store.service';
import { installAuditLogListeners } from '../../../../src/L3_periphery/telemetry/audit-log-listeners';

const DB_NAME = 'fiovi-audit-log';
const STORES = ['events', 'meta'] as const;

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

async function flushMicrotasks(): Promise<void> {
  await new Promise((r) => setTimeout(r, 40));
}

describe('installAuditLogListeners', () => {
  beforeEach(async () => {
    await wipeDb();
    TestBed.configureTestingModule({ providers: [AuditLogStore] });
  });

  afterEach(async () => {
    await wipeDb();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('emits AO event at bootstrap', async () => {
    const store = TestBed.inject(AuditLogStore);
    installAuditLogListeners(store);
    await flushMicrotasks();

    const batch = await store.currentDayBatch();
    const ao = batch.find((e) => e.e === 'AO');
    expect(ao).toBeDefined();
    if (ao?.e === 'AO') {
      expect([0, 1]).toContain(ao.cold);
    }
  });

  it('emits DP event at bootstrap (1× per day)', async () => {
    const store = TestBed.inject(AuditLogStore);
    installAuditLogListeners(store);
    await flushMicrotasks();

    const batch = await store.currentDayBatch();
    const dps = batch.filter((e) => e.e === 'DP');
    expect(dps).toHaveLength(1);
    const dp = dps[0];
    if (dp?.e === 'DP') {
      expect(typeof dp.screen).toBe('string');
      expect(dp.screen).toMatch(/^\d+x\d+$/);
      expect(typeof dp.dpr).toBe('number');
    }
  });

  it('does NOT emit a second DP on subsequent install same day', async () => {
    const store = TestBed.inject(AuditLogStore);
    installAuditLogListeners(store);
    await flushMicrotasks();

    installAuditLogListeners(store); // segundo bootstrap simulado
    await flushMicrotasks();

    const batch = await store.currentDayBatch();
    const dps = batch.filter((e) => e.e === 'DP');
    expect(dps).toHaveLength(1); // sigue habiendo solo 1
  });

  it('emits VC on visibilitychange', async () => {
    const store = TestBed.inject(AuditLogStore);
    installAuditLogListeners(store);
    await flushMicrotasks();

    // Mock document.visibilityState = 'hidden' y disparo el evento.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await flushMicrotasks();

    const batch = await store.currentDayBatch();
    const vcs = batch.filter((e) => e.e === 'VC');
    expect(vcs.length).toBeGreaterThanOrEqual(1);
    const last = vcs[vcs.length - 1];
    if (last?.e === 'VC') {
      expect(last.v).toBe(0);
    }
  });

  it('emits OF on offline event', async () => {
    const store = TestBed.inject(AuditLogStore);
    installAuditLogListeners(store);
    await flushMicrotasks();

    window.dispatchEvent(new Event('offline'));
    await flushMicrotasks();

    const batch = await store.currentDayBatch();
    const of = batch.find((e) => e.e === 'OF');
    expect(of).toBeDefined();
    if (of?.e === 'OF') {
      expect(of.o).toBe(0);
    }
  });

  it('emits AI mode:prompt-accepted on appinstalled event', async () => {
    const store = TestBed.inject(AuditLogStore);
    installAuditLogListeners(store);
    await flushMicrotasks();

    window.dispatchEvent(new Event('appinstalled'));
    await flushMicrotasks();

    const batch = await store.currentDayBatch();
    const ai = batch.find((e) => e.e === 'AI' && e.mode === 'prompt-accepted');
    expect(ai).toBeDefined();
  });


  // Sub-bloque F.8 (design.md Revision Log 2026-09-04 iteration 2): AO.se se
  // lee de ?sso_error=X en la URL de bootstrap -- codigo conocido resuelve a
  // su id en SSO_ERROR_IDS, codigo desconocido resuelve a 0, y el campo esta
  // ausente cuando la URL no trae el param en absoluto.
  describe('AO.se (SSO error id)', () => {
    function withLocationSearch(search: string): () => void {
      const originalLocation = window.location;
      Object.defineProperty(window, 'location', {
        writable: true,
        configurable: true,
        value: { ...originalLocation, search },
      });
      return () => {
        Object.defineProperty(window, 'location', {
          writable: true,
          configurable: true,
          value: originalLocation,
        });
      };
    }

    it('includes se with the catalogued id when ?sso_error is a known code', async () => {
      const restore = withLocationSearch('?sso_error=access_denied');
      try {
        const store = TestBed.inject(AuditLogStore);
        installAuditLogListeners(store);
        await flushMicrotasks();

        const batch = await store.currentDayBatch();
        const ao = batch.find((e) => e.e === 'AO');
        if (ao?.e === 'AO') {
          expect(ao.se).toBe(1);
        } else {
          throw new Error('expected an AO event');
        }
      } finally {
        restore();
      }
    });

    it('includes se:0 when ?sso_error is an uncatalogued code', async () => {
      const restore = withLocationSearch('?sso_error=some_future_code');
      try {
        const store = TestBed.inject(AuditLogStore);
        installAuditLogListeners(store);
        await flushMicrotasks();

        const batch = await store.currentDayBatch();
        const ao = batch.find((e) => e.e === 'AO');
        if (ao?.e === 'AO') {
          expect(ao.se).toBe(0);
        } else {
          throw new Error('expected an AO event');
        }
      } finally {
        restore();
      }
    });

    it('omits se when the URL has no sso_error param', async () => {
      const restore = withLocationSearch('');
      try {
        const store = TestBed.inject(AuditLogStore);
        installAuditLogListeners(store);
        await flushMicrotasks();

        const batch = await store.currentDayBatch();
        const ao = batch.find((e) => e.e === 'AO');
        if (ao?.e === 'AO') {
          expect(ao.se).toBeUndefined();
        } else {
          throw new Error('expected an AO event');
        }
      } finally {
        restore();
      }
    });
  });
});
