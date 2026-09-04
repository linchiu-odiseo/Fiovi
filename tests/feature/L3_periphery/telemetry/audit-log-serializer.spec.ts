// Feature tests del AuditLogSerializer — cubre el flujo del botón "Descargar
// logs" del profile: batch vacío muestra toast informativo sin descargar; batch
// con eventos serializa a NDJSON y dispara descarga via anchor.click().
//
// Sub-bloque F (design.md § Revision Log 2026-09-04 iteration 2 — "senior
// format"): el batching agrupa por (e, s?, u?) sin ventana de tiempo, con
// t0/dt + auto-hoist de campos constantes. Ver también
// `parseBatchedNdjson` — su inversa exacta — probada acá con el test de
// reversibilidad, el más importante de este archivo.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AuditLogStore } from '../../../../src/L3_periphery/telemetry/audit-log-store.service';
import {
  AuditLogSerializer,
  serializeToNdjson,
  serializeBatchedNdjson,
  parseBatchedNdjson,
} from '../../../../src/L3_periphery/telemetry/audit-log-serializer';
import type { AuditLogEvent } from '../../../../src/L3_periphery/telemetry/audit-log-event';

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
  await new Promise((r) => setTimeout(r, 20));
}

describe('serializeToNdjson', () => {
  it('returns empty string for empty batch', () => {
    expect(serializeToNdjson([])).toBe('');
  });

  it('serializes each event as one JSON line terminated by \\n', () => {
    const events: AuditLogEvent[] = [
      { t: 1, e: 'AO', cold: 1 },
      { t: 2, e: 'VC', v: 0 },
    ];
    const out = serializeToNdjson(events);
    const lines = out.split('\n');
    // Última línea es vacía por el trailing \n.
    expect(lines[lines.length - 1]).toBe('');
    expect(JSON.parse(lines[0])).toEqual(events[0]);
    expect(JSON.parse(lines[1])).toEqual(events[1]);
  });

  it('does not wrap output in a JSON array', () => {
    const out = serializeToNdjson([{ t: 1, e: 'AO', cold: 1 }]);
    expect(out.startsWith('[')).toBe(false);
    expect(out.trimEnd().endsWith(']')).toBe(false);
  });
});

describe('AuditLogSerializer.downloadCurrentDay', () => {
  let alertSpy: ReturnType<typeof vi.spyOn>;
  let anchorClickSpy: ReturnType<typeof vi.fn>;
  let createUrlSpy: ReturnType<typeof vi.spyOn>;
  let createElementSpy: ReturnType<typeof vi.spyOn>;
  let appendChildSpy: ReturnType<typeof vi.spyOn>;
  let removeChildSpy: ReturnType<typeof vi.spyOn>;
  let fakeAnchor: HTMLAnchorElement;

  beforeEach(async () => {
    await wipeDb();
    TestBed.configureTestingModule({ providers: [AuditLogStore, AuditLogSerializer] });
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {
      /* noop */
    });
    anchorClickSpy = vi.fn();
    fakeAnchor = {
      href: '',
      download: '',
      click: anchorClickSpy,
    } as unknown as HTMLAnchorElement;
    createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') return fakeAnchor;
      return {} as HTMLElement;
    });
    appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((n: Node) => n);
    removeChildSpy = vi.spyOn(document.body, 'removeChild').mockImplementation((n: Node) => n);
    createUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {
      /* noop */
    });
  });

  afterEach(async () => {
    await wipeDb();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('shows alert and does not trigger download when batch is empty', async () => {
    const serializer = TestBed.inject(AuditLogSerializer);
    await serializer.downloadCurrentDay();

    expect(alertSpy).toHaveBeenCalledWith('Sin logs para hoy');
    expect(createUrlSpy).not.toHaveBeenCalled();
    expect(anchorClickSpy).not.toHaveBeenCalled();
  });

  it('triggers download with fiovi-audit-YYYY-MM-DD.ndjson filename when batch has events', async () => {
    const store = TestBed.inject(AuditLogStore);
    store.append({ t: 1, e: 'AO', cold: 1 });
    store.append({ t: 2, e: 'VC', v: 1 });
    await flushMicrotasks();

    const serializer = TestBed.inject(AuditLogSerializer);
    await serializer.downloadCurrentDay();

    expect(createUrlSpy).toHaveBeenCalledTimes(1);
    expect(createElementSpy).toHaveBeenCalledWith('a');
    expect(fakeAnchor.download).toMatch(/^fiovi-audit-\d{4}-\d{2}-\d{2}\.ndjson$/);
    expect(fakeAnchor.href).toBe('blob:mock-url');
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    expect(appendChildSpy).toHaveBeenCalled();
    expect(removeChildSpy).toHaveBeenCalled();
  });
});

// Sub-bloque F — collapse-by-(e,s?,u?) + t0/dt + auto-hoist (design.md §
// Revision Log 2026-09-04 iteration 2). `AuditLogStore.append` no cambia —
// el agrupamiento es read-side, exclusivo de `AuditLogSerializer`.
function parseNdjson(out: string): Record<string, unknown>[] {
  return out
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

describe('serializeBatchedNdjson', () => {
  it('returns empty string for empty batch', () => {
    expect(serializeBatchedNdjson([])).toBe('');
  });

  it('groups H events by (e, s, u) — drafts (u:22) and submits (u:21) end up in different groups', () => {
    const events: AuditLogEvent[] = [
      { t: 1000, e: 'H', m: 2, u: 22, st: 204, dur: 640, s: 'sess-1' },
      { t: 1500, e: 'H', m: 2, u: 22, st: 204, dur: 316, s: 'sess-1' },
      { t: 2000, e: 'H', m: 2, u: 21, st: 200, dur: 500, s: 'sess-1' },
    ];

    const lines = parseNdjson(serializeBatchedNdjson(events));

    expect(lines).toHaveLength(2);
    const draftLine = lines.find((l) => l['u'] === 22)!;
    const submitLine = lines.find((l) => l['u'] === 21)!;
    expect((draftLine['x'] as unknown[]).length).toBe(2);
    expect((submitLine['x'] as unknown[]).length).toBe(1);
  });

  it('hoists fields with identical values across all entries to the group level', () => {
    const events: AuditLogEvent[] = [
      { t: 1000, e: 'H', m: 2, u: 22, st: 204, dur: 640, s: 'sess-1' },
      { t: 1500, e: 'H', m: 2, u: 22, st: 204, dur: 316, s: 'sess-1' },
    ];

    const lines = parseNdjson(serializeBatchedNdjson(events));
    expect(lines).toHaveLength(1);
    const [line] = lines;
    // m:2 y st:204 son idénticos en ambas entradas → se hoistean al grupo.
    expect(line['m']).toBe(2);
    expect(line['st']).toBe(204);
    const x = line['x'] as Record<string, unknown>[];
    expect(x[0]['m']).toBeUndefined();
    expect(x[0]['st']).toBeUndefined();
    // dur difiere entre entradas → queda per-entry, no se hoistea.
    expect(line['dur']).toBeUndefined();
    expect(x[0]['dur']).toBe(640);
    expect(x[1]['dur']).toBe(316);
  });

  it('computes t0 as the min timestamp of the group and dt as the delta from t0', () => {
    const events: AuditLogEvent[] = [
      { t: 5000, e: 'AO', cold: 1 },
      { t: 5300, e: 'AO', cold: 1 },
      { t: 4800, e: 'AO', cold: 1 },
    ];

    const lines = parseNdjson(serializeBatchedNdjson(events));
    expect(lines).toHaveLength(1);
    const [line] = lines;
    expect(line['t0']).toBe(4800);
    const x = line['x'] as Record<string, unknown>[];
    const dts = x.map((e) => e['dt']).sort((a, b) => (a as number) - (b as number));
    expect(dts).toEqual([0, 200, 500]);
  });

  it('keeps heterogeneous fields (st, d, chg) per-entry when they vary across the group', () => {
    const events: AuditLogEvent[] = [
      { t: 1000, e: 'H', m: 2, u: 22, st: 204, dur: 640, s: 'sess-1', d: 4, chg: [] },
      { t: 1500, e: 'H', m: 2, u: 22, st: 500, dur: 300, s: 'sess-1', d: 3, chg: [[1, 'B']] },
    ];

    const lines = parseNdjson(serializeBatchedNdjson(events));
    expect(lines).toHaveLength(1);
    const [line] = lines;
    expect(line['st']).toBeUndefined();
    expect(line['d']).toBeUndefined();
    expect(line['chg']).toBeUndefined();
    const x = line['x'] as Record<string, unknown>[];
    expect(x[0]).toMatchObject({ st: 204, d: 4, chg: [] });
    expect(x[1]).toMatchObject({ st: 500, d: 3, chg: [[1, 'B']] });
  });

  it('emits singleton groups in batched form (x present, not flattened to a plain event)', () => {
    const events: AuditLogEvent[] = [{ t: 1788469897331, e: 'H', m: 1, u: 12, st: 200, dur: 997 }];

    const lines = parseNdjson(serializeBatchedNdjson(events));
    expect(lines).toHaveLength(1);
    const [line] = lines;
    // Never flattened to a bare event — always the {e,u,t0,...,x} shape.
    expect(line['e']).toBe('H');
    expect(line['u']).toBe(12);
    expect(line['t0']).toBe(1788469897331);
    expect(Array.isArray(line['x'])).toBe(true);
    // A single-entry group trivially satisfies "same value in all entries"
    // for every remaining field, so auto-hoist promotes m/st/dur to the
    // group level too — x collapses to just the delta.
    expect(line['m']).toBe(1);
    expect(line['st']).toBe(200);
    expect(line['dur']).toBe(997);
    expect(line['x']).toEqual([{ dt: 0 }]);
    // Round-trip still reproduces the exact original event.
    expect(parseBatchedNdjson(serializeBatchedNdjson(events))).toEqual(events);
  });

  it('does not group across different sessions even with the same event type', () => {
    const events: AuditLogEvent[] = [
      { t: 1000, e: 'H', m: 1, u: 5, st: 200, dur: 10, s: 'sess-1' },
      { t: 1100, e: 'H', m: 1, u: 5, st: 200, dur: 12, s: 'sess-2' },
    ];

    const lines = parseNdjson(serializeBatchedNdjson(events));
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l['s']).sort()).toEqual(['sess-1', 'sess-2']);
  });

  it('groups sessionless events (e.g. AO) by event type alone, regardless of time gap', () => {
    const events: AuditLogEvent[] = [
      { t: 5000, e: 'AO', cold: 1 },
      { t: 5000 + 999_999, e: 'AO', cold: 0 },
    ];

    const lines = parseNdjson(serializeBatchedNdjson(events));
    expect(lines).toHaveLength(1);
    expect((lines[0]['x'] as unknown[]).length).toBe(2);
  });

  // --- reversibilidad (el test más importante de este archivo) ---

  it('round-trips: parseBatchedNdjson(serializeBatchedNdjson(events)) returns the original events', () => {
    const events: AuditLogEvent[] = [
      { t: 1000, e: 'H', m: 2, u: 22, st: 204, dur: 640, s: 'sess-1', d: 4, v: 1, chg: [] },
      { t: 1500, e: 'H', m: 2, u: 22, st: 204, dur: 316, s: 'sess-1', d: 3, v: 2, chg: [[1, 'B']] },
      { t: 2000, e: 'H', m: 2, u: 21, st: 200, dur: 500, s: 'sess-1' },
      { t: 2100, e: 'H', m: 1, u: 12, st: 200, dur: 997 },
      { t: 2200, e: 'H', m: 1, u: 20, st: 429, dur: 50, c: 90 },
      { t: 3000, e: 'VC', v: 0 },
      { t: 3200, e: 'VC', v: 1 },
      { t: 4000, e: 'AO', cold: 1 },
      { t: 4001, e: 'AO', cold: 0, se: 1 },
      { t: 4500, e: 'OF', o: 0 },
      { t: 5000, e: 'SS', s: 'sess-2' },
      { t: 5100, e: 'SS', s: 'sess-3' },
      { t: 5200, e: 'AS', s: 'sess-2' },
      { t: 6000, e: 'NW', u: 22, s: 'sess-1' },
      { t: 6100, e: 'NW', u: 5 },
      { t: 7000, e: 'RT', st: 200 },
      { t: 7100, e: 'RT', st: 401, c: 8 },
      { t: 8000, e: 'AI', mode: 'standalone' },
      { t: 8100, e: 'AI', mode: 'prompt-accepted' },
      {
        t: 9000,
        e: 'DP',
        ram: 4,
        cores: 8,
        screen: '390x844',
        dpr: 3,
      },
    ];

    const ndjson = serializeBatchedNdjson(events);
    const roundTripped = parseBatchedNdjson(ndjson);

    const sortedOriginal = [...events].sort((a, b) => a.t - b.t);
    expect(roundTripped).toEqual(sortedOriginal);
  });

  it('round-trips a single event', () => {
    const events: AuditLogEvent[] = [{ t: 42, e: 'VC', v: 1 }];
    expect(parseBatchedNdjson(serializeBatchedNdjson(events))).toEqual(events);
  });

  it('parseBatchedNdjson returns empty array for empty input', () => {
    expect(parseBatchedNdjson('')).toEqual([]);
  });
});

describe('AuditLogSerializer.serializeSlice', () => {
  beforeEach(async () => {
    await wipeDb();
    TestBed.configureTestingModule({ providers: [AuditLogStore, AuditLogSerializer] });
  });

  afterEach(async () => {
    await wipeDb();
    TestBed.resetTestingModule();
  });

  it('returns only events within [sinceMs, untilMs) with a generated batchId', async () => {
    const store = TestBed.inject(AuditLogStore);
    store.append({ t: 100, e: 'AO', cold: 1 });
    store.append({ t: 5000, e: 'VC', v: 1 });
    store.append({ t: 9000, e: 'VC', v: 0 });
    await flushMicrotasks();

    const serializer = TestBed.inject(AuditLogSerializer);
    const result = await serializer.serializeSlice(1000, 9500);

    expect(result.eventCount).toBe(2);
    expect(result.batchId.length === 36 || result.batchId.length >= 26).toBe(true);
    const lines = parseNdjson(result.payload);
    // VC t:5000 y VC t:9000 comparten (e:'VC') sin `s`/`u` → un solo grupo.
    expect(lines).toHaveLength(1);
    expect((lines[0]['x'] as unknown[]).length).toBe(2);
    expect(result.bytesRaw).toBeGreaterThan(0);
    expect(result.bytesRaw).toBe(new Blob([result.payload]).size);
  });

  it('returns eventCount 0 and empty payload for an empty range', async () => {
    const store = TestBed.inject(AuditLogStore);
    store.append({ t: 100, e: 'AO', cold: 1 });
    await flushMicrotasks();

    const serializer = TestBed.inject(AuditLogSerializer);
    const result = await serializer.serializeSlice(50_000, 60_000);

    expect(result.eventCount).toBe(0);
    expect(result.payload).toBe('');
    expect(result.bytesRaw).toBe(0);
    expect(result.batchId).toBeTruthy();
  });

  it('excludes the event exactly at untilMs — half-open range matches AuditLogStore.clearRange', async () => {
    const store = TestBed.inject(AuditLogStore);
    store.append({ t: 1000, e: 'AO', cold: 1 });
    store.append({ t: 4000, e: 'VC', v: 1 });
    store.append({ t: 7000, e: 'VC', v: 0 });
    store.append({ t: 10000, e: 'AO', cold: 0 });
    await flushMicrotasks();

    const serializer = TestBed.inject(AuditLogSerializer);
    const result = await serializer.serializeSlice(4000, 10000);

    expect(result.eventCount).toBe(2);
    const roundTripped = parseBatchedNdjson(result.payload);
    const timestamps = roundTripped.map((e) => e.t);
    expect(timestamps).toEqual([4000, 7000]);
  });
});
