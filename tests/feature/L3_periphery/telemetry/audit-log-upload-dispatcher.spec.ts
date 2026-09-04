// Feature tests del AuditLogUploadDispatcher (Fase 1 del audit-log) — cubre
// las tres ramas de uploadPending(): batch vacío (avanza cursor, sin POST),
// caso feliz (sube gzip+base64, limpia el rango, avanza cursor), y fallo de
// red (NO avanza el cursor ni limpia — el próximo intervalo reintenta la
// misma ventana). Ver design.md § Fase 1 Bridge.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { AuditLogUploadDispatcherService } from '../../../../src/L3_periphery/telemetry/audit-log-upload-dispatcher.service';
import { AuditLogSerializer } from '../../../../src/L3_periphery/telemetry/audit-log-serializer';
import { AuditLogStore } from '../../../../src/L3_periphery/telemetry/audit-log-store.service';
import { SlugStore } from '../../../../src/L3_periphery/http/slug-store';
import { startOfTodayLocalMs } from '../../../../src/L3_periphery/telemetry/day-key';

const CURSOR_KEY = 'fiovi-audit-log-last-upload-ms';
const SLICE: { payload: string; batchId: string; eventCount: number; bytesRaw: number } = {
  payload: '{"e":"AO","t0":1000,"x":[{"dt":0,"cold":1}]}\n',
  batchId: 'batch-1',
  eventCount: 1,
  bytesRaw: 45,
};

describe('AuditLogUploadDispatcherService.uploadPending', () => {
  let httpMock: HttpTestingController;
  let dispatcher: AuditLogUploadDispatcherService;
  let serializeSliceSpy: ReturnType<typeof vi.spyOn>;
  let clearRangeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        AuditLogUploadDispatcherService,
        AuditLogSerializer,
        AuditLogStore,
        SlugStore,
      ],
    });

    TestBed.inject(SlugStore).set('vonex');
    // Cursor lo bastante viejo como para superar MIN_WINDOW_MS sin esperar.
    localStorage.setItem(CURSOR_KEY, String(Date.now() - 60_000));

    serializeSliceSpy = vi.spyOn(TestBed.inject(AuditLogSerializer), 'serializeSlice');
    clearRangeSpy = vi.spyOn(TestBed.inject(AuditLogStore), 'clearRange').mockResolvedValue();

    httpMock = TestBed.inject(HttpTestingController);
    dispatcher = TestBed.inject(AuditLogUploadDispatcherService);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('does nothing (no POST, cursor untouched) if the window is under MIN_WINDOW_MS', async () => {
    localStorage.setItem(CURSOR_KEY, String(Date.now() - 5_000));
    await dispatcher.uploadPending();
    httpMock.expectNone(() => true);
  });

  it('does nothing if there is no active tenant slug', async () => {
    TestBed.inject(SlugStore).clear();
    await dispatcher.uploadPending();
    httpMock.expectNone(() => true);
    expect(serializeSliceSpy).not.toHaveBeenCalled();
  });

  it('empty batch: advances the cursor without POSTing', async () => {
    serializeSliceSpy.mockResolvedValue({ payload: '', batchId: 'b', eventCount: 0, bytesRaw: 0 });
    const before = Date.now();

    await dispatcher.uploadPending();

    httpMock.expectNone(() => true);
    expect(clearRangeSpy).not.toHaveBeenCalled();
    const cursor = Number(localStorage.getItem(CURSOR_KEY));
    expect(cursor).toBeGreaterThanOrEqual(before);
  });

  it('happy path: POSTs gzip+base64 payload and clears the uploaded range', async () => {
    serializeSliceSpy.mockResolvedValue(SLICE);
    const before = Date.now();

    const pending = dispatcher.uploadPending();
    // gzip via CompressionStream corre en microtasks/macrotasks reales antes
    // de llegar al http.post — dejamos que la cola drene (mismo patrón de
    // flushMicrotasks que el resto de la suite de telemetry) antes de
    // esperar la request en el backend de testing.
    await new Promise((r) => setTimeout(r, 30));
    const req = await httpMock.expectOne(
      (r) => r.method === 'POST' && r.url.endsWith('/student/telemetry/audit-log-batch'),
    );
    expect(req.request.body.batchId).toBe(SLICE.batchId);
    expect(req.request.body.eventCount).toBe(SLICE.eventCount);
    expect(typeof req.request.body.appVersion).toBe('string');

    // El payload viaja gzip+base64 — round-trip real con DecompressionStream
    // (misma API browser que usa el dispatcher) para confirmar que no es un
    // mock, es compresión de verdad.
    const decompressed = await gunzipFromBase64(req.request.body.payload as string);
    expect(decompressed).toBe(SLICE.payload);

    req.flush(null, { status: 204, statusText: 'No Content' });
    await pending;

    expect(clearRangeSpy).toHaveBeenCalledTimes(1);
    const cursor = Number(localStorage.getItem(CURSOR_KEY));
    expect(cursor).toBeGreaterThanOrEqual(before);
  });

  it('network error: does NOT clear the range and does NOT advance the cursor (retries the same window)', async () => {
    serializeSliceSpy.mockResolvedValue(SLICE);
    const cursorBefore = Date.now() - 60_000;
    localStorage.setItem(CURSOR_KEY, String(cursorBefore));

    const pending = dispatcher.uploadPending();
    // gzip via CompressionStream corre en microtasks/macrotasks reales antes
    // de llegar al http.post — dejamos que la cola drene (mismo patrón de
    // flushMicrotasks que el resto de la suite de telemetry) antes de
    // esperar la request en el backend de testing.
    await new Promise((r) => setTimeout(r, 30));
    const req = await httpMock.expectOne(
      (r) => r.method === 'POST' && r.url.endsWith('/student/telemetry/audit-log-batch'),
    );
    req.flush('boom', { status: 500, statusText: 'Internal Server Error' });
    await pending;

    expect(clearRangeSpy).not.toHaveBeenCalled();
    expect(Number(localStorage.getItem(CURSOR_KEY))).toBe(cursorBefore);
  });

  it('missing/garbage cursor defaults to start of today local', async () => {
    localStorage.removeItem(CURSOR_KEY);
    serializeSliceSpy.mockResolvedValue({ payload: '', batchId: 'b', eventCount: 0, bytesRaw: 0 });

    await dispatcher.uploadPending();

    const [sinceMs] = serializeSliceSpy.mock.calls[0] as [number, number];
    expect(sinceMs).toBe(startOfTodayLocalMs());
  });
});

// Inversa de bytesToBase64+gzip del dispatcher, con las mismas APIs browser
// (atob + DecompressionStream) — nada de Buffer/zlib de Node.
async function gunzipFromBase64(base64: string): Promise<string> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  void writer.write(bytes);
  void writer.close();
  const buf = await new Response(ds.readable).arrayBuffer();
  return new TextDecoder().decode(buf);
}
