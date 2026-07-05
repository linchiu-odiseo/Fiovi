import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpExamsApi } from '../../../../src/L3_periphery/http/http-exams-api';
import { DraftRequest } from '../../../../src/L1_domain/ports/exams-api';
import { InvalidPayloadError } from '../../../../src/L1_domain/errors/invalid-payload.error';
import { NetworkError } from '../../../../src/L1_domain/errors/network.error';
import { SimulacroCerradoError } from '../../../../src/L1_domain/errors/simulacro-cerrado.error';
import { SimulacroNoAsignadoError } from '../../../../src/L1_domain/errors/simulacro-no-asignado.error';
import { StudentNotEnrolledError } from '../../../../src/L1_domain/errors/student-not-enrolled.error';
import { StudentNotLinkedError } from '../../../../src/L1_domain/errors/student-not-linked.error';
import { InvalidAdmissionAreaError } from '../../../../src/L1_domain/errors/invalid-admission-area.error';
import { environment } from '../../../../src/environments/environment';

// Cubre `HttpExamsApi.guardarDraft()` (L3) según los scenarios del spec
// `submit-progress-snapshot` Requirement "Clasificación de errores POST draft".
// IMPORTANTE: la regla del proyecto dice "clasificar por (status, endpoint,
// body.message)". Acá hay UNA excepción documentada (design.md D5/D10):
// leer `body.message` con igualdad ESTRICTA contra el set DRAFT_ERROR_MESSAGES.
// Tests cubren tanto el set cerrado como el fallback "valor desconocido → NetworkError".
describe('HttpExamsApi.guardarDraft (POST /draft)', () => {
  let httpMock: HttpTestingController;
  let adapter: HttpExamsApi;

  const SESSION_ID = '7620c18d-5b4d-4ef0-bf41-98352d21c2cf';
  const DRAFT_URL = `${environment.apiBaseUrl}/t/${environment.tenantSlug}/student/exam-sessions/${SESSION_ID}/draft`;

  const validRequest = (): DraftRequest => ({
    examId: SESSION_ID,
    code: '30303011',
    admissionArea: 'GENERAL',
    responses: 'A-C-',
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), HttpExamsApi],
    });
    httpMock = TestBed.inject(HttpTestingController);
    adapter = TestBed.inject(HttpExamsApi);
  });

  afterEach(() => httpMock.verify());

  describe('contrato URL + body', () => {
    it('emite POST a /t/{slug}/student/exam-sessions/{examId}/draft', async () => {
      const pending = adapter.guardarDraft(validRequest());

      const req = httpMock.expectOne(DRAFT_URL);
      expect(req.request.method).toBe('POST');

      req.flush(null, { status: 204, statusText: 'No Content' });
      await pending;
    });

    it('body exacto: { code, admission_area, responses: string } sin client_finished_at', async () => {
      const pending = adapter.guardarDraft(validRequest());

      const req = httpMock.expectOne(DRAFT_URL);
      // El responses viaja como STRING COMPACTO (no como Record).
      // El orden fijo `code, admission_area, responses` se testea con string
      // match en el describe "orden fijo de keys".
      expect(req.request.body).toEqual({
        code: '30303011',
        admission_area: 'GENERAL',
        responses: 'A-C-',
      });
      expect(typeof (req.request.body as { responses: unknown }).responses).toBe('string');
      // client_finished_at NO debe estar en el body
      expect(req.request.body).not.toHaveProperty('client_finished_at');

      req.flush(null, { status: 204, statusText: 'No Content' });
      await pending;
    });

    // Design D8: orden fijo `code, admission_area, responses` (SIN
    // client_finished_at — es exclusivo de /submit). Comparamos con
    // JSON.stringify contra literal para atrapar reordering silencioso.
    it('body preserva orden fijo de keys (design D8): code, admission_area, responses', async () => {
      const pending = adapter.guardarDraft({
        examId: SESSION_ID,
        code: '30303011',
        admissionArea: 'A',
        responses: 'A-C-',
      });

      const req = httpMock.expectOne(DRAFT_URL);
      const bodyJson = JSON.stringify(req.request.body);
      expect(bodyJson).toBe(
        '{"code":"30303011","admission_area":"A","responses":"A-C-"}',
      );

      req.flush(null, { status: 204, statusText: 'No Content' });
      await pending;
    });

    it('sessionId con caracteres especiales se encodea en la URL', async () => {
      const weirdId = 'foo/bar';
      const pending = adapter.guardarDraft({ ...validRequest(), examId: weirdId });

      const expectedUrl = `${environment.apiBaseUrl}/t/${environment.tenantSlug}/student/exam-sessions/foo%2Fbar/draft`;
      const req = httpMock.expectOne(expectedUrl);
      req.flush(null, { status: 204, statusText: 'No Content' });
      await pending;
    });

    it('NO setea withCredentials manualmente en la request (delegado al interceptor)', async () => {
      const pending = adapter.guardarDraft(validRequest());

      const req = httpMock.expectOne(DRAFT_URL);
      // withCredentials en FALSE indica que el adapter NO lo seteó — lo hace el interceptor global.
      expect(req.request.withCredentials).toBe(false);

      req.flush(null, { status: 204, statusText: 'No Content' });
      await pending;
    });
  });

  describe('204 No Content → resuelve void', () => {
    it('204 sin body → resuelve con undefined', async () => {
      const pending = adapter.guardarDraft(validRequest());
      const req = httpMock.expectOne(DRAFT_URL);
      req.flush(null, { status: 204, statusText: 'No Content' });

      const result = await pending;
      expect(result).toBeUndefined();
    });
  });

  describe('clasificación de errores por (status, body.message)', () => {
    it('400 → InvalidPayloadError', async () => {
      const pending = adapter.guardarDraft(validRequest());
      const req = httpMock.expectOne(DRAFT_URL);
      req.flush({ message: 'cualquier-cosa' }, { status: 400, statusText: 'Bad Request' });
      await expect(pending).rejects.toBeInstanceOf(InvalidPayloadError);
    });

    // Set DRAFT_ERROR_MESSAGES incluye 'INVALID_ADMISSION_AREA' desde el
    // change `add-admission-area`. 400 con ese message específico mapea a
    // InvalidAdmissionAreaError (no al genérico InvalidPayloadError).
    it('400 + INVALID_ADMISSION_AREA → InvalidAdmissionAreaError', async () => {
      const pending = adapter.guardarDraft(validRequest());
      const req = httpMock.expectOne(DRAFT_URL);
      req.flush(
        { message: 'INVALID_ADMISSION_AREA' },
        { status: 400, statusText: 'Bad Request' },
      );
      const err = await pending.catch((e) => e as Error);
      expect(err).toBeInstanceOf(InvalidAdmissionAreaError);
      expect(err).not.toBeInstanceOf(InvalidPayloadError);
    });

    it('403 + STUDENT_NOT_ENROLLED → StudentNotEnrolledError', async () => {
      const pending = adapter.guardarDraft(validRequest());
      const req = httpMock.expectOne(DRAFT_URL);
      req.flush({ message: 'STUDENT_NOT_ENROLLED' }, { status: 403, statusText: 'Forbidden' });
      await expect(pending).rejects.toBeInstanceOf(StudentNotEnrolledError);
    });

    it('403 + STUDENT_MISMATCH → NetworkError (retryable)', async () => {
      const pending = adapter.guardarDraft(validRequest());
      const req = httpMock.expectOne(DRAFT_URL);
      req.flush({ message: 'STUDENT_MISMATCH' }, { status: 403, statusText: 'Forbidden' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });

    it('403 + message fuera del enum → NetworkError', async () => {
      const pending = adapter.guardarDraft(validRequest());
      const req = httpMock.expectOne(DRAFT_URL);
      req.flush({ message: 'UNKNOWN_403' }, { status: 403, statusText: 'Forbidden' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });

    it('404 + SESSION_NOT_FOUND → SimulacroNoAsignadoError', async () => {
      const pending = adapter.guardarDraft(validRequest());
      const req = httpMock.expectOne(DRAFT_URL);
      req.flush({ message: 'SESSION_NOT_FOUND' }, { status: 404, statusText: 'Not Found' });
      await expect(pending).rejects.toBeInstanceOf(SimulacroNoAsignadoError);
    });

    it('404 + STUDENT_BY_CODE_NOT_FOUND → StudentNotLinkedError', async () => {
      const pending = adapter.guardarDraft(validRequest());
      const req = httpMock.expectOne(DRAFT_URL);
      req.flush(
        { message: 'STUDENT_BY_CODE_NOT_FOUND' },
        { status: 404, statusText: 'Not Found' },
      );
      await expect(pending).rejects.toBeInstanceOf(StudentNotLinkedError);
    });

    it('404 sin message conocido → NetworkError (autoheal si back deploya mid-sesión)', async () => {
      const pending = adapter.guardarDraft(validRequest());
      const req = httpMock.expectOne(DRAFT_URL);
      req.flush({}, { status: 404, statusText: 'Not Found' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });

    it('404 con message fuera del enum → NetworkError', async () => {
      const pending = adapter.guardarDraft(validRequest());
      const req = httpMock.expectOne(DRAFT_URL);
      req.flush({ message: 'OTRO_MESSAGE' }, { status: 404, statusText: 'Not Found' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });

    it('409 + SESSION_NOT_ACTIVE → SimulacroCerradoError', async () => {
      const pending = adapter.guardarDraft(validRequest());
      const req = httpMock.expectOne(DRAFT_URL);
      req.flush({ message: 'SESSION_NOT_ACTIVE' }, { status: 409, statusText: 'Conflict' });
      await expect(pending).rejects.toBeInstanceOf(SimulacroCerradoError);
    });

    it('409 + message fuera del enum → NetworkError', async () => {
      const pending = adapter.guardarDraft(validRequest());
      const req = httpMock.expectOne(DRAFT_URL);
      req.flush({ message: 'OTRO_409' }, { status: 409, statusText: 'Conflict' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });

    it('429 → NetworkError', async () => {
      const pending = adapter.guardarDraft(validRequest());
      const req = httpMock.expectOne(DRAFT_URL);
      req.flush({ message: 'rate-limit' }, { status: 429, statusText: 'Too Many Requests' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });

    it('500 → NetworkError', async () => {
      const pending = adapter.guardarDraft(validRequest());
      const req = httpMock.expectOne(DRAFT_URL);
      req.flush('boom', { status: 500, statusText: 'Internal Server Error' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });

    it('502 → NetworkError', async () => {
      const pending = adapter.guardarDraft(validRequest());
      const req = httpMock.expectOne(DRAFT_URL);
      req.flush('bad gateway', { status: 502, statusText: 'Bad Gateway' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });

    it('503 → NetworkError', async () => {
      const pending = adapter.guardarDraft(validRequest());
      const req = httpMock.expectOne(DRAFT_URL);
      req.flush('unavailable', { status: 503, statusText: 'Service Unavailable' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });

    it('fallo de transporte (status 0) → NetworkError', async () => {
      const pending = adapter.guardarDraft(validRequest());
      const req = httpMock.expectOne(DRAFT_URL);
      req.error(new ProgressEvent('error'), { status: 0, statusText: 'Network failure' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });

    it('timeout (10s) → NetworkError', async () => {
      vi.useFakeTimers();
      try {
        const pending = adapter.guardarDraft(validRequest());
        httpMock.expectOne(DRAFT_URL); // la request existe, no se responde

        // Avanzar más de 10s para que el timeout rxjs dispare.
        vi.advanceTimersByTime(10_001);

        await expect(pending).rejects.toBeInstanceOf(NetworkError);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('clasificador NO usa .includes() ni regex sobre message', () => {
    it('message con prefijo del enum NO dispara la rama del enum (igualdad estricta)', async () => {
      // 'SESSION_NOT_ACTIVE_EXTRA' no está en el enum → cae a NetworkError por status 409.
      const pending = adapter.guardarDraft(validRequest());
      const req = httpMock.expectOne(DRAFT_URL);
      req.flush({ message: 'SESSION_NOT_ACTIVE_EXTRA' }, { status: 409, statusText: 'Conflict' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });

    it('message con sufijo del enum NO dispara la rama del enum (igualdad estricta)', async () => {
      // 'PRE_SESSION_NOT_FOUND' no está en el enum → 404 sin message conocido → NetworkError.
      const pending = adapter.guardarDraft(validRequest());
      const req = httpMock.expectOne(DRAFT_URL);
      req.flush({ message: 'PRE_SESSION_NOT_FOUND' }, { status: 404, statusText: 'Not Found' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });
  });
});
