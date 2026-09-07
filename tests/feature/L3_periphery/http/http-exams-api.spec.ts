import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpExamsApi } from '../../../../src/L3_periphery/http/http-exams-api';
import { SlugStore } from '../../../../src/L3_periphery/http/slug-store';
import { AuditLogStore } from '../../../../src/L3_periphery/telemetry/audit-log-store.service';
import { Exam } from '../../../../src/L1_domain/entities/exam';
import { ServerTime } from '../../../../src/L1_domain/value-objects/server-time';
import { InvalidExamError } from '../../../../src/L1_domain/errors/invalid-exam.error';
import { NetworkError } from '../../../../src/L1_domain/errors/network.error';
import { RateLimitError } from '../../../../src/L1_domain/errors/rate-limit.error';
import { ExamsPermissionRevokedError } from '../../../../src/L1_domain/errors/exams-permission-revoked.error';
import { StudentNotLinkedError } from '../../../../src/L1_domain/errors/student-not-linked.error';
import { environment } from '../../../../src/environments/environment';

const TEST_SLUG = 'vonex';

// Cubre `HttpExamsApi.getTodaysExams()` (L3): hit a
// `/t/{slug}/student/exam-sessions`, mapeo de DTO → Exam y clasificación
// de errores por `(status, body.code)`. El adapter NO filtra items: incluso
// `status: 'in_progress'` con `started: null` se pasa al dominio — el
// view-model lo muestra con banner "tomando un café" + botón Enviar disabled.
// IMPORTANTE: nunca asertamos sobre `message` del body — solo por (status, code).
describe('HttpExamsApi', () => {
  let httpMock: HttpTestingController;
  let adapter: HttpExamsApi;

  // El path se arma desde environment para que cambios en tenantSlug se
  // propaguen sin tocar tests.
  const EXAMS_URL = `${environment.apiBaseUrl}/t/${TEST_SLUG}/student/exam-sessions`;

  // DTO base válido para componer respuestas (ExamDto del adapter).
  const dtoFor = (
    overrides: Partial<{
      id: string;
      area: string | null;
      course: string | null;
      type: string;
      name: string;
      count: number;
      duration: number;
      status: 'scheduled' | 'in_progress' | 'finalized';
      scheduled: string;
      started: string | null;
      finished: string | null;
    }> = {},
  ) => ({
    id: 'exam-1',
    area: 'Matemática',
    course: 'Aritmética',
    type: 'simulacro',
    name: 'Examen 1',
    count: 20,
    duration: 3600,
    status: 'in_progress' as 'scheduled' | 'in_progress' | 'finalized',
    scheduled: '2026-06-11T10:00:00Z',
    started: '2026-06-11T10:00:05Z',
    finished: null,
    open_until: null,
    ...overrides,
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), HttpExamsApi, SlugStore],
    });
    httpMock = TestBed.inject(HttpTestingController);
    adapter = TestBed.inject(HttpExamsApi);
    TestBed.inject(SlugStore).set(TEST_SLUG);
  });

  afterEach(() => httpMock.verify());

  describe('getTodaysExams — happy path', () => {
    it('hace GET a /t/{slug}/student/exam-sessions y mapea exámenes + serverTime', async () => {
      const pending = adapter.getTodaysExams();

      const req = httpMock.expectOne(
        (r) => r.method === 'GET' && r.url.endsWith(`/t/${TEST_SLUG}/student/exam-sessions`),
      );
      expect(req.request.method).toBe('GET');

      req.flush({
        serverTime: '2026-06-11T11:30:00Z',
        exams: [
          dtoFor({ id: 'exam-1', status: 'in_progress' }),
          dtoFor({
            id: 'exam-2',
            status: 'scheduled',
            area: 'Comunicación',
            started: null,
          }),
          dtoFor({
            id: 'exam-3',
            status: 'finalized',
            finished: '2026-06-11T11:00:00Z',
          }),
        ],
      });

      const result = await pending;

      expect(result.serverTime).toBeInstanceOf(ServerTime);
      expect(result.serverTime.toMillis()).toBe(new Date('2026-06-11T11:30:00Z').getTime());

      expect(result.exams).toHaveLength(3);
      expect(result.exams[0]).toBeInstanceOf(Exam);
      expect(result.exams[0].id).toBe('exam-1');
      expect(result.exams[0].serverStatus.value).toBe('in_progress');
      expect(result.exams[0].scheduled).toEqual(new Date('2026-06-11T10:00:00Z'));
      expect(result.exams[0].started).toEqual(new Date('2026-06-11T10:00:05Z'));

      expect(result.exams[1].id).toBe('exam-2');
      expect(result.exams[1].area).toBe('Comunicación');
      expect(result.exams[1].serverStatus.value).toBe('scheduled');
      expect(result.exams[1].started).toBeNull();

      expect(result.exams[2].id).toBe('exam-3');
      expect(result.exams[2].serverStatus.value).toBe('finalized');
      expect(result.exams[2].finished).toEqual(new Date('2026-06-11T11:00:00Z'));
    });

    it('acepta area: null y course: null tal cual', async () => {
      const pending = adapter.getTodaysExams();
      const req = httpMock.expectOne(EXAMS_URL);
      req.flush({
        serverTime: '2026-06-11T11:30:00Z',
        exams: [dtoFor({ area: null, course: null, status: 'scheduled', started: null })],
      });

      const result = await pending;
      expect(result.exams[0].area).toBeNull();
      expect(result.exams[0].course).toBeNull();
    });

    it('lista vacía: result.exams es array vacío y serverTime sigue presente', async () => {
      const pending = adapter.getTodaysExams();
      const req = httpMock.expectOne(EXAMS_URL);
      req.flush({
        serverTime: '2026-06-11T08:00:00Z',
        exams: [],
      });

      const result = await pending;
      expect(result.exams).toEqual([]);
      expect(result.serverTime).toBeInstanceOf(ServerTime);
      expect(result.serverTime.toMillis()).toBe(new Date('2026-06-11T08:00:00Z').getTime());
    });

    it.each(['scheduled', 'in_progress', 'finalized'] as const)(
      'mapea correctamente status "%s" del DTO a ExamServerStatus',
      async (status) => {
        const pending = adapter.getTodaysExams();
        const req = httpMock.expectOne(EXAMS_URL);
        req.flush({
          serverTime: '2026-06-11T11:30:00Z',
          exams: [
            dtoFor({
              status,
              // started debe ser null SOLO para scheduled; in_progress y finalized lo necesitan.
              started: status === 'scheduled' ? null : '2026-06-11T10:00:05Z',
            }),
          ],
        });

        const result = await pending;
        expect(result.exams[0].serverStatus.value).toBe(status);
      },
    );
  });

  describe('getTodaysExams — incluye items con started=null + in_progress', () => {
    it('NO filtra: el item se devuelve para que LR muestre banner "tomando un café"', async () => {
      const pending = adapter.getTodaysExams();
      const req = httpMock.expectOne(EXAMS_URL);
      req.flush({
        serverTime: '2026-06-11T11:30:00Z',
        exams: [
          // Válido — in_progress con started seteado.
          dtoFor({ id: 'exam-valid', status: 'in_progress' }),
          // in_progress con started=null: el back en teoría no emite esto,
          // pero si lo hace, lo pasamos al dominio. El view-model lo trata
          // como "no vigente" y muestra el banner.
          dtoFor({ id: 'exam-no-started', status: 'in_progress', started: null }),
          // Scheduled — started null es legítimo.
          dtoFor({ id: 'exam-scheduled', status: 'scheduled', started: null }),
        ],
      });

      const result = await pending;

      // Los 3 items pasan al dominio en el orden recibido.
      expect(result.exams.map((e) => e.id)).toEqual([
        'exam-valid',
        'exam-no-started',
        'exam-scheduled',
      ]);
      const noStarted = result.exams.find((e) => e.id === 'exam-no-started')!;
      expect(noStarted.started).toBeNull();
      expect(noStarted.serverStatus.value).toBe('in_progress');
      // hasStartedBy(now) === false → el view-model va a mostrar el banner.
      expect(noStarted.hasStartedBy(new Date('2026-06-11T11:30:00Z'))).toBe(false);
    });
  });

  describe('getTodaysExams — rechazos por DTO inválido (entidad lanza)', () => {
    it('status fuera del set permitido propaga InvalidExamError', async () => {
      const pending = adapter.getTodaysExams();
      const req = httpMock.expectOne(EXAMS_URL);
      req.flush({
        serverTime: '2026-06-11T11:30:00Z',
        exams: [
          dtoFor({
            status: 'pendiente' as unknown as 'scheduled',
          }),
        ],
      });

      await expect(pending).rejects.toBeInstanceOf(InvalidExamError);
    });

    it('scheduled no-ISO8601 propaga InvalidExamError', async () => {
      const pending = adapter.getTodaysExams();
      const req = httpMock.expectOne(EXAMS_URL);
      req.flush({
        serverTime: '2026-06-11T11:30:00Z',
        exams: [dtoFor({ scheduled: 'no-es-fecha' })],
      });

      await expect(pending).rejects.toBeInstanceOf(InvalidExamError);
    });

    it('started no-ISO8601 propaga InvalidExamError', async () => {
      const pending = adapter.getTodaysExams();
      const req = httpMock.expectOne(EXAMS_URL);
      req.flush({
        serverTime: '2026-06-11T11:30:00Z',
        exams: [dtoFor({ started: 'tampoco-es-fecha' })],
      });

      await expect(pending).rejects.toBeInstanceOf(InvalidExamError);
    });
  });

  describe('getTodaysExams — clasificación HTTP → errores de dominio', () => {
    // NOTA: 401 lo absorbe `credentials.interceptor` (refresh + redirect login).
    // El adapter NO lo clasifica, así que NO testeamos 401 acá.

    it('403 → ExamsPermissionRevokedError (cuerpo ignorado)', async () => {
      const pending = adapter.getTodaysExams();
      const req = httpMock.expectOne(EXAMS_URL);
      req.flush(
        { message: 'cualquier-string-volátil-del-backend' },
        { status: 403, statusText: 'Forbidden' },
      );
      await expect(pending).rejects.toBeInstanceOf(ExamsPermissionRevokedError);
    });

    it('404 con body code STUDENT_NOT_LINKED → StudentNotLinkedError', async () => {
      const pending = adapter.getTodaysExams();
      const req = httpMock.expectOne(EXAMS_URL);
      req.flush(
        { code: 'STUDENT_NOT_LINKED', message: 'message-irrelevante' },
        { status: 404, statusText: 'Not Found' },
      );
      await expect(pending).rejects.toBeInstanceOf(StudentNotLinkedError);
    });

    it('404 sin code conocido → NetworkError (fallback)', async () => {
      const pending = adapter.getTodaysExams();
      const req = httpMock.expectOne(EXAMS_URL);
      req.flush({ message: 'sin-code' }, { status: 404, statusText: 'Not Found' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });

    it('404 con code distinto a STUDENT_NOT_LINKED → NetworkError', async () => {
      const pending = adapter.getTodaysExams();
      const req = httpMock.expectOne(EXAMS_URL);
      req.flush({ code: 'OTRO_CODE', message: 'algo' }, { status: 404, statusText: 'Not Found' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });

    it('500 → NetworkError', async () => {
      const pending = adapter.getTodaysExams();
      const req = httpMock.expectOne(EXAMS_URL);
      req.flush('boom', { status: 500, statusText: 'Server Error' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });

    it('503 → NetworkError', async () => {
      const pending = adapter.getTodaysExams();
      const req = httpMock.expectOne(EXAMS_URL);
      req.flush('unavailable', { status: 503, statusText: 'Service Unavailable' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });

    it('429 → RateLimitError (permite que /home lo silencie sin banner)', async () => {
      const pending = adapter.getTodaysExams();
      const req = httpMock.expectOne(EXAMS_URL);
      req.flush({ message: 'rate' }, { status: 429, statusText: 'Too Many' });
      await expect(pending).rejects.toBeInstanceOf(RateLimitError);
    });

    it('fallo de transporte (status 0) → NetworkError', async () => {
      const pending = adapter.getTodaysExams();
      const req = httpMock.expectOne(EXAMS_URL);
      req.error(new ProgressEvent('error'), { status: 0, statusText: 'Network failure' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });
  });

  // Los tests de `enviar()` viven en su propio archivo
  // `http-exams-api-enviar.spec.ts`. Acá solo cubrimos
  // GET /t/{slug}/student/exam-sessions.

  // Sub-bloque G (design.md § Revision Log 2026-09-04 iteration 3): CLK se
  // emite piggybacking en `dto.serverTime` de `getTodaysExams`, a lo sumo
  // 1 vez cada 4h por instancia de app, y solo si el offset (srv - t) cambió
  // más de 500ms vs el último offset emitido. Se usa un provider mock de
  // `AuditLogStore` (en vez del real, respaldado por IndexedDB) para poder
  // aserverar directamente sobre las llamadas a `append`.
  describe('getTodaysExams — CLK clock calibration', () => {
    const BASE_MS = new Date('2026-06-11T10:00:00.000Z').getTime();
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

    let appendSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.useFakeTimers();
      appendSpy = vi.fn();
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          HttpExamsApi,
          SlugStore,
          { provide: AuditLogStore, useValue: { append: appendSpy } },
        ],
      });
      httpMock = TestBed.inject(HttpTestingController);
      adapter = TestBed.inject(HttpExamsApi);
      TestBed.inject(SlugStore).set(TEST_SLUG);
    });

    afterEach(() => {
      httpMock.verify();
      vi.useRealTimers();
      TestBed.resetTestingModule();
    });

    function flushServerTime(serverTimeMs: number): void {
      const req = httpMock.expectOne(EXAMS_URL);
      req.flush({ serverTime: new Date(serverTimeMs).toISOString(), exams: [] });
    }

    it('primer poll del día emite CLK', async () => {
      vi.setSystemTime(BASE_MS);
      const pending = adapter.getTodaysExams();
      flushServerTime(BASE_MS + 2000);
      await pending;

      expect(appendSpy).toHaveBeenCalledTimes(1);
      const emitted = appendSpy.mock.calls[0][0];
      expect(emitted.e).toBe('CLK');
      expect(emitted.t).toBe(BASE_MS);
      expect(emitted.srv).toBe(BASE_MS + 2000);
    });

    it('segundo poll dentro de las 4h NO emite CLK', async () => {
      vi.setSystemTime(BASE_MS);
      const first = adapter.getTodaysExams();
      flushServerTime(BASE_MS + 2000);
      await first;

      vi.setSystemTime(BASE_MS + 60 * 60 * 1000); // +1h
      const second = adapter.getTodaysExams();
      flushServerTime(BASE_MS + 60 * 60 * 1000 + 2000);
      await second;

      expect(appendSpy).toHaveBeenCalledTimes(1);
    });

    it('poll después de 4h SIN drift no emite un nuevo CLK', async () => {
      vi.setSystemTime(BASE_MS);
      const first = adapter.getTodaysExams();
      flushServerTime(BASE_MS + 2000); // offset = +2000ms
      await first;

      const laterNow = BASE_MS + FOUR_HOURS_MS + 60_000; // +4h1min
      vi.setSystemTime(laterNow);
      const second = adapter.getTodaysExams();
      flushServerTime(laterNow + 2000); // mismo offset (+2000ms)
      await second;

      expect(appendSpy).toHaveBeenCalledTimes(1);
    });

    it('poll después de 4h CON drift > 500ms emite un nuevo CLK', async () => {
      vi.setSystemTime(BASE_MS);
      const first = adapter.getTodaysExams();
      flushServerTime(BASE_MS + 2000); // offset = +2000ms
      await first;

      const laterNow = BASE_MS + FOUR_HOURS_MS; // +4h exacto
      vi.setSystemTime(laterNow);
      const second = adapter.getTodaysExams();
      flushServerTime(laterNow + 3000); // offset = +3000ms → drift de 1000ms > 500ms
      await second;

      expect(appendSpy).toHaveBeenCalledTimes(2);
      const secondEmitted = appendSpy.mock.calls[1][0];
      expect(secondEmitted.e).toBe('CLK');
      expect(secondEmitted.t).toBe(laterNow);
      expect(secondEmitted.srv).toBe(laterNow + 3000);
    });
  });
});
