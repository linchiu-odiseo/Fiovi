// Feature tests del AuditLogUploadDispatcher — modelo de paquetes sellados.
//
// El flujo es sellar y después drenar: `sealPending` convierte los eventos
// sueltos en paquetes con `batchId` definitivo (partiendo en varios si no
// entran en el tope de tamaño), y `drainPending` los sube de a uno borrando
// solo lo que el back confirmó.
//
// Lo que más importa acá: que un fallo transitorio NO pierda el paquete, que
// un rechazo definitivo (4xx) NO trabe la cola para siempre, y que el
// `batchId` sea el mismo entre reintentos — que es lo que hace que el dedup
// del back sirva de algo.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { AuditLogUploadDispatcherService } from '../../../../src/L3_periphery/telemetry/audit-log-upload-dispatcher.service';
import { AuditLogStore } from '../../../../src/L3_periphery/telemetry/audit-log-store.service';
import { SlugStore } from '../../../../src/L3_periphery/http/slug-store';
import { startOfTodayLocalMs } from '../../../../src/L3_periphery/telemetry/day-key';

const DB_NAME = 'fiovi-audit-log';
const STORES = ['events', 'meta', 'packages'] as const;
const URL = 'https://api.yangpimpollo.com/t/vonex/student/telemetry/audit-log-batch';
const TODAY = startOfTodayLocalMs() + 60_000;

function wipeDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const openReq = indexedDB.open(DB_NAME);
    openReq.onupgradeneeded = () => {
      const db = openReq.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) {
          if (s === 'events') db.createObjectStore(s, { autoIncrement: true });
          else if (s === 'packages') db.createObjectStore(s, { keyPath: 'batchId' });
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

describe('AuditLogUploadDispatcherService', () => {
  let httpMock: HttpTestingController;
  let dispatcher: AuditLogUploadDispatcherService;
  let store: AuditLogStore;

  beforeEach(async () => {
    await wipeDb();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        AuditLogUploadDispatcherService,
        AuditLogStore,
        SlugStore,
      ],
    });

    TestBed.inject(SlugStore).set('vonex');
    httpMock = TestBed.inject(HttpTestingController);
    store = TestBed.inject(AuditLogStore);
    dispatcher = TestBed.inject(AuditLogUploadDispatcherService);
  });

  afterEach(async () => {
    httpMock.verify();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    await wipeDb();
  });

  async function seedEvents(count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      store.append({ t: TODAY + i, e: 'VC', v: i % 2 === 0 ? 1 : 0 });
    }
    await flushMicrotasks();
  }

  it('sin eventos no hace ningún POST y lo reporta como vacío', async () => {
    const outcome = await dispatcher.uploadPending();

    httpMock.expectNone(URL);
    // `empty` y no `ok`: decirle "enviado" a alguien que no tenía nada
    // pendiente es mentirle.
    expect(outcome).toEqual({ status: 'empty' });
  });

  it('sin slug activo no sube, pero el paquete queda sellado esperando', async () => {
    // `clear()` y no `set('')`: SlugStore ignora los valores falsy.
    TestBed.inject(SlugStore).clear();
    await seedEvents(2);

    await dispatcher.uploadPending();

    httpMock.expectNone(URL);
    expect(await store.pendingPackages()).toHaveLength(1);
  });

  it('caso feliz: sella, sube en base64 gzip y borra el paquete', async () => {
    await seedEvents(3);

    const promise = dispatcher.uploadPending();
    await flushMicrotasks();

    const req = httpMock.expectOne(URL);
    expect(req.request.body.enc).toBe('gzip');
    expect(req.request.body.eventCount).toBe(3);
    expect(typeof req.request.body.batchId).toBe('string');
    // El payload es base64 de gzip, no el NDJSON en claro.
    expect(req.request.body.payload).not.toContain('"e"');
    req.flush(null, { status: 202, statusText: 'Accepted' });
    const outcome = await promise;

    expect(outcome).toEqual({ status: 'ok', sent: 1 });
    expect(await store.pendingPackages()).toHaveLength(0);
    // Los eventos ya se habían borrado al sellar, dentro de la misma tx.
    expect(await store.eventsInRange(0, Number.MAX_SAFE_INTEGER)).toHaveLength(0);
  });

  it('el sellado borra los eventos aunque la subida falle — no se suben dos veces', async () => {
    await seedEvents(2);

    const promise = dispatcher.uploadPending();
    await flushMicrotasks();
    httpMock.expectOne(URL).error(new ProgressEvent('error'));
    await promise;

    expect(await store.eventsInRange(0, Number.MAX_SAFE_INTEGER)).toHaveLength(0);
    expect(await store.pendingPackages()).toHaveLength(1);
  });

  it('fallo de red: conserva el paquete para reintentarlo', async () => {
    await seedEvents(2);

    const first = dispatcher.uploadPending();
    await flushMicrotasks();
    httpMock.expectOne(URL).error(new ProgressEvent('error'));
    await first;

    const pending = await store.pendingPackages();
    expect(pending).toHaveLength(1);

    // Segundo intento: mismo paquete, mismo batchId.
    const second = dispatcher.uploadPending();
    await flushMicrotasks();
    const retry = httpMock.expectOne(URL);
    expect(retry.request.body.batchId).toBe(pending[0].batchId);
    retry.flush(null, { status: 202, statusText: 'Accepted' });
    await second;

    expect(await store.pendingPackages()).toHaveLength(0);
  });

  it('5xx también conserva el paquete', async () => {
    await seedEvents(1);

    const promise = dispatcher.uploadPending();
    await flushMicrotasks();
    httpMock.expectOne(URL).flush(null, { status: 503, statusText: 'Service Unavailable' });
    await promise;

    expect(await store.pendingPackages()).toHaveLength(1);
  });

  it('429 conserva el paquete — es esperar, no un rechazo', async () => {
    await seedEvents(1);

    const promise = dispatcher.uploadPending();
    await flushMicrotasks();
    httpMock.expectOne(URL).flush(null, { status: 429, statusText: 'Too Many Requests' });
    await promise;

    expect(await store.pendingPackages()).toHaveLength(1);
  });

  it('400 descarta el paquete — el back nunca va a aceptar esos bytes', async () => {
    await seedEvents(1);

    const promise = dispatcher.uploadPending();
    await flushMicrotasks();
    httpMock.expectOne(URL).flush(null, { status: 400, statusText: 'Bad Request' });
    const outcome = await promise;

    expect(await store.pendingPackages()).toHaveLength(0);
    // Descartado NO es enviado.
    expect(outcome).toEqual({ status: 'ok', sent: 0 });
  });

  it('413 descarta el paquete', async () => {
    await seedEvents(1);

    const promise = dispatcher.uploadPending();
    await flushMicrotasks();
    httpMock.expectOne(URL).flush(null, { status: 413, statusText: 'Payload Too Large' });
    await promise;

    expect(await store.pendingPackages()).toHaveLength(0);
  });

  // Lo aprendimos en el testeo manual: el 403 era una migración de permisos
  // sin aplicar, no un rechazo real. Descartarlo habría tirado justo los logs
  // del período en que el sistema estaba mal configurado.
  it('403 CONSERVA el paquete — puede ser un permiso todavía no desplegado', async () => {
    await seedEvents(1);

    const promise = dispatcher.uploadPending();
    await flushMicrotasks();
    httpMock.expectOne(URL).flush(null, { status: 403, statusText: 'Forbidden' });
    const outcome = await promise;

    expect(await store.pendingPackages()).toHaveLength(1);
    expect(outcome.status).toBe('partial');
  });

  it('404 alumno no vinculado CONSERVA el paquete — lo pueden vincular después', async () => {
    await seedEvents(1);

    const promise = dispatcher.uploadPending();
    await flushMicrotasks();
    httpMock
      .expectOne(URL)
      .flush({ code: 'TELEMETRY_STUDENT_NOT_LINKED' }, { status: 404, statusText: 'Not Found' });
    await promise;

    expect(await store.pendingPackages()).toHaveLength(1);
  });

  it('401 CONSERVA el paquete', async () => {
    await seedEvents(1);

    const promise = dispatcher.uploadPending();
    await flushMicrotasks();
    httpMock.expectOne(URL).flush(null, { status: 401, statusText: 'Unauthorized' });
    await promise;

    expect(await store.pendingPackages()).toHaveLength(1);
  });

  // Sin esto, cada intento fallido sellaba un paquete nuevo: una caída de un
  // rato dejaba una fila y un request por intento en vez de uno solo con todo
  // lo acumulado. Un paquete sellado no se puede agrandar (su batchId es la
  // clave de dedup del back), pero sí se puede no sellar de más.
  describe('mientras haya un paquete sin enviar', () => {
    it('NO sella uno nuevo — los eventos siguen acumulándose sueltos', async () => {
      await seedEvents(2);

      // Primer intento: sella y falla.
      const first = dispatcher.uploadPending();
      await flushMicrotasks();
      httpMock.expectOne(URL).error(new ProgressEvent('error'));
      await first;
      expect(await store.pendingPackages()).toHaveLength(1);

      // Llegan eventos nuevos y se reintenta.
      await seedEvents(3);
      const second = dispatcher.uploadPending();
      await flushMicrotasks();
      httpMock.expectOne(URL).error(new ProgressEvent('error'));
      await second;

      // Sigue habiendo UN solo paquete, no dos.
      expect(await store.pendingPackages()).toHaveLength(1);
      // Y los 3 eventos nuevos siguen sueltos, esperando.
      expect(await store.eventsInRange(0, Number.MAX_SAFE_INTEGER)).toHaveLength(3);
    });

    it('al destrabarse, lo acumulado sale en UN solo paquete', async () => {
      await seedEvents(2);

      const first = dispatcher.uploadPending();
      await flushMicrotasks();
      httpMock.expectOne(URL).error(new ProgressEvent('error'));
      await first;

      await seedEvents(3);

      // Ahora el back responde bien: sale el paquete viejo y después uno
      // nuevo con TODO lo acumulado desde entonces.
      const third = dispatcher.uploadPending();
      await flushMicrotasks();
      httpMock.expectOne(URL).flush(null, { status: 202, statusText: 'Accepted' });
      await flushMicrotasks();
      const fresh = httpMock.expectOne(URL);
      expect(fresh.request.body.eventCount).toBe(3);
      fresh.flush(null, { status: 202, statusText: 'Accepted' });
      const outcome = await third;

      expect(outcome).toEqual({ status: 'ok', sent: 2 });
      expect(await store.pendingPackages()).toHaveLength(0);
      expect(await store.eventsInRange(0, Number.MAX_SAFE_INTEGER)).toHaveLength(0);
    });
  });

  it('un fallo transitorio corta el drenaje — no machaca al back con el resto', async () => {
    // Dos paquetes sellados a mano, para controlar el orden.
    await store.sealPackage(
      { batchId: 'pkg-1', payload: 'AAAA', enc: 'gzip', eventCount: 1, sealedAt: 1000 },
      [],
    );
    await store.sealPackage(
      { batchId: 'pkg-2', payload: 'BBBB', enc: 'gzip', eventCount: 1, sealedAt: 2000 },
      [],
    );

    const promise = dispatcher.uploadPending();
    await flushMicrotasks();
    const req = httpMock.expectOne(URL);
    expect(req.request.body.batchId).toBe('pkg-1'); // el más viejo primero
    req.error(new ProgressEvent('error'));
    await promise;

    httpMock.expectNone(URL); // pkg-2 ni se intentó
    expect(await store.pendingPackages()).toHaveLength(2);
  });

  it('sin CompressionStream manda el NDJSON crudo con enc:none', async () => {
    const original = globalThis.CompressionStream;
    // @ts-expect-error — simula Safari < 16.4, que no lo implementa.
    delete globalThis.CompressionStream;
    try {
      await seedEvents(1);

      const promise = dispatcher.uploadPending();
      await flushMicrotasks();
      const req = httpMock.expectOne(URL);
      expect(req.request.body.enc).toBe('none');
      // Sin comprimir, el base64 decodifica al NDJSON legible.
      expect(atob(req.request.body.payload)).toContain('"e"');
      req.flush(null, { status: 202, statusText: 'Accepted' });
      await promise;

      expect(await store.pendingPackages()).toHaveLength(0);
    } finally {
      globalThis.CompressionStream = original;
    }
  });

  it('parte en varios paquetes cuando no entra en el tope de tamaño', async () => {
    // Eventos con un campo grande e irrepetible para que el gzip no los
    // colapse y el lote supere los 48KB.
    for (let i = 0; i < 40; i++) {
      store.append({
        t: TODAY + i,
        e: 'H',
        m: 2,
        u: 1,
        st: 200,
        dur: i,
        s: `${i}-${randomBlob()}`,
      } as never);
    }
    await flushMicrotasks();

    await dispatcher.sealPending();

    const packages = await store.pendingPackages();
    expect(packages.length).toBeGreaterThan(1);
    for (const pkg of packages) {
      expect(pkg.payload.length).toBeLessThanOrEqual(48 * 1024);
    }
    // Ningún evento se perdió en el reparto.
    const total = packages.reduce((sum, p) => sum + p.eventCount, 0);
    expect(total).toBe(40);
  });

  describe('con Web Locks API disponible', () => {
    it('otra pestaña con el lock tomado: no sella ni sube', async () => {
      await seedEvents(2);
      const sealSpy = vi.spyOn(dispatcher, 'sealPending');
      vi.stubGlobal('navigator', {
        ...navigator,
        locks: { request: vi.fn().mockResolvedValue(undefined) },
      });

      await dispatcher.uploadPending();

      expect(sealSpy).not.toHaveBeenCalled();
      httpMock.expectNone(URL);
      vi.unstubAllGlobals();
    });
  });
});

// Texto pseudoaleatorio de ~2KB: incompresible en la práctica, para forzar
// que el lote supere el tope sin depender del ratio de gzip.
function randomBlob(): string {
  let out = '';
  for (let i = 0; i < 2048; i++) {
    out += String.fromCharCode(33 + Math.floor(Math.random() * 90));
  }
  return out;
}
