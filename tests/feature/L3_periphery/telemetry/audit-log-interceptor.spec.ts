// Feature tests del audit-log.interceptor — verifica que emite eventos H con
// los campos correctos leídos del HttpContext (endpoint ID, marks count,
// sessionId) y extrae el código de error del body cuando aplica.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpContext, provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { AuditLogStore } from '../../../../src/L3_periphery/telemetry/audit-log-store.service';
import { auditLogInterceptor } from '../../../../src/L3_periphery/telemetry/audit-log.interceptor';
import { ERROR_CODE_IDS } from '../../../../src/L3_periphery/telemetry/audit-log-dictionaries';
import {
  DRAFT_DELTA_TOKEN,
  DRAFT_VERSION_TOKEN,
  ENDPOINT_ID_TOKEN,
  MARKS_COUNT_TOKEN,
  SESSION_ID_TOKEN,
} from '../../../../src/L3_periphery/telemetry/tokens';

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
  await new Promise((r) => setTimeout(r, 30));
}

describe('auditLogInterceptor', () => {
  beforeEach(async () => {
    await wipeDb();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([auditLogInterceptor])),
        provideHttpClientTesting(),
        AuditLogStore,
      ],
    });
  });

  afterEach(async () => {
    await wipeDb();
    TestBed.resetTestingModule();
  });

  it('emits H event with endpoint ID from HttpContext for successful GET', async () => {
    const http = TestBed.inject(HttpClient);
    const httpMock = TestBed.inject(HttpTestingController);
    const store = TestBed.inject(AuditLogStore);

    const context = new HttpContext().set(ENDPOINT_ID_TOKEN, 42);
    const promise = firstValueFrom(http.get('/test', { context }));

    const req = httpMock.expectOne('/test');
    req.flush({ ok: true });
    await promise;
    await flushMicrotasks();

    const batch = await store.currentDayBatch();
    expect(batch).toHaveLength(1);
    const evt = batch[0];
    expect(evt.e).toBe('H');
    if (evt.e === 'H') {
      expect(evt.m).toBe(1); // GET
      expect(evt.u).toBe(42);
      expect(evt.st).toBe(200);
      expect(evt.dur).toBeGreaterThanOrEqual(0);
    }
    httpMock.verify();
  });

  it('emits H with u:0 when request has no ENDPOINT_ID_TOKEN', async () => {
    const http = TestBed.inject(HttpClient);
    const httpMock = TestBed.inject(HttpTestingController);
    const store = TestBed.inject(AuditLogStore);

    const promise = firstValueFrom(http.get('/unmarked'));
    httpMock.expectOne('/unmarked').flush({ ok: true });
    await promise;
    await flushMicrotasks();

    const batch = await store.currentDayBatch();
    expect(batch).toHaveLength(1);
    const evt = batch[0];
    if (evt.e === 'H') {
      expect(evt.u).toBe(0);
    }
  });

  it('extracts error code ID from body.code on 429', async () => {
    const http = TestBed.inject(HttpClient);
    const httpMock = TestBed.inject(HttpTestingController);
    const store = TestBed.inject(AuditLogStore);

    const context = new HttpContext().set(ENDPOINT_ID_TOKEN, 21);
    const promise = firstValueFrom(http.post('/submit', {}, { context })).catch((e) => e);

    const req = httpMock.expectOne('/submit');
    req.flush({ code: 'TOO_MANY_REQUESTS' }, { status: 429, statusText: 'Too Many Requests' });
    await promise;
    await flushMicrotasks();

    const batch = await store.currentDayBatch();
    expect(batch.length).toBeGreaterThanOrEqual(1);
    const h = batch.find((ev) => ev.e === 'H');
    expect(h?.e).toBe('H');
    if (h?.e === 'H') {
      expect(h.st).toBe(429);
      expect(h.c).toBe(ERROR_CODE_IDS.TOO_MANY_REQUESTS);
    }
  });

  it('sets H.c to 0 (not present in body) when error code is unknown', async () => {
    const http = TestBed.inject(HttpClient);
    const httpMock = TestBed.inject(HttpTestingController);
    const store = TestBed.inject(AuditLogStore);

    const context = new HttpContext().set(ENDPOINT_ID_TOKEN, 21);
    const promise = firstValueFrom(http.post('/submit', {}, { context })).catch((e) => e);

    httpMock
      .expectOne('/submit')
      .flush({ code: 'FUTURE_UNKNOWN_ERROR' }, { status: 500, statusText: 'Internal' });
    await promise;
    await flushMicrotasks();

    const batch = await store.currentDayBatch();
    const h = batch.find((ev) => ev.e === 'H');
    if (h?.e === 'H') {
      // Codigo desconocido → interceptor no incluye `c` (0 se omite).
      expect(h.c).toBeUndefined();
      expect(h.st).toBe(500);
    }
  });

  it('includes MARKS_COUNT_TOKEN as d field when set', async () => {
    const http = TestBed.inject(HttpClient);
    const httpMock = TestBed.inject(HttpTestingController);
    const store = TestBed.inject(AuditLogStore);

    const context = new HttpContext()
      .set(ENDPOINT_ID_TOKEN, 22)
      .set(MARKS_COUNT_TOKEN, 12)
      .set(SESSION_ID_TOKEN, 'a1b2c3d4');
    const promise = firstValueFrom(http.post('/draft', {}, { context }));

    httpMock.expectOne('/draft').flush(null, { status: 204, statusText: 'No Content' });
    await promise;
    await flushMicrotasks();

    const batch = await store.currentDayBatch();
    const h = batch.find((ev) => ev.e === 'H');
    if (h?.e === 'H') {
      expect(h.d).toBe(12);
      expect(h.s).toBe('a1b2c3d4');
    }
  });

  it('emits both H (st:0) and NW when request fails with NetworkError', async () => {
    const http = TestBed.inject(HttpClient);
    const httpMock = TestBed.inject(HttpTestingController);
    const store = TestBed.inject(AuditLogStore);

    const context = new HttpContext().set(ENDPOINT_ID_TOKEN, 22).set(SESSION_ID_TOKEN, 'abcdefgh');
    const promise = firstValueFrom(http.post('/draft', {}, { context })).catch((e) => e);

    httpMock.expectOne('/draft').error(new ProgressEvent('error'), { status: 0 });
    await promise;
    await flushMicrotasks();

    const batch = await store.currentDayBatch();
    const h = batch.find((ev) => ev.e === 'H');
    const nw = batch.find((ev) => ev.e === 'NW');
    expect(h).toBeDefined();
    expect(nw).toBeDefined();
    if (h?.e === 'H') expect(h.st).toBe(0);
    if (nw?.e === 'NW') {
      expect(nw.u).toBe(22);
      expect(nw.s).toBe('abcdefgh');
    }
  });

  // Sub-bloque C (design.md Revision Log 2026-09-04): DRAFT_VERSION_TOKEN y
  // DRAFT_DELTA_TOKEN los setea HttpExamsApi.guardarDraft -- el interceptor
  // solo los propaga al evento H cuando estan presentes en el context.
  it('propagates v and chg to the H event when DRAFT_VERSION_TOKEN/DRAFT_DELTA_TOKEN are set', async () => {
    const http = TestBed.inject(HttpClient);
    const httpMock = TestBed.inject(HttpTestingController);
    const store = TestBed.inject(AuditLogStore);

    const context = new HttpContext()
      .set(ENDPOINT_ID_TOKEN, 22)
      .set(SESSION_ID_TOKEN, 'a1b2c3d4')
      .set(DRAFT_VERSION_TOKEN, 3)
      .set(DRAFT_DELTA_TOKEN, [[1, 'B']] as const);
    const promise = firstValueFrom(http.post('/draft', {}, { context }));

    httpMock.expectOne('/draft').flush(null, { status: 204, statusText: 'No Content' });
    await promise;
    await flushMicrotasks();

    const batch = await store.currentDayBatch();
    const h = batch.find((ev) => ev.e === 'H');
    if (h?.e === 'H') {
      expect(h.v).toBe(3);
      expect(h.chg).toEqual([[1, 'B']]);
    } else {
      throw new Error('expected an H event');
    }
  });

  it('omits v and chg from the H event when the draft tokens are not set', async () => {
    const http = TestBed.inject(HttpClient);
    const httpMock = TestBed.inject(HttpTestingController);
    const store = TestBed.inject(AuditLogStore);

    const context = new HttpContext().set(ENDPOINT_ID_TOKEN, 12);
    const promise = firstValueFrom(http.get('/exam-sessions', { context }));

    httpMock.expectOne('/exam-sessions').flush({ ok: true });
    await promise;
    await flushMicrotasks();

    const batch = await store.currentDayBatch();
    const h = batch.find((ev) => ev.e === 'H');
    if (h?.e === 'H') {
      expect(h.v).toBeUndefined();
      expect(h.chg).toBeUndefined();
    } else {
      throw new Error('expected an H event');
    }
  });
});
