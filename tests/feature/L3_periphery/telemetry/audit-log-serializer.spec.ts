// Feature tests del AuditLogSerializer — cubre el flujo del botón "Descargar
// logs" del profile: batch vacío muestra toast informativo sin descargar; batch
// con eventos serializa a NDJSON y dispara descarga via anchor.click().

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AuditLogStore } from '../../../../src/L3_periphery/telemetry/audit-log-store.service';
import {
  AuditLogSerializer,
  serializeToNdjson,
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
