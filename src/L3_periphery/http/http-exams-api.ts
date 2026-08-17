import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { timeout } from 'rxjs/operators';
import {
  DraftRequest,
  EnvioRequest,
  EnvioResult,
  ExamsApi,
  ExamsListResult,
  MySubmission,
} from '../../L1_domain/ports/exams-api';
import { Exam } from '../../L1_domain/entities/exam';
import { ExamServerStatus } from '../../L1_domain/value-objects/exam-server-status';
import { ServerTime } from '../../L1_domain/value-objects/server-time';
import { SubmissionAck } from '../../L1_domain/value-objects/submission-ack';
import { AlternativaValue, AnswersMap } from '../../L1_domain/ports/markings-storage';
import { isAdmissionArea } from '../../L1_domain/value-objects/admission-area';
import { ExamNotOpenYetError } from '../../L1_domain/errors/exam-not-open-yet.error';
import { InvalidAdmissionAreaError } from '../../L1_domain/errors/invalid-admission-area.error';
import { InvalidExamError } from '../../L1_domain/errors/invalid-exam.error';
import { InvalidPayloadError } from '../../L1_domain/errors/invalid-payload.error';
import { InvalidSubmissionTimeError } from '../../L1_domain/errors/invalid-submission-time.error';
import { NetworkError } from '../../L1_domain/errors/network.error';
import { ExamsPermissionRevokedError } from '../../L1_domain/errors/exams-permission-revoked.error';
import { SimulacroCerradoError } from '../../L1_domain/errors/simulacro-cerrado.error';
import { SimulacroNoAsignadoError } from '../../L1_domain/errors/simulacro-no-asignado.error';
import { StudentNotEnrolledError } from '../../L1_domain/errors/student-not-enrolled.error';
import { StudentNotLinkedError } from '../../L1_domain/errors/student-not-linked.error';
import { apiPath } from './api-paths';
import { SlugStore } from './slug-store';

interface ExamDto {
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
  // ISO datetime en modo "tarea"; null en modo "examen".
  // Wire: `open_until` en snake_case (endpoints del alumno de learnex).
  open_until: string | null;
  // Snapshot al CREATE del examen desde `ExamStructureArea.name` (learnex
  // PR #816). Wire: `admission_areas` en snake_case. `null` para FICHAS y
  // exámenes legacy; array de strings arbitrarios para EXAMENES con
  // estructura (labels pueden estar fuera de `KnownAdmissionArea`).
  // Opcional en el DTO — respuestas legacy pre-rollout no lo traen.
  admission_areas?: string[] | null;
}

interface ExamsListResponseDto {
  serverTime: string;
  exams: ExamDto[];
}

// Shape exacto del response 201 del back según
// .authentic/contrato-pwa-submit.md:
//   { id, submission_hash, submitted_at } en snake_case.
interface SubmitResponseDto {
  id: string;
  submission_hash: string;
  submitted_at: string;
}

// Shape del GET /my-submission — fuente de verdad del historial cuando no hay
// ack local. `responses` viene con keys `P<n>` (misma forma que el body del
// submit); el mapper convierte a AnswersMap con keys de string de número.
interface MySubmissionResponseDto {
  id: string;
  submission_hash: string;
  submitted_at: string;
  client_finished_at: string;
  responses: Record<string, 'A' | 'B' | 'C' | 'D' | 'E'>;
  admission_area: string | null;
  source: 'manual' | 'auto_saved';
}

// Enum cerrado de valores que el back emite en `body.message` para el POST
// submit. Esta es la ÚNICA excepción documentada a la regla "nunca leer
// message" — ver design.md D5 de `fase-3-exam-submit-learnex` y D8 de
// `add-admission-area`. Cualquier valor de `message` fuera de este set se
// trata como `NetworkError` y la clasificación cae al default por status.
type SubmitErrorMessage =
  | 'INVALID_ADMISSION_AREA'
  | 'STUDENT_NOT_ENROLLED'
  | 'STUDENT_MISMATCH'
  | 'SESSION_NOT_ACTIVE'
  | 'CLOCK_SKEW_BEFORE_START'
  | 'CLOCK_SKEW_TOO_FAR_FUTURE'
  // Códigos adicionales del endpoint /submit-homework — el enum es superset
  // porque `classifySubmitError` sirve a ambos endpoints; el submit clásico
  // nunca los emite. Ambos se mapean a SimulacroCerradoError (misma UX que
  // "sesión cerrada" al recibir 409).
  | 'NOT_HOMEWORK_MODE'
  | 'HOMEWORK_WINDOW_CLOSED';

const SUBMIT_ERROR_MESSAGES: ReadonlySet<SubmitErrorMessage> = new Set([
  'INVALID_ADMISSION_AREA',
  'STUDENT_NOT_ENROLLED',
  'STUDENT_MISMATCH',
  'SESSION_NOT_ACTIVE',
  'CLOCK_SKEW_BEFORE_START',
  'CLOCK_SKEW_TOO_FAR_FUTURE',
  'NOT_HOMEWORK_MODE',
  'HOMEWORK_WINDOW_CLOSED',
]);

// Segundo set enumerado cerrado para el POST /draft. EXCEPCIÓN documentada a
// la regla "nunca leer message" (design.md D5/D10 de `draft-auto-save` +
// D8 de `add-admission-area`): misma justificación que SUBMIT_ERROR_MESSAGES —
// son códigos de control en mayúsculas snake_case, no i18n humano.
// Comparación por igualdad ESTRICTA (===), jamás .includes() ni regex sobre
// message.
type DraftErrorMessage =
  | 'INVALID_ADMISSION_AREA'
  | 'STUDENT_NOT_ENROLLED'
  | 'STUDENT_MISMATCH'
  | 'SESSION_NOT_FOUND'
  | 'STUDENT_BY_CODE_NOT_FOUND'
  | 'SESSION_NOT_ACTIVE';

const DRAFT_ERROR_MESSAGES: ReadonlySet<DraftErrorMessage> = new Set([
  'INVALID_ADMISSION_AREA',
  'STUDENT_NOT_ENROLLED',
  'STUDENT_MISMATCH',
  'SESSION_NOT_FOUND',
  'STUDENT_BY_CODE_NOT_FOUND',
  'SESSION_NOT_ACTIVE',
]);

@Injectable({ providedIn: 'root' })
export class HttpExamsApi implements ExamsApi {
  private readonly http = inject(HttpClient);
  private readonly slugStore = inject(SlugStore);

  // Los endpoints tenant-scoped (`/t/{slug}/...`) leen el slug del SlugStore
  // hidratado en APP_INITIALIZER. Si el slug es null, algún caller invocó
  // el use case sin identity activa — señalizamos NetworkError para que la
  // UI degrade sin loop de refresh (auth.guard debería haber redirigido antes).
  private requireSlug(): string {
    const slug = this.slugStore.current();
    if (!slug) throw new NetworkError();
    return slug;
  }

  async getTodaysExams(): Promise<ExamsListResult> {
    try {
      const dto = await firstValueFrom(
        this.http.get<ExamsListResponseDto>(apiPath.studentExamSessions(this.requireSlug())),
      );
      // Pasa el DTO al dominio sin filtrar: los casos `in_progress` con
      // `started === null` (data rara que el back en teoría nunca emite)
      // se aceptan igual. La PWA es resiliente — el view-model los muestra
      // como entrables con banner "tomando un café" + botón Enviar disabled,
      // exactamente como cuando `started` cae en el futuro. La puerta
      // sigue siendo `serverStatus`; la vigencia la decide `hasStartedBy(now)`.
      return {
        exams: dto.exams.map((e) => this.toExam(e)),
        serverTime: new ServerTime(dto.serverTime),
      };
    } catch (err) {
      throw this.classifyListError(err);
    }
  }

  // POST /t/{slug}/student/exam-sessions/{sessionId}/submit
  // `req.examId` ES el sessionId (confirmado por back en handoff de
  // `fase-3-exam-submit-learnex`). Body en snake_case según contrato.
  // Orden fijo: `code, admission_area, responses, client_finished_at`
  // (design.md D8 de `add-admission-area`).
  // `withCredentials` lo agrega el `credentials.interceptor` global —
  // NO lo seteamos acá.
  async enviar(req: EnvioRequest): Promise<EnvioResult> {
    try {
      const dto = await firstValueFrom(
        this.http.post<SubmitResponseDto>(
          apiPath.studentExamSubmit(this.requireSlug(), req.examId),
          {
            code: req.code,
            admission_area: req.admissionArea,
            responses: req.responses,
            client_finished_at: req.clientFinishedAt,
          },
        ),
      );
      // El VO valida shape: hash 64 hex, submittedAt Date válido.
      const ack = new SubmissionAck(dto.id, dto.submission_hash, new Date(dto.submitted_at));
      return { ack };
    } catch (err) {
      throw this.classifySubmitError(err);
    }
  }

  // POST /t/{slug}/student/exam-sessions/{sessionId}/submit-homework
  // Mismo body/response shape que /submit — la única diferencia es la ruta y
  // los guards del server (openUntil !== null AND now < openUntil).
  // El backend NO enqueua a BullMQ acá: INSERT sincrono directo, receipt al vuelo.
  async enviarHomework(req: EnvioRequest): Promise<EnvioResult> {
    try {
      const dto = await firstValueFrom(
        this.http.post<SubmitResponseDto>(
          apiPath.studentExamSubmitHomework(this.requireSlug(), req.examId),
          {
            code: req.code,
            admission_area: req.admissionArea,
            responses: req.responses,
            client_finished_at: req.clientFinishedAt,
          },
        ),
      );
      const ack = new SubmissionAck(dto.id, dto.submission_hash, new Date(dto.submitted_at));
      return { ack };
    } catch (err) {
      throw this.classifySubmitError(err);
    }
  }

  // POST /t/{slug}/student/exam-sessions/{sessionId}/draft
  // Envía un snapshot completo del set de respuestas al server (Redis buffer).
  // El draft NO reemplaza al submit: es piso de recuperación para force-close.
  // Body: { code, admission_area, responses } — SIN client_finished_at
  // (exclusivo de /submit). Orden fijo (design.md D8).
  // `withCredentials` lo agrega el `credentials.interceptor` global — NO se
  // setea acá. Response: 204 No Content (void). Timeout: 10s.
  async guardarDraft(req: DraftRequest): Promise<void> {
    try {
      await firstValueFrom(
        this.http
          .post<void>(apiPath.studentExamDraft(this.requireSlug(), req.examId), {
            code: req.code,
            admission_area: req.admissionArea,
            responses: req.responses,
          })
          .pipe(timeout(10_000)),
      );
    } catch (err) {
      throw this.classifyDraftError(err);
    }
  }

  // GET /t/{slug}/student/exam-sessions/{sessionId}/my-submission
  // 200 → MySubmission; 404 → null; otros → NetworkError.
  async getMySubmission(sessionId: string): Promise<MySubmission | null> {
    try {
      const dto = await firstValueFrom(
        this.http
          .get<MySubmissionResponseDto>(apiPath.studentMySubmission(this.requireSlug(), sessionId))
          .pipe(timeout(10_000)),
      );
      return this.toMySubmission(dto);
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 404) return null;
      throw new NetworkError();
    }
  }

  private toMySubmission(dto: MySubmissionResponseDto): MySubmission {
    // El VO valida shape hash 64 hex + submittedAt Date válido.
    const ack = new SubmissionAck(dto.id, dto.submission_hash, new Date(dto.submitted_at));
    const responses: AnswersMap = {};
    for (const [pKey, letra] of Object.entries(dto.responses)) {
      // Keys `P1`, `P2`, ... → `1`, `2`, ...
      const pregunta = pKey.replace(/^P/, '');
      responses[pregunta] = letra as AlternativaValue;
    }
    return {
      ack,
      clientFinishedAt: new Date(dto.client_finished_at),
      responses,
      admissionArea: isAdmissionArea(dto.admission_area) ? dto.admission_area : null,
      source: dto.source,
    };
  }

  private toExam(dto: ExamDto): Exam {
    const scheduled = new Date(dto.scheduled);
    if (Number.isNaN(scheduled.getTime())) {
      throw new InvalidExamError(`Exam scheduled no es ISO8601 válido: "${dto.scheduled}".`);
    }
    const started = dto.started !== null ? new Date(dto.started) : null;
    if (started !== null && Number.isNaN(started.getTime())) {
      throw new InvalidExamError(`Exam started no es ISO8601 válido: "${dto.started}".`);
    }
    const finished = dto.finished !== null ? new Date(dto.finished) : null;
    if (finished !== null && Number.isNaN(finished.getTime())) {
      throw new InvalidExamError(`Exam finished no es ISO8601 válido: "${dto.finished}".`);
    }
    const openUntil = dto.open_until !== null ? new Date(dto.open_until) : null;
    if (openUntil !== null && Number.isNaN(openUntil.getTime())) {
      throw new InvalidExamError(`Exam open_until no es ISO8601 válido: "${dto.open_until}".`);
    }
    // `admission_areas` puede venir ausente en respuestas legacy pre-rollout
    // learnex PR #816. La entity acepta `null` en ese caso (comportamiento
    // idéntico a FICHAS: picker renderiza los 16 conocidos por default).
    // Array de cualquier string se pasa tal cual — la entity normaliza `[]`
    // y strings vacíos a `null`.
    const allowedAdmissionAreas = Array.isArray(dto.admission_areas) ? dto.admission_areas : null;
    return new Exam({
      id: dto.id,
      area: dto.area,
      course: dto.course,
      type: dto.type,
      name: dto.name,
      count: dto.count,
      duration: dto.duration,
      serverStatus: new ExamServerStatus(dto.status),
      scheduled,
      started,
      finished,
      openUntil,
      allowedAdmissionAreas,
    });
  }

  // Clasificación por (status, endpoint, body.code) — NUNCA por message.
  // 401 lo absorbe el credentials.interceptor (refresh + redirect login).
  private classifyListError(err: unknown): Error {
    if (err instanceof InvalidExamError) return err;
    if (err instanceof HttpErrorResponse) {
      if (err.status === 403) return new ExamsPermissionRevokedError();
      if (err.status === 404) {
        const body = (err.error ?? {}) as { code?: string };
        if (body.code === 'STUDENT_NOT_LINKED') return new StudentNotLinkedError();
        return new NetworkError();
      }
      if (err.status === 0 || err.status === 429 || err.status >= 500) {
        return new NetworkError();
      }
    }
    return new NetworkError();
  }

  // Clasificación del POST /student/exam-sessions/{id}/draft.
  //
  // EXCEPCIÓN documentada a la regla "nunca leer message" (design.md D5/D10
  // de `draft-auto-save` + D8 de `add-admission-area`): misma justificación
  // que classifySubmitError — los valores del enum son códigos de control,
  // no i18n humano. Comparación por igualdad ESTRICTA (===) contra el set
  // `DRAFT_ERROR_MESSAGES`. Nunca se usa .includes(), .match() ni regex
  // sobre message.
  // Set: 'INVALID_ADMISSION_AREA' | 'STUDENT_NOT_ENROLLED' | 'STUDENT_MISMATCH'
  //      | 'SESSION_NOT_FOUND' | 'STUDENT_BY_CODE_NOT_FOUND' | 'SESSION_NOT_ACTIVE'
  //
  // 401 lo absorbe el credentials.interceptor (refresh + redirect login).
  private classifyDraftError(err: unknown): Error {
    if (err instanceof HttpErrorResponse) {
      // D5: Clasificación por body.code ANTES de la clasificación por body.message.
      // `exam_not_open_yet` es el único code documentado para draft (REQ-PA-03-DRAFT).
      const body = (err.error ?? {}) as { message?: string; code?: string; startedAt?: string };
      if (err.status === 422 && body.code === 'exam_not_open_yet') {
        const d = new Date(body.startedAt as string);
        return new ExamNotOpenYetError({ startedAt: Number.isNaN(d.getTime()) ? null : d });
      }
      const message = body.message;
      const knownMessage =
        typeof message === 'string' && DRAFT_ERROR_MESSAGES.has(message as DraftErrorMessage)
          ? (message as DraftErrorMessage)
          : null;

      if (err.status === 400) {
        if (knownMessage === 'INVALID_ADMISSION_AREA') return new InvalidAdmissionAreaError();
        return new InvalidPayloadError();
      }
      if (err.status === 403) {
        if (knownMessage === 'STUDENT_NOT_ENROLLED') return new StudentNotEnrolledError();
        // STUDENT_MISMATCH y otros 403 → NetworkError retryable con backoff (D5).
        return new NetworkError();
      }
      if (err.status === 404) {
        if (knownMessage === 'SESSION_NOT_FOUND') return new SimulacroNoAsignadoError();
        if (knownMessage === 'STUDENT_BY_CODE_NOT_FOUND') return new StudentNotLinkedError();
        // 404 sin message conocido → NetworkError retryable; autoheal si el
        // back deploya mid-sesión (design.md D6).
        return new NetworkError();
      }
      if (err.status === 409) {
        if (knownMessage === 'SESSION_NOT_ACTIVE') return new SimulacroCerradoError();
        return new NetworkError();
      }
      if (err.status === 0 || err.status === 429 || err.status >= 500) {
        return new NetworkError();
      }
    }
    // TimeoutError de rxjs/operators o cualquier otro error de transporte.
    return new NetworkError();
  }

  // Clasificación del POST /student/exam-sessions/{id}/submit.
  //
  // EXCEPCIÓN documentada a la regla "nunca leer message" (design.md D5
  // de `fase-3-exam-submit-learnex` + D8 de `add-admission-area`): el back
  // emite `body.message` con strings en mayúsculas snake_case como CONTRATO
  // de control, no como i18n humano. Comparación por igualdad ESTRICTA
  // contra el enum `SUBMIT_ERROR_MESSAGES`. Cualquier valor fuera del enum
  // → NetworkError.
  // Set: 'INVALID_ADMISSION_AREA' | 'STUDENT_NOT_ENROLLED' | 'STUDENT_MISMATCH'
  //      | 'SESSION_NOT_ACTIVE' | 'CLOCK_SKEW_BEFORE_START' | 'CLOCK_SKEW_TOO_FAR_FUTURE'
  //
  // 401 lo absorbe el credentials.interceptor.
  private classifySubmitError(err: unknown): Error {
    if (err instanceof HttpErrorResponse) {
      // D5: Clasificación por body.code ANTES de la clasificación por body.message.
      // `exam_not_open_yet` es el único code documentado para submit (REQ-PA-03-SUBMIT).
      const body = (err.error ?? {}) as { message?: string; code?: string; startedAt?: string };
      if (err.status === 422 && body.code === 'exam_not_open_yet') {
        const d = new Date(body.startedAt as string);
        return new ExamNotOpenYetError({ startedAt: Number.isNaN(d.getTime()) ? null : d });
      }
      const message = body.message;
      const knownMessage =
        typeof message === 'string' && SUBMIT_ERROR_MESSAGES.has(message as SubmitErrorMessage)
          ? (message as SubmitErrorMessage)
          : null;

      if (err.status === 400) {
        if (knownMessage === 'INVALID_ADMISSION_AREA') return new InvalidAdmissionAreaError();
        return new InvalidPayloadError();
      }
      if (err.status === 403) {
        if (knownMessage === 'STUDENT_NOT_ENROLLED') return new StudentNotEnrolledError();
        // STUDENT_MISMATCH y otros 403 → genérico (D6: el back pide
        // "error genérico, no revelar al alumno").
        return new NetworkError();
      }
      if (err.status === 404) return new SimulacroNoAsignadoError();
      if (err.status === 409) {
        if (knownMessage === 'SESSION_NOT_ACTIVE') return new SimulacroCerradoError();
        // Homework: ambos códigos comparten UX "sesión cerrada" con el submit
        // clásico. NOT_HOMEWORK_MODE indica misuse del endpoint (el alumno no
        // debería llegar acá si el enrutamiento por modo funciona);
        // HOMEWORK_WINDOW_CLOSED es lo esperable si el alumno perdió el
        // deadline global.
        if (knownMessage === 'NOT_HOMEWORK_MODE') return new SimulacroCerradoError();
        if (knownMessage === 'HOMEWORK_WINDOW_CLOSED') return new SimulacroCerradoError();
        return new NetworkError();
      }
      if (err.status === 422) {
        if (
          knownMessage === 'CLOCK_SKEW_BEFORE_START' ||
          knownMessage === 'CLOCK_SKEW_TOO_FAR_FUTURE'
        ) {
          return new InvalidSubmissionTimeError();
        }
        return new NetworkError();
      }
      if (err.status === 0 || err.status === 429 || err.status >= 500) {
        return new NetworkError();
      }
    }
    return new NetworkError();
  }
}
