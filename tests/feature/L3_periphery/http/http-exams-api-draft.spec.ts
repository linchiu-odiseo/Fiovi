import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpExamsApi } from '../../../../src/L3_periphery/http/http-exams-api';
import { SlugStore } from '../../../../src/L3_periphery/http/slug-store';
import { DraftRequest } from '../../../../src/L1_domain/ports/exams-api';
import {
  DRAFT_DELTA_TOKEN,
  DRAFT_VERSION_TOKEN,
} from '../../../../src/L3_periphery/telemetry/tokens';

const TEST_SLUG = 'vonex';
import { InvalidPayloadError } from '../../../../src/L1_domain/errors/invalid-payload.error';
import { NetworkError } from '../../../../src/L1_domain/errors/network.error';
import { SimulacroCerradoError } from '../../../../src/L1_domain/errors/simulacro-cerrado.error';
import { SimulacroNoAsignadoError } from '../../../../src/L1_domain/errors/simulacro-no-asignado.error';
import { StudentNotEnrolledError } from '../../../../src/L1_domain/errors/student-not-enrolled.error';
import { StudentNotLinkedError } from '../../../../src/L1_domain/errors/student-not-linked.error';
import { InvalidAdmissionAreaError } from '../../../../src/L1_domain/errors/invalid-admission-area.error';
import { ExamNotOpenYetError } from '../../../../src/L1_domain/errors/exam-not-open-yet.error';
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
  const DRAFT_URL = `${environment.apiBaseUrl}/t/${TEST_SLUG}/student/exam-sessions/${SESSION_ID}/draft`;

  const validRequest = (): DraftRequest => ({
    examId: SESSION_ID,
    code: '30303011',
    admissionArea: 'GENERAL',
    responses: 'A-C-',
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
      expect(bodyJson).toBe('{"code":"30303011","admission_area":"A","responses":"A-C-"}');

      req.flush(null, { status: 204, statusText: 'No Content' });
      await pending;
    });

    it('sessionId con caracteres especiales se encodea en la URL', async () => {
      const weirdId = 'foo/bar';
      const pending = adapter.guardarDraft({ ...validRequest(), examId: weirdId });

      const expectedUrl = `${environment.apiBaseUrl}/t/${TEST_SLUG}/student/exam-sessions/foo%2Fbar/draft`;
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
      req.flush({ message: 'INVALID_ADMISSION_AREA' }, { status: 400, statusText: 'Bad Request' });
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
      req.flush({ message: 'STUDENT_BY_CODE_NOT_FOUND' }, { status: 404, statusText: 'Not Found' });
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

  describe('REQ-PA-03-DRAFT: 422 exam_not_open_yet', () => {
    it('422 + code=exam_not_open_yet + startedAt → ExamNotOpenYetError con Date válido', async () => {
      const pending = adapter.guardarDraft(validRequest());
      const req = httpMock.expectOne(DRAFT_URL);
      req.flush(
        { code: 'exam_not_open_yet', startedAt: '2026-08-20T08:00:00.000Z' },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
      const err = await pending.catch((e) => e as Error);
      expect(err).toBeInstanceOf(ExamNotOpenYetError);
      const notOpen = err as ExamNotOpenYetError;
      expect(notOpen.startedAt).not.toBeNull();
      expect(notOpen.startedAt?.getTime()).toBe(new Date('2026-08-20T08:00:00.000Z').getTime());
    });

    it('422 + code=exam_not_open_yet sin startedAt → ExamNotOpenYetError con startedAt null', async () => {
      const pending = adapter.guardarDraft(validRequest());
      const req = httpMock.expectOne(DRAFT_URL);
      req.flush({ code: 'exam_not_open_yet' }, { status: 422, statusText: 'Unprocessable Entity' });
      const err = await pending.catch((e) => e as Error);
      expect(err).toBeInstanceOf(ExamNotOpenYetError);
      const notOpen = err as ExamNotOpenYetError;
      expect(notOpen.startedAt).toBeNull();
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

  // Sub-bloque C (design.md § Revision Log 2026-09-04): v+chg en eventos H
  // de draft. El adapter computa el delta de composición vs el último draft
  // emitido con ÉXITO y lo setea en HttpContext vía DRAFT_VERSION_TOKEN /
  // DRAFT_DELTA_TOKEN — el interceptor solo los lee (cubierto en
  // audit-log-interceptor.spec.ts).
  describe('DRAFT_VERSION_TOKEN + DRAFT_DELTA_TOKEN (Sub-bloque C)', () => {
    it('primer draft de la sesión: v=1 y chg = composición completa', async () => {
      const pending = adapter.guardarDraft({ ...validRequest(), responses: 'AB-C' });
      const req = httpMock.expectOne(DRAFT_URL);

      expect(req.request.context.get(DRAFT_VERSION_TOKEN)).toBe(1);
      expect(req.request.context.get(DRAFT_DELTA_TOKEN)).toEqual([
        [1, 'A'],
        [2, 'B'],
        [4, 'C'],
      ]);

      req.flush(null, { status: 204, statusText: 'No Content' });
      await pending;
    });

    it('segundo draft con q1 cambiado de A a B: v=2 y chg=[[1,"B"]]', async () => {
      const first = adapter.guardarDraft({ ...validRequest(), responses: 'A---' });
      httpMock.expectOne(DRAFT_URL).flush(null, { status: 204, statusText: 'No Content' });
      await first;

      const second = adapter.guardarDraft({ ...validRequest(), responses: 'B---' });
      const req = httpMock.expectOne(DRAFT_URL);
      expect(req.request.context.get(DRAFT_VERSION_TOKEN)).toBe(2);
      expect(req.request.context.get(DRAFT_DELTA_TOKEN)).toEqual([[1, 'B']]);

      req.flush(null, { status: 204, statusText: 'No Content' });
      await second;
    });

    it('draft con q1 desmarcado (cleared): chg=[[1,"0"]]', async () => {
      const first = adapter.guardarDraft({ ...validRequest(), responses: 'A---' });
      httpMock.expectOne(DRAFT_URL).flush(null, { status: 204, statusText: 'No Content' });
      await first;

      const second = adapter.guardarDraft({ ...validRequest(), responses: '----' });
      const req = httpMock.expectOne(DRAFT_URL);
      expect(req.request.context.get(DRAFT_VERSION_TOKEN)).toBe(2);
      expect(req.request.context.get(DRAFT_DELTA_TOKEN)).toEqual([[1, '0']]);

      req.flush(null, { status: 204, statusText: 'No Content' });
      await second;
    });

    it('draft sin cambio de composición: chg=[] pero v se incrementa igual (evento real)', async () => {
      const first = adapter.guardarDraft({ ...validRequest(), responses: 'A-C-' });
      httpMock.expectOne(DRAFT_URL).flush(null, { status: 204, statusText: 'No Content' });
      await first;

      const second = adapter.guardarDraft({ ...validRequest(), responses: 'A-C-' });
      const req = httpMock.expectOne(DRAFT_URL);
      expect(req.request.context.get(DRAFT_VERSION_TOKEN)).toBe(2);
      expect(req.request.context.get(DRAFT_DELTA_TOKEN)).toEqual([]);

      req.flush(null, { status: 204, statusText: 'No Content' });
      await second;
    });

    // Fallo NO debe adelantar el baseline ni la versión confirmada: el
    // próximo intento reenvía el MISMO v y el MISMO chg (o uno más fresco si
    // la composición cambió mientras tanto).
    it('si el POST falla, el siguiente intento reusa el mismo v y el mismo chg', async () => {
      const failed = adapter.guardarDraft({ ...validRequest(), responses: 'A---' });
      const failReq = httpMock.expectOne(DRAFT_URL);
      expect(failReq.request.context.get(DRAFT_VERSION_TOKEN)).toBe(1);
      expect(failReq.request.context.get(DRAFT_DELTA_TOKEN)).toEqual([[1, 'A']]);
      failReq.flush('boom', { status: 500, statusText: 'Internal Server Error' });
      await expect(failed).rejects.toBeInstanceOf(NetworkError);

      const retry = adapter.guardarDraft({ ...validRequest(), responses: 'A---' });
      const retryReq = httpMock.expectOne(DRAFT_URL);
      expect(retryReq.request.context.get(DRAFT_VERSION_TOKEN)).toBe(1);
      expect(retryReq.request.context.get(DRAFT_DELTA_TOKEN)).toEqual([[1, 'A']]);
      retryReq.flush(null, { status: 204, statusText: 'No Content' });
      await retry;
    });
  });

  // C.7: aislamiento del versionado por sessionId. El versionCounter y
  // lastEmittedComposition viven en un Map keyed por sessionId — una sesión
  // nueva NO debe heredar el baseline ni el contador de otra.
  describe('aislamiento de versionado entre sesiones (C.7)', () => {
    it('un sessionId nuevo arranca versionCounter en 1 y no ve la composición de otra sesión como baseline', async () => {
      const SESSION_A = SESSION_ID;
      const SESSION_B = 'b6a1e6a0-0000-4ef0-bf41-98352d21c2cf';
      const urlB = `${environment.apiBaseUrl}/t/${TEST_SLUG}/student/exam-sessions/${SESSION_B}/draft`;

      // sessionA llega a v=2 con q1=A marcado.
      const a1 = adapter.guardarDraft({ ...validRequest(), examId: SESSION_A, responses: 'A---' });
      httpMock.expectOne(DRAFT_URL).flush(null, { status: 204, statusText: 'No Content' });
      await a1;
      const a2 = adapter.guardarDraft({ ...validRequest(), examId: SESSION_A, responses: 'A---' });
      httpMock.expectOne(DRAFT_URL).flush(null, { status: 204, statusText: 'No Content' });
      await a2;

      // sessionB es nueva: mismo composición 'A---' pero debe verse como
      // "added" (chg no vacío) y v=1 — si heredara el baseline de sessionA
      // esto daría chg=[] y v=3.
      const b1 = adapter.guardarDraft({ ...validRequest(), examId: SESSION_B, responses: 'A---' });
      const reqB = httpMock.expectOne(urlB);
      expect(reqB.request.context.get(DRAFT_VERSION_TOKEN)).toBe(1);
      expect(reqB.request.context.get(DRAFT_DELTA_TOKEN)).toEqual([[1, 'A']]);
      reqB.flush(null, { status: 204, statusText: 'No Content' });
      await b1;
    });
  });
});
