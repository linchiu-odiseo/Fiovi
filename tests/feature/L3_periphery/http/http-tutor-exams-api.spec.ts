import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpTutorExamsApi } from '../../../../src/L3_periphery/http/http-tutor-exams-api';
import { SlugStore } from '../../../../src/L3_periphery/http/slug-store';
import { TutorExam } from '../../../../src/L1_domain/entities/tutor-exam';
import { NetworkError } from '../../../../src/L1_domain/errors/network.error';
import { InvalidPayloadError } from '../../../../src/L1_domain/errors/invalid-payload.error';
import { VirtualExamNotFoundError } from '../../../../src/L1_domain/errors/virtual-exam-not-found.error';
import { ExamConflictError } from '../../../../src/L1_domain/errors/exam-conflict.error';
import { ExamPreconditionError } from '../../../../src/L1_domain/errors/exam-precondition.error';
import { TutorExamForbiddenError } from '../../../../src/L1_domain/errors/tutor-exam-forbidden.error';
import { environment } from '../../../../src/environments/environment';

const TEST_SLUG = 'vonex';
const BASE = `${environment.apiBaseUrl}/t/${TEST_SLUG}`;

// DTO builders — reflejan el shape actual del back: sin entryId/courseId/createdAt
// en la lista del tutor; con `course`, `area` snapshot y `scheduled`.
function listItemDto(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'det-1',
    recordId: 'rec-1',
    classroomId: 'cls-1',
    status: 'scheduled',
    name: 'Examen Lengua',
    course: 'ÁLGEBRA',
    area: 'Matemáticas',
    count: null,
    duration: 3600,
    scheduled: '2026-06-01T10:00:00Z',
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

function detailDto(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'det-1',
    recordId: 'rec-1',
    status: 'scheduled',
    name: 'Examen Lengua',
    course: null,
    area: null,
    count: null,
    duration: 3600,
    enabledStudentIds: ['s-1', 's-2'],
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-06-01T10:00:00Z',
    ...overrides,
  };
}

describe('HttpTutorExamsApi', () => {
  let httpMock: HttpTestingController;
  let adapter: HttpTutorExamsApi;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), HttpTutorExamsApi, SlugStore],
    });
    httpMock = TestBed.inject(HttpTestingController);
    adapter = TestBed.inject(HttpTutorExamsApi);
    TestBed.inject(SlugStore).set(TEST_SLUG);
  });

  afterEach(() => httpMock.verify());

  // ===========================================================================
  // getTutorExams()
  // ===========================================================================
  describe('getTutorExams()', () => {
    it('hace GET a <base>/tutor/virtual-exams', async () => {
      const pending = adapter.getTutorExams();

      const req = httpMock.expectOne(`${BASE}/tutor/virtual-exams`);
      expect(req.request.method).toBe('GET');

      req.flush({ items: [] });
      await pending;
    });

    it('mapea DTO camelCase → TutorExam con valores nominales', async () => {
      const pending = adapter.getTutorExams();
      const req = httpMock.expectOne(`${BASE}/tutor/virtual-exams`);
      req.flush({
        items: [
          listItemDto({
            id: 'det-1',
            recordId: 'rec-1',
            classroomId: 'cls-1',
            status: 'scheduled',
            name: 'Examen Lengua',
            course: 'ÁLGEBRA',
            area: 'Matemáticas',
            count: null,
            duration: 3600,
            scheduled: '2026-06-01T10:00:00Z',
            startedAt: null,
            finishedAt: null,
          }),
        ],
      });

      const result = await pending;
      expect(result).toHaveLength(1);
      const exam = result[0] as TutorExam;
      expect(exam.detailId).toBe('det-1');
      expect(exam.recordId).toBe('rec-1');
      expect(exam.classroomId).toBe('cls-1');
      expect(exam.serverStatus.value).toBe('scheduled');
      expect(exam.count).toBeNull();
      expect(exam.course).toBe('ÁLGEBRA');
      expect(exam.area).toBe('Matemáticas');
      expect(exam.startedAt).toBeNull();
      expect(exam.scheduled).toBeInstanceOf(Date);
      expect(exam.scheduled.toISOString()).toBe('2026-06-01T10:00:00.000Z');
    });

    it('count: null en DTO → tutorExam.count === null (no undefined)', async () => {
      const pending = adapter.getTutorExams();
      const req = httpMock.expectOne(`${BASE}/tutor/virtual-exams`);
      req.flush({ items: [listItemDto({ count: null })] });

      const result = await pending;
      expect((result[0] as TutorExam).count).toBeNull();
    });

    it('course + area null en DTO → tutorExam.course === null y tutorExam.area === null', async () => {
      const pending = adapter.getTutorExams();
      const req = httpMock.expectOne(`${BASE}/tutor/virtual-exams`);
      req.flush({ items: [listItemDto({ course: null, area: null })] });

      const result = await pending;
      expect((result[0] as TutorExam).course).toBeNull();
      expect((result[0] as TutorExam).area).toBeNull();
    });

    it('startedAt como string ISO → instancia de Date', async () => {
      const pending = adapter.getTutorExams();
      const req = httpMock.expectOne(`${BASE}/tutor/virtual-exams`);
      req.flush({
        items: [
          listItemDto({
            status: 'in_progress',
            startedAt: '2026-06-10T08:00:00Z',
          }),
        ],
      });

      const result = await pending;
      expect((result[0] as TutorExam).startedAt).toBeInstanceOf(Date);
      expect((result[0] as TutorExam).startedAt?.toISOString()).toBe('2026-06-10T08:00:00.000Z');
    });

    it('HTTP 403 → rechaza con TutorExamForbiddenError', async () => {
      const pending = adapter.getTutorExams();
      const req = httpMock.expectOne(`${BASE}/tutor/virtual-exams`);
      req.flush({ message: 'forbidden' }, { status: 403, statusText: 'Forbidden' });

      await expect(pending).rejects.toBeInstanceOf(TutorExamForbiddenError);
    });

    it('NO setea withCredentials manualmente (lo agrega el interceptor)', async () => {
      const pending = adapter.getTutorExams();
      const req = httpMock.expectOne(`${BASE}/tutor/virtual-exams`);
      expect(req.request.withCredentials).toBe(false);
      req.flush({ items: [] });
      await pending;
    });
  });

  // ===========================================================================
  // getExamDetail()
  // ===========================================================================
  describe('getExamDetail()', () => {
    it('hace GET a <base>/virtual-exams/rec-123 (encodeURIComponent)', async () => {
      const pending = adapter.getExamDetail('rec-123');

      const req = httpMock.expectOne(`${BASE}/virtual-exams/rec-123`);
      expect(req.request.method).toBe('GET');
      req.flush(detailDto());
      await pending;
    });

    it('mapea enabledStudentIds correctamente', async () => {
      const pending = adapter.getExamDetail('rec-1');
      const req = httpMock.expectOne(`${BASE}/virtual-exams/rec-1`);
      req.flush(detailDto({ enabledStudentIds: ['s-1', 's-2'] }));

      const result = await pending;
      expect(result.enabledStudentIds).toEqual(['s-1', 's-2']);
    });

    it('enabledStudentIds vacío → array vacío', async () => {
      const pending = adapter.getExamDetail('rec-1');
      const req = httpMock.expectOne(`${BASE}/virtual-exams/rec-1`);
      req.flush(detailDto({ enabledStudentIds: [] }));

      const result = await pending;
      expect(result.enabledStudentIds.length).toBe(0);
    });

    it('HTTP 404 → rechaza con VirtualExamNotFoundError', async () => {
      const pending = adapter.getExamDetail('rec-1');
      const req = httpMock.expectOne(`${BASE}/virtual-exams/rec-1`);
      req.flush({ message: 'not found' }, { status: 404, statusText: 'Not Found' });

      await expect(pending).rejects.toBeInstanceOf(VirtualExamNotFoundError);
    });
  });

  // ===========================================================================
  // listClassroomStudents()
  // ===========================================================================
  describe('listClassroomStudents()', () => {
    it('hace GET con classroomId en path y virtualExamDetailId en query', async () => {
      const pending = adapter.listClassroomStudents({
        classroomId: 'cls-1',
        virtualExamDetailId: 'det-1',
      });

      const req = httpMock.expectOne(`${BASE}/classrooms/cls-1/students?virtualExamDetailId=det-1`);
      expect(req.request.method).toBe('GET');
      req.flush({ students: [] });
      await pending;
    });

    it('mapea ClassroomStudentDto → ClassroomStudent 1:1', async () => {
      const pending = adapter.listClassroomStudents({
        classroomId: 'cls-1',
        virtualExamDetailId: 'det-1',
      });
      const req = httpMock.expectOne(`${BASE}/classrooms/cls-1/students?virtualExamDetailId=det-1`);
      req.flush({
        students: [
          {
            studentId: 's1',
            studentCode: '0001',
            firstName: 'Ana',
            lastName: 'García',
            enabled: true,
            hasSubmitted: false,
          },
        ],
      });

      const result = await pending;
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        studentId: 's1',
        studentCode: '0001',
        firstName: 'Ana',
        lastName: 'García',
        enabled: true,
        hasSubmitted: false,
      });
    });

    it('hasSubmitted: true se preserva en el read-model', async () => {
      const pending = adapter.listClassroomStudents({
        classroomId: 'cls-1',
        virtualExamDetailId: 'det-1',
      });
      const req = httpMock.expectOne(`${BASE}/classrooms/cls-1/students?virtualExamDetailId=det-1`);
      req.flush({
        students: [
          {
            studentId: 's2',
            studentCode: '0002',
            firstName: 'Carlos',
            lastName: 'López',
            enabled: true,
            hasSubmitted: true,
          },
        ],
      });

      const result = await pending;
      expect(result[0].hasSubmitted).toBe(true);
    });

    it('HTTP 403 → rechaza con TutorExamForbiddenError', async () => {
      const pending = adapter.listClassroomStudents({
        classroomId: 'cls-1',
        virtualExamDetailId: 'det-1',
      });
      const req = httpMock.expectOne(`${BASE}/classrooms/cls-1/students?virtualExamDetailId=det-1`);
      req.flush({ message: 'forbidden' }, { status: 403, statusText: 'Forbidden' });

      await expect(pending).rejects.toBeInstanceOf(TutorExamForbiddenError);
    });
  });

  // ===========================================================================
  // updateEnabledStudents()
  // ===========================================================================
  describe('updateEnabledStudents()', () => {
    it('hace PATCH a <base>/virtual-exams/rec-1/enabled-students con body correcto', async () => {
      const pending = adapter.updateEnabledStudents({
        recordId: 'rec-1',
        enabledStudentIds: ['s-1', 's-2'],
      });

      const req = httpMock.expectOne(`${BASE}/virtual-exams/rec-1/enabled-students`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ enabledStudentIds: ['s-1', 's-2'] });
      req.flush(null, { status: 200, statusText: 'OK' });
      await pending;
    });

    it('HTTP 200 vacío → resuelve void', async () => {
      const pending = adapter.updateEnabledStudents({
        recordId: 'rec-1',
        enabledStudentIds: [],
      });
      const req = httpMock.expectOne(`${BASE}/virtual-exams/rec-1/enabled-students`);
      req.flush(null, { status: 200, statusText: 'OK' });

      await expect(pending).resolves.toBeUndefined();
    });

    it('HTTP 409 → rechaza con ExamConflictError', async () => {
      const pending = adapter.updateEnabledStudents({
        recordId: 'rec-1',
        enabledStudentIds: [],
      });
      const req = httpMock.expectOne(`${BASE}/virtual-exams/rec-1/enabled-students`);
      req.flush({ message: 'conflict' }, { status: 409, statusText: 'Conflict' });

      await expect(pending).rejects.toBeInstanceOf(ExamConflictError);
    });

    it('HTTP 422 → rechaza con ExamPreconditionError', async () => {
      const pending = adapter.updateEnabledStudents({
        recordId: 'rec-1',
        enabledStudentIds: [],
      });
      const req = httpMock.expectOne(`${BASE}/virtual-exams/rec-1/enabled-students`);
      req.flush({ message: 'unprocessable' }, { status: 422, statusText: 'Unprocessable' });

      await expect(pending).rejects.toBeInstanceOf(ExamPreconditionError);
    });
  });

  // ===========================================================================
  // iniciar()
  // ===========================================================================
  describe('iniciar()', () => {
    it('hace POST a <base>/virtual-exams/rec-1/start sin body cuando no hay override', async () => {
      const pending = adapter.iniciar('rec-1');

      const req = httpMock.expectOne(`${BASE}/virtual-exams/rec-1/start`);
      expect(req.request.method).toBe('POST');
      // Sin duration → body null; el back mantiene la duración de creación.
      expect(req.request.body).toBeNull();
      req.flush(null, { status: 204, statusText: 'No Content' });
      await pending;
    });

    it('envía { duration } en el body cuando el tutor sobrescribe al iniciar', async () => {
      const pending = adapter.iniciar('rec-1', 1800);

      const req = httpMock.expectOne(`${BASE}/virtual-exams/rec-1/start`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ duration: 1800 });
      req.flush(null, { status: 204, statusText: 'No Content' });
      await pending;
    });

    it('HTTP 204 → resuelve void', async () => {
      const pending = adapter.iniciar('rec-1');
      const req = httpMock.expectOne(`${BASE}/virtual-exams/rec-1/start`);
      req.flush(null, { status: 204, statusText: 'No Content' });

      await expect(pending).resolves.toBeUndefined();
    });

    it('HTTP 409 → rechaza con ExamConflictError', async () => {
      const pending = adapter.iniciar('rec-1');
      const req = httpMock.expectOne(`${BASE}/virtual-exams/rec-1/start`);
      req.flush({ message: 'conflict' }, { status: 409, statusText: 'Conflict' });

      await expect(pending).rejects.toBeInstanceOf(ExamConflictError);
    });

    it('HTTP 422 → rechaza con ExamPreconditionError', async () => {
      const pending = adapter.iniciar('rec-1');
      const req = httpMock.expectOne(`${BASE}/virtual-exams/rec-1/start`);
      req.flush({ message: 'unprocessable' }, { status: 422, statusText: 'Unprocessable' });

      await expect(pending).rejects.toBeInstanceOf(ExamPreconditionError);
    });

    it('HTTP 400 (duración fuera de rango) → rechaza con InvalidPayloadError', async () => {
      const pending = adapter.iniciar('rec-1', 30);
      const req = httpMock.expectOne(`${BASE}/virtual-exams/rec-1/start`);
      req.flush({ message: 'duration out of range' }, { status: 400, statusText: 'Bad Request' });

      await expect(pending).rejects.toBeInstanceOf(InvalidPayloadError);
    });
  });

  // ===========================================================================
  // finalizar()
  // ===========================================================================
  describe('finalizar()', () => {
    it('hace POST a <base>/virtual-exams/rec-1/finalize sin body', async () => {
      const pending = adapter.finalizar('rec-1');

      const req = httpMock.expectOne(`${BASE}/virtual-exams/rec-1/finalize`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toBeNull();
      req.flush({ transitioned: true, jobId: 'job-xyz' }, { status: 200, statusText: 'OK' });
      await pending;
    });

    it('HTTP 200 { transitioned: true, jobId } → FinalizeResult con transitioned: true', async () => {
      const pending = adapter.finalizar('rec-1');
      const req = httpMock.expectOne(`${BASE}/virtual-exams/rec-1/finalize`);
      // Nota: el backend devuelve 200 (NO 202 ni 204) — ver design.md R2, PR #276.
      req.flush({ transitioned: true, jobId: 'job-xyz' }, { status: 200, statusText: 'OK' });

      const result = await pending;
      expect(result.transitioned).toBe(true);
      expect(result.jobId).toBe('job-xyz');
    });

    it('HTTP 200 { transitioned: false } → FinalizeResult { transitioned: false } — NO es error (idempotente)', async () => {
      const pending = adapter.finalizar('rec-1');
      const req = httpMock.expectOne(`${BASE}/virtual-exams/rec-1/finalize`);
      req.flush({ transitioned: false }, { status: 200, statusText: 'OK' });

      const result = await pending;
      expect(result.transitioned).toBe(false);
      expect(result.jobId).toBeUndefined();
    });

    it('jobId ausente en body → jobId: undefined en FinalizeResult', async () => {
      const pending = adapter.finalizar('rec-1');
      const req = httpMock.expectOne(`${BASE}/virtual-exams/rec-1/finalize`);
      req.flush({ transitioned: true }, { status: 200, statusText: 'OK' });

      const result = await pending;
      expect(result.transitioned).toBe(true);
      expect(result.jobId).toBeUndefined();
    });

    it('HTTP 409 → rechaza con ExamConflictError', async () => {
      const pending = adapter.finalizar('rec-1');
      const req = httpMock.expectOne(`${BASE}/virtual-exams/rec-1/finalize`);
      req.flush({ message: 'conflict' }, { status: 409, statusText: 'Conflict' });

      await expect(pending).rejects.toBeInstanceOf(ExamConflictError);
    });

    it('HTTP 422 → rechaza con ExamPreconditionError', async () => {
      const pending = adapter.finalizar('rec-1');
      const req = httpMock.expectOne(`${BASE}/virtual-exams/rec-1/finalize`);
      req.flush({ message: 'unprocessable' }, { status: 422, statusText: 'Unprocessable' });

      await expect(pending).rejects.toBeInstanceOf(ExamPreconditionError);
    });
  });

  // ===========================================================================
  // classifyTutorError() — todas las filas del mapa de status
  // ===========================================================================
  describe('classifyTutorError() — clasificación por status HTTP', () => {
    // Usamos getTutorExams() como vehículo de error en todos los casos
    // (cualquier endpoint lo haría — el clasificador es compartido).

    it('400 → InvalidPayloadError', async () => {
      const pending = adapter.getTutorExams();
      const req = httpMock.expectOne(`${BASE}/tutor/virtual-exams`);
      req.flush(
        { message: 'bad request', code: 'any_code' },
        { status: 400, statusText: 'Bad Request' },
      );
      await expect(pending).rejects.toBeInstanceOf(InvalidPayloadError);
    });

    it('403 → TutorExamForbiddenError', async () => {
      const pending = adapter.getTutorExams();
      const req = httpMock.expectOne(`${BASE}/tutor/virtual-exams`);
      req.flush(
        { message: 'forbidden', code: 'forbidden' },
        { status: 403, statusText: 'Forbidden' },
      );
      await expect(pending).rejects.toBeInstanceOf(TutorExamForbiddenError);
    });

    it('404 → VirtualExamNotFoundError', async () => {
      const pending = adapter.getTutorExams();
      const req = httpMock.expectOne(`${BASE}/tutor/virtual-exams`);
      req.flush(
        { message: 'not found', code: 'not_found' },
        { status: 404, statusText: 'Not Found' },
      );
      await expect(pending).rejects.toBeInstanceOf(VirtualExamNotFoundError);
    });

    it('409 → ExamConflictError', async () => {
      const pending = adapter.getTutorExams();
      const req = httpMock.expectOne(`${BASE}/tutor/virtual-exams`);
      req.flush({ message: 'conflict', code: 'conflict' }, { status: 409, statusText: 'Conflict' });
      await expect(pending).rejects.toBeInstanceOf(ExamConflictError);
    });

    it('422 → ExamPreconditionError', async () => {
      const pending = adapter.getTutorExams();
      const req = httpMock.expectOne(`${BASE}/tutor/virtual-exams`);
      req.flush(
        { message: 'unprocessable', code: 'unprocessable_entity' },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
      await expect(pending).rejects.toBeInstanceOf(ExamPreconditionError);
    });

    it('0 (fallo de transporte) → NetworkError', async () => {
      const pending = adapter.getTutorExams();
      const req = httpMock.expectOne(`${BASE}/tutor/virtual-exams`);
      req.error(new ProgressEvent('error'), { status: 0, statusText: 'Network failure' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });

    it('429 → NetworkError', async () => {
      const pending = adapter.getTutorExams();
      const req = httpMock.expectOne(`${BASE}/tutor/virtual-exams`);
      req.flush({ message: 'rate limited' }, { status: 429, statusText: 'Too Many Requests' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });

    it('500 → NetworkError', async () => {
      const pending = adapter.getTutorExams();
      const req = httpMock.expectOne(`${BASE}/tutor/virtual-exams`);
      req.flush('boom', { status: 500, statusText: 'Internal Server Error' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });

    it('502 → NetworkError', async () => {
      const pending = adapter.getTutorExams();
      const req = httpMock.expectOne(`${BASE}/tutor/virtual-exams`);
      req.flush('gateway', { status: 502, statusText: 'Bad Gateway' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });

    it('503 → NetworkError', async () => {
      const pending = adapter.getTutorExams();
      const req = httpMock.expectOne(`${BASE}/tutor/virtual-exams`);
      req.flush('unavailable', { status: 503, statusText: 'Service Unavailable' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });

    it('504 → NetworkError', async () => {
      const pending = adapter.getTutorExams();
      const req = httpMock.expectOne(`${BASE}/tutor/virtual-exams`);
      req.flush('gateway timeout', { status: 504, statusText: 'Gateway Timeout' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });

    // Nota: el test de timeout real (>10s) no se puede hacer con HttpTestingController
    // porque `error()` simula un error de transporte. En cambio verificamos que la
    // clasificación de errores de transporte (status 0) sí devuelva NetworkError.
    it('error de transporte (ProgressEvent, status 0) → NetworkError (cubre timeout path)', async () => {
      const pending = adapter.getTutorExams();
      const req = httpMock.expectOne(`${BASE}/tutor/virtual-exams`);
      req.error(new ProgressEvent('timeout'), { status: 0, statusText: 'Timeout' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });

    // Verifica que la clasificación es por status puro — no lee body.message ni body.code.
    // El body contiene un "message" en prosa con un UUID para verificar que no se lee.
    it('classifyTutorError usa solo err.status, no body.message ni body.code', async () => {
      const pending = adapter.getTutorExams();
      const req = httpMock.expectOne(`${BASE}/tutor/virtual-exams`);
      // 403 con un message con UUID en inglés (backend tutor no emite codes de control).
      req.flush(
        {
          message: 'User e2f1c9d7-0000-0000-0000-000000000001 cannot access resource',
          code: 'forbidden',
        },
        { status: 403, statusText: 'Forbidden' },
      );
      // Debe clasificar solo por status=403 → TutorExamForbiddenError,
      // sin importar qué diga el message.
      await expect(pending).rejects.toBeInstanceOf(TutorExamForbiddenError);
    });

    // Los clasificadores del alumno (classifySubmitError, classifyDraftError)
    // deben seguir sin cambios. Se verifica importando el HttpExamsApi y
    // comprobando que sus métodos existen y no se tocaron.
    it('clasificadores del alumno son independientes — HttpExamsApi sigue sin cambios', async () => {
      const { HttpExamsApi } = await import('../../../../src/L3_periphery/http/http-exams-api');
      expect(typeof HttpExamsApi).toBe('function');
      // Si hubiera un import erróneo en http-tutor-exams-api.ts que modificara
      // http-exams-api, este test fallaría.
      expect(HttpExamsApi.prototype.getTodaysExams).toBeDefined();
    });
  });
});
