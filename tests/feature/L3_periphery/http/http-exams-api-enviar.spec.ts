import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpExamsApi } from '../../../../src/L3_periphery/http/http-exams-api';
import { SlugStore } from '../../../../src/L3_periphery/http/slug-store';
import { EnvioRequest } from '../../../../src/L1_domain/ports/exams-api';
import { SubmissionAck } from '../../../../src/L1_domain/value-objects/submission-ack';
import { InvalidPayloadError } from '../../../../src/L1_domain/errors/invalid-payload.error';
import { InvalidSubmissionTimeError } from '../../../../src/L1_domain/errors/invalid-submission-time.error';
import { NetworkError } from '../../../../src/L1_domain/errors/network.error';
import { SimulacroCerradoError } from '../../../../src/L1_domain/errors/simulacro-cerrado.error';
import { SimulacroNoAsignadoError } from '../../../../src/L1_domain/errors/simulacro-no-asignado.error';
import { StudentNotEnrolledError } from '../../../../src/L1_domain/errors/student-not-enrolled.error';
import { InvalidAdmissionAreaError } from '../../../../src/L1_domain/errors/invalid-admission-area.error';
import { environment } from '../../../../src/environments/environment';

const TEST_SLUG = 'vonex';

// Cubre `HttpExamsApi.enviar()` (L3) según el spec
// `fase-3-exam-submit-learnex` `http-client` Requirements:
// - URL real `/t/{slug}/student/exam-sessions/{sessionId}/submit`
// - Body snake_case `{ code, responses, client_finished_at }`
// - 201 mapea a SubmissionAck con shape validado por el VO
// - Clasificación de errores por (status, body.message) con enum cerrado:
//   * 400 → InvalidPayloadError
//   * 403 STUDENT_NOT_ENROLLED → StudentNotEnrolledError
//   * 403 STUDENT_MISMATCH / otros → NetworkError genérico
//   * 404 → SimulacroNoAsignadoError
//   * 409 SESSION_NOT_ACTIVE → SimulacroCerradoError
//   * 422 CLOCK_SKEW_* → InvalidSubmissionTimeError
//   * 422 otros / 429 / 5xx → NetworkError
//
// IMPORTANTE: la regla del proyecto dice "clasificar por (status, endpoint,
// code)". Acá hay UNA excepción documentada (design.md D5): leer `body.message`
// para el endpoint submit, con set enumerado cerrado. Los tests cubren tanto
// el set cerrado como el fallback de "valor desconocido → NetworkError".
describe('HttpExamsApi.enviar (POST real)', () => {
  let httpMock: HttpTestingController;
  let adapter: HttpExamsApi;

  // El path se arma desde environment para que cambios en tenantSlug se
  // propaguen sin tocar tests.
  const SESSION_ID = '7620c18d-5b4d-4ef0-bf41-98352d21c2cf';
  const SUBMIT_URL = `${environment.apiBaseUrl}/t/${TEST_SLUG}/student/exam-sessions/${SESSION_ID}/submit`;

  // Hash sha256 hex válido (64 chars) — coincide con el seed del test del VO.
  const VALID_HASH = 'a3f5c8d1b2e4f6a8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
  const VALID_SUBMITTED_AT_ISO = '2026-06-17T15:29:54.531Z';

  const validRequest = (): EnvioRequest => ({
    examId: SESSION_ID,
    code: '30303011',
    admissionArea: 'GENERAL',
    responses: { P1: 'A', P2: 'C' },
    clientFinishedAt: '2026-06-17T15:29:54.000Z',
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

  describe('contrato URL + body', () => {
    it('emite POST a `/t/{slug}/student/exam-sessions/{examId}/submit` con body snake_case', async () => {
      const pending = adapter.enviar(validRequest());

      const req = httpMock.expectOne(SUBMIT_URL);
      expect(req.request.method).toBe('POST');
      // Body exacto al contrato learnex: snake_case, sin claves extra.
      // El orden fijo `code, admission_area, responses, client_finished_at`
      // se testea con string match en el describe "orden fijo de keys".
      expect(req.request.body).toEqual({
        code: '30303011',
        admission_area: 'GENERAL',
        responses: { P1: 'A', P2: 'C' },
        client_finished_at: '2026-06-17T15:29:54.000Z',
      });

      req.flush({
        id: 'ack-1',
        submission_hash: VALID_HASH,
        submitted_at: VALID_SUBMITTED_AT_ISO,
      });
      await pending;
    });

    // El design.md D8 de `add-admission-area` fija el orden de keys:
    // `code, admission_area, responses, client_finished_at`. Aunque el orden
    // en JSON no cambia el parseo del back, afecta la legibilidad de logs
    // y el `submission_hash` si el back lo computa sobre JSON.stringify sin
    // canonicalización. Comparamos con JSON.stringify contra un literal
    // exacto para atrapar cualquier reordering silencioso.
    it('body preserva orden fijo de keys (design D8): code, admission_area, responses, client_finished_at', async () => {
      const pending = adapter.enviar({
        examId: SESSION_ID,
        code: '30303011',
        admissionArea: 'A',
        responses: { P1: 'A', P2: 'C' },
        clientFinishedAt: '2026-06-17T15:29:54.000Z',
      });

      const req = httpMock.expectOne(SUBMIT_URL);
      const bodyJson = JSON.stringify(req.request.body);
      expect(bodyJson).toBe(
        '{"code":"30303011","admission_area":"A","responses":{"P1":"A","P2":"C"},"client_finished_at":"2026-06-17T15:29:54.000Z"}',
      );

      req.flush({
        id: 'ack-1',
        submission_hash: VALID_HASH,
        submitted_at: VALID_SUBMITTED_AT_ISO,
      });
      await pending;
    });

    it('examId con caracteres especiales se encodea en la URL', async () => {
      // Defensa: aunque el contrato lo define como UUID v4, el helper aplica
      // encodeURIComponent. Confirmamos que el adapter llega con la URL
      // encodeada bien armada.
      const weirdId = 'foo/bar';
      const pending = adapter.enviar({
        ...validRequest(),
        examId: weirdId,
      });

      const expectedUrl = `${environment.apiBaseUrl}/t/${TEST_SLUG}/student/exam-sessions/foo%2Fbar/submit`;
      const req = httpMock.expectOne(expectedUrl);

      req.flush({
        id: 'ack-x',
        submission_hash: VALID_HASH,
        submitted_at: VALID_SUBMITTED_AT_ISO,
      });
      await pending;
    });
  });

  describe('201 — éxito mapea a SubmissionAck', () => {
    it('retorna { ack } con id, submissionHash, submittedAt parseados', async () => {
      const pending = adapter.enviar(validRequest());

      const req = httpMock.expectOne(SUBMIT_URL);
      req.flush({
        id: 'ack-uuid-1',
        submission_hash: VALID_HASH,
        submitted_at: VALID_SUBMITTED_AT_ISO,
      });

      const result = await pending;
      expect(result.ack).toBeInstanceOf(SubmissionAck);
      expect(result.ack.id).toBe('ack-uuid-1');
      expect(result.ack.submissionHash).toBe(VALID_HASH);
      expect(result.ack.submittedAt.getTime()).toBe(new Date(VALID_SUBMITTED_AT_ISO).getTime());
    });

    it('si el back devuelve hash inválido, el VO lanza y el adapter propaga el error', async () => {
      // El constructor del VO valida shape. Si el back rompiera el contrato,
      // queremos que el cliente falle ruidoso en vez de pasar basura al storage.
      const pending = adapter.enviar(validRequest());

      const req = httpMock.expectOne(SUBMIT_URL);
      req.flush({
        id: 'ack-bad',
        submission_hash: 'no-es-hex',
        submitted_at: VALID_SUBMITTED_AT_ISO,
      });

      await expect(pending).rejects.toBeInstanceOf(Error);
    });
  });

  describe('clasificación de errores por (status, body.message)', () => {
    it('400 → InvalidPayloadError', async () => {
      const pending = adapter.enviar(validRequest());
      const req = httpMock.expectOne(SUBMIT_URL);
      req.flush({ message: 'cualquier-cosa' }, { status: 400, statusText: 'Bad Request' });
      await expect(pending).rejects.toBeInstanceOf(InvalidPayloadError);
    });

    // El set SUBMIT_ERROR_MESSAGES incluye 'INVALID_ADMISSION_AREA' desde el
    // change `add-admission-area`. 400 con ese message específico mapea a
    // InvalidAdmissionAreaError (no al genérico InvalidPayloadError).
    it('400 + body.message === "INVALID_ADMISSION_AREA" → InvalidAdmissionAreaError', async () => {
      const pending = adapter.enviar(validRequest());
      const req = httpMock.expectOne(SUBMIT_URL);
      req.flush({ message: 'INVALID_ADMISSION_AREA' }, { status: 400, statusText: 'Bad Request' });
      const err = await pending.catch((e) => e as Error);
      // Assert dura: es InvalidAdmissionAreaError, NO InvalidPayloadError.
      // Si el clasificador cayera al default, el catch abajo probaría el bug.
      expect(err).toBeInstanceOf(InvalidAdmissionAreaError);
      expect(err).not.toBeInstanceOf(InvalidPayloadError);
    });

    it('403 + body.message === "STUDENT_NOT_ENROLLED" → StudentNotEnrolledError', async () => {
      const pending = adapter.enviar(validRequest());
      const req = httpMock.expectOne(SUBMIT_URL);
      req.flush({ message: 'STUDENT_NOT_ENROLLED' }, { status: 403, statusText: 'Forbidden' });
      await expect(pending).rejects.toBeInstanceOf(StudentNotEnrolledError);
    });

    it('403 + body.message === "STUDENT_MISMATCH" → NetworkError (genérico, sin clase dedicada)', async () => {
      const pending = adapter.enviar(validRequest());
      const req = httpMock.expectOne(SUBMIT_URL);
      req.flush({ message: 'STUDENT_MISMATCH' }, { status: 403, statusText: 'Forbidden' });
      // El clasificador discriminó por message: cae al genérico NetworkError,
      // NO a StudentNotEnrolledError (que es el 403 con message
      // "STUDENT_NOT_ENROLLED" — cubierto en el test anterior).
      const err = await pending.catch((e) => e as Error);
      expect(err).toBeInstanceOf(NetworkError);
      expect(err).not.toBeInstanceOf(StudentNotEnrolledError);
    });

    it('403 con message desconocido → NetworkError (fallback)', async () => {
      const pending = adapter.enviar(validRequest());
      const req = httpMock.expectOne(SUBMIT_URL);
      req.flush({ message: 'UNDOCUMENTED_REASON' }, { status: 403, statusText: 'Forbidden' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });

    it('403 sin body.message → NetworkError (fallback)', async () => {
      const pending = adapter.enviar(validRequest());
      const req = httpMock.expectOne(SUBMIT_URL);
      req.flush({}, { status: 403, statusText: 'Forbidden' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });

    it('404 → SimulacroNoAsignadoError', async () => {
      const pending = adapter.enviar(validRequest());
      const req = httpMock.expectOne(SUBMIT_URL);
      req.flush({ message: 'not-found' }, { status: 404, statusText: 'Not Found' });
      await expect(pending).rejects.toBeInstanceOf(SimulacroNoAsignadoError);
    });

    it('409 + body.message === "SESSION_NOT_ACTIVE" → SimulacroCerradoError', async () => {
      const pending = adapter.enviar(validRequest());
      const req = httpMock.expectOne(SUBMIT_URL);
      req.flush({ message: 'SESSION_NOT_ACTIVE' }, { status: 409, statusText: 'Conflict' });
      await expect(pending).rejects.toBeInstanceOf(SimulacroCerradoError);
    });

    it('409 con message desconocido → NetworkError (fallback)', async () => {
      const pending = adapter.enviar(validRequest());
      const req = httpMock.expectOne(SUBMIT_URL);
      req.flush({ message: 'SOMETHING_ELSE' }, { status: 409, statusText: 'Conflict' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });

    it('422 + body.message === "CLOCK_SKEW_BEFORE_START" → InvalidSubmissionTimeError', async () => {
      const pending = adapter.enviar(validRequest());
      const req = httpMock.expectOne(SUBMIT_URL);
      req.flush(
        { message: 'CLOCK_SKEW_BEFORE_START' },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
      await expect(pending).rejects.toBeInstanceOf(InvalidSubmissionTimeError);
    });

    it('422 + body.message === "CLOCK_SKEW_TOO_FAR_FUTURE" → InvalidSubmissionTimeError', async () => {
      const pending = adapter.enviar(validRequest());
      const req = httpMock.expectOne(SUBMIT_URL);
      req.flush(
        { message: 'CLOCK_SKEW_TOO_FAR_FUTURE' },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
      await expect(pending).rejects.toBeInstanceOf(InvalidSubmissionTimeError);
    });

    // Test CRÍTICO de la excepción documentada: el clasificador NO debe
    // tratar cualquier 422 con message custom como InvalidSubmissionTimeError.
    // El set enumerado es cerrado — anything outside → NetworkError.
    it('422 con message fuera del enum (`UNKNOWN_REASON`) → NetworkError (fallback)', async () => {
      const pending = adapter.enviar(validRequest());
      const req = httpMock.expectOne(SUBMIT_URL);
      req.flush({ message: 'UNKNOWN_REASON' }, { status: 422, statusText: 'Unprocessable Entity' });
      const err = await pending.catch((e) => e as Error);
      // Asserts duros sobre la misma instancia: es NetworkError y NO es
      // InvalidSubmissionTimeError (probaría que el clasificador leyó message
      // sin enum cerrado y mapeó cualquier 422 a invalid-time).
      expect(err).toBeInstanceOf(NetworkError);
      expect(err).not.toBeInstanceOf(InvalidSubmissionTimeError);
    });

    it('429 → NetworkError', async () => {
      const pending = adapter.enviar(validRequest());
      const req = httpMock.expectOne(SUBMIT_URL);
      req.flush({ message: 'rate-limited' }, { status: 429, statusText: 'Too Many Requests' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });

    it('500 → NetworkError', async () => {
      const pending = adapter.enviar(validRequest());
      const req = httpMock.expectOne(SUBMIT_URL);
      req.flush({ message: 'boom' }, { status: 500, statusText: 'Internal Server Error' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });

    it('503 → NetworkError', async () => {
      const pending = adapter.enviar(validRequest());
      const req = httpMock.expectOne(SUBMIT_URL);
      req.flush({}, { status: 503, statusText: 'Service Unavailable' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });

    it('status 0 (transporte) → NetworkError', async () => {
      const pending = adapter.enviar(validRequest());
      const req = httpMock.expectOne(SUBMIT_URL);
      req.error(new ProgressEvent('error'), { status: 0, statusText: '' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });
  });
});
