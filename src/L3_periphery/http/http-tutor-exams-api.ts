import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { timeout } from 'rxjs/operators';
import { FinalizeResult, TutorExamsApi } from '../../L1_domain/ports/tutor-exams-api';
import { TutorExam } from '../../L1_domain/entities/tutor-exam';
import { TutorExamDetail } from '../../L1_domain/value-objects/tutor-exam-detail';
import { ClassroomStudent } from '../../L1_domain/value-objects/classroom-student';
import { ExamServerStatus } from '../../L1_domain/value-objects/exam-server-status';
import { NetworkError } from '../../L1_domain/errors/network.error';
import { InvalidPayloadError } from '../../L1_domain/errors/invalid-payload.error';
import { VirtualExamNotFoundError } from '../../L1_domain/errors/virtual-exam-not-found.error';
import { ExamConflictError } from '../../L1_domain/errors/exam-conflict.error';
import { ExamPreconditionError } from '../../L1_domain/errors/exam-precondition.error';
import { TutorExamForbiddenError } from '../../L1_domain/errors/tutor-exam-forbidden.error';
import { apiPath } from './api-paths';
import { SlugStore } from './slug-store';

// DTO shapes — camelCase desde learnex (a diferencia del flujo del alumno que usa snake_case).

interface TutorVirtualExamListItemDto {
  id: string;
  recordId: string;
  classroomId: string;
  status: string;
  name: string;
  course: string | null;
  area: string | null;
  count: number | null;
  duration: number;
  scheduled: string;
  startedAt: string | null;
  finishedAt: string | null;
  // ISO datetime en modo "tarea"; null en modo "examen".
  // Wire: `openUntil` en camelCase (learnex tutor endpoints).
  openUntil: string | null;
}

interface TutorVirtualExamListResponseDto {
  items: TutorVirtualExamListItemDto[];
}

// DTO del endpoint dedicado /tutor/exams/finalizadas. Difiere del anterior:
// incluye classroomCode/classroomName (para mostrar el aula sin ir al profile)
// y garantiza finishedAt non-null porque el filtro es status='finalized'.
interface TutorFinalizadaItemDto {
  id: string;
  recordId: string;
  classroomId: string;
  classroomCode: string;
  classroomName: string;
  name: string;
  course: string | null;
  area: string | null;
  count: number | null;
  duration: number;
  startedAt: string;
  finishedAt: string;
  openUntil: string | null;
}

interface TutorFinalizadasResponseDto {
  serverTime: string;
  items: TutorFinalizadaItemDto[];
}

interface VirtualExamDetailDto {
  id: string;
  recordId: string;
  status: string;
  name: string;
  course: string | null;
  area: string | null;
  count: number | null;
  duration: number;
  enabledStudentIds: string[];
  startedAt: string | null;
  finishedAt: string | null;
  // ISO datetime en modo "tarea"; null en modo "examen".
  openUntil: string | null;
  createdAt: string;
}

interface ClassroomStudentDto {
  studentId: string;
  studentCode: string;
  firstName: string;
  lastName: string;
  enabled: boolean;
  hasSubmitted: boolean;
}

interface ClassroomStudentsResponseDto {
  students: ClassroomStudentDto[];
}

interface FinalizeResponseDto {
  transitioned: boolean;
  jobId?: string;
}

@Injectable({ providedIn: 'root' })
export class HttpTutorExamsApi implements TutorExamsApi {
  private readonly http = inject(HttpClient);
  private readonly slugStore = inject(SlugStore);

  // Ver `HttpExamsApi.requireSlug` — mismo contrato: si el slug no está
  // hidratado, NetworkError sin loop de refresh.
  private requireSlug(): string {
    const slug = this.slugStore.current();
    if (!slug) throw new NetworkError();
    return slug;
  }

  // GET /t/:slug/tutor/virtual-exams — lista de virtual exams del tutor.
  // `withCredentials` lo agrega el credentials.interceptor global — NO se setea acá.
  // Timeout: 10s.
  async getTutorExams(): Promise<readonly TutorExam[]> {
    try {
      const dto = await firstValueFrom(
        this.http
          .get<TutorVirtualExamListResponseDto>(apiPath.tutorVirtualExams(this.requireSlug()))
          .pipe(timeout(10_000)),
      );
      return dto.items.map((item) => this.toTutorExam(item));
    } catch (err) {
      throw this.classifyTutorError(err);
    }
  }

  // GET /t/:slug/tutor/exams/finalizadas — endpoint dedicado (payload liviano).
  async getExamsFinalizadas(): Promise<readonly TutorExam[]> {
    try {
      const dto = await firstValueFrom(
        this.http
          .get<TutorFinalizadasResponseDto>(apiPath.tutorExamsFinalizadas(this.requireSlug()))
          .pipe(timeout(10_000)),
      );
      return dto.items.map((item) => this.toTutorExamFromFinalizada(item));
    } catch (err) {
      throw this.classifyTutorError(err);
    }
  }

  // GET /t/:slug/virtual-exams/:recordId — detalle con enabledStudentIds.
  async getExamDetail(recordId: string): Promise<TutorExamDetail> {
    try {
      const dto = await firstValueFrom(
        this.http
          .get<VirtualExamDetailDto>(apiPath.virtualExam(this.requireSlug(), recordId))
          .pipe(timeout(10_000)),
      );
      return this.toTutorExamDetail(dto);
    } catch (err) {
      throw this.classifyTutorError(err);
    }
  }

  // GET /t/:slug/classrooms/:classroomId/students?virtualExamDetailId=
  async listClassroomStudents(req: {
    classroomId: string;
    virtualExamDetailId: string;
  }): Promise<readonly ClassroomStudent[]> {
    try {
      const dto = await firstValueFrom(
        this.http
          .get<ClassroomStudentsResponseDto>(
            apiPath.classroomStudents(this.requireSlug(), req.classroomId, req.virtualExamDetailId),
          )
          .pipe(timeout(10_000)),
      );
      return dto.students.map((s) => this.toClassroomStudent(s));
    } catch (err) {
      throw this.classifyTutorError(err);
    }
  }

  // PATCH /t/:slug/virtual-exams/:recordId/enabled-students
  async updateEnabledStudents(req: {
    recordId: string;
    enabledStudentIds: readonly string[];
  }): Promise<void> {
    try {
      await firstValueFrom(
        this.http
          .patch<void>(apiPath.virtualExamEnabledStudents(this.requireSlug(), req.recordId), {
            enabledStudentIds: req.enabledStudentIds,
          })
          .pipe(timeout(10_000)),
      );
    } catch (err) {
      throw this.classifyTutorError(err);
    }
  }

  // POST /t/:slug/virtual-exams/:recordId/start
  // Body opcional `{ duration?, openUntil? }`. Cuando `openUntil` viene, el
  // examen arranca en modo "tarea" (ver TutorExamsApi.iniciar). Respuesta: 204.
  async iniciar(recordId: string, opts?: { duration?: number; openUntil?: Date }): Promise<void> {
    // Construimos el body dropeando keys undefined para no enviar `null`
    // implícito ni `{ duration: undefined }` — el server-side zod distingue
    // presencia con `.optional()`.
    const payload: { duration?: number; openUntil?: string } = {};
    if (opts?.duration !== undefined) payload.duration = opts.duration;
    if (opts?.openUntil !== undefined) payload.openUntil = opts.openUntil.toISOString();
    const body = Object.keys(payload).length > 0 ? payload : null;
    try {
      await firstValueFrom(
        this.http
          .post<void>(apiPath.virtualExamStart(this.requireSlug(), recordId), body)
          .pipe(timeout(10_000)),
      );
    } catch (err) {
      throw this.classifyTutorError(err);
    }
  }

  // POST /t/:slug/virtual-exams/:recordId/finalize — sin body.
  // IMPORTANTE: el controller del backend tiene un comentario con 202, pero la
  // implementación devuelve 200 con body { transitioned, jobId? } — ver design.md R2
  // y learnex PR #276. El adapter espera 200 y lee el body para obtener FinalizeResult.
  async finalizar(recordId: string): Promise<FinalizeResult> {
    try {
      const dto = await firstValueFrom(
        this.http
          .post<FinalizeResponseDto>(
            apiPath.virtualExamFinalize(this.requireSlug(), recordId),
            null,
          )
          .pipe(timeout(10_000)),
      );
      return {
        transitioned: dto.transitioned,
        jobId: dto.jobId,
      };
    } catch (err) {
      throw this.classifyTutorError(err);
    }
  }

  // POST /t/:slug/virtual-exams/:recordId/archive — sin body. Respuesta: 204 void.
  async archivar(recordId: string): Promise<void> {
    try {
      await firstValueFrom(
        this.http
          .post<void>(apiPath.virtualExamArchive(this.requireSlug(), recordId), null)
          .pipe(timeout(10_000)),
      );
    } catch (err) {
      throw this.classifyTutorError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // Clasificación de errores por HTTP status (design.md D2).
  //
  // CLASIFICACIÓN POR STATUS PURO: el backend del tutor emite codes genéricos
  // (forbidden, not_found, conflict, unprocessable_entity) y messages en prosa
  // variable (inglés + español + UUIDs embebidos). NO son contrato de control en
  // mayúsculas snake_case como el flujo del alumno. Por eso NO se lee
  // body.message ni body.code para determinar el tipo de error — el status
  // HTTP es suficiente para el routing de error en la VM. Ver design.md D2.
  //
  // 401 lo absorbe credentials.interceptor (refresh + redirect login) — no llega acá.
  // ---------------------------------------------------------------------------
  private classifyTutorError(err: unknown): Error {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 400) return new InvalidPayloadError();
      if (err.status === 403) return new TutorExamForbiddenError();
      if (err.status === 404) return new VirtualExamNotFoundError();
      if (err.status === 409) return new ExamConflictError();
      if (err.status === 422) return new ExamPreconditionError();
      // 0 / 429 / 5xx → NetworkError (sin conexión, rate limit, error del server).
      if (err.status === 0 || err.status === 429 || err.status >= 500) {
        return new NetworkError();
      }
    }
    // TimeoutError de rxjs/operators o cualquier otro error de transporte.
    return new NetworkError();
  }

  // ---------------------------------------------------------------------------
  // Mapeo DTO → dominio
  // ---------------------------------------------------------------------------

  private toTutorExam(dto: TutorVirtualExamListItemDto): TutorExam {
    return new TutorExam({
      detailId: dto.id,
      recordId: dto.recordId,
      classroomId: dto.classroomId,
      serverStatus: new ExamServerStatus(dto.status),
      name: dto.name,
      course: dto.course,
      area: dto.area,
      count: dto.count,
      duration: dto.duration,
      scheduled: new Date(dto.scheduled),
      startedAt: this.parseNullableDate(dto.startedAt),
      finishedAt: this.parseNullableDate(dto.finishedAt),
      openUntil: this.parseNullableDate(dto.openUntil),
    });
  }

  private toTutorExamFromFinalizada(dto: TutorFinalizadaItemDto): TutorExam {
    // El endpoint /finalizadas no devuelve `scheduled` — usamos `startedAt`
    // como fallback (los finalizados siempre lo tienen). Coherente con el uso
    // real: el ordenamiento del historial va por finishedAt, no scheduled.
    return new TutorExam({
      detailId: dto.id,
      recordId: dto.recordId,
      classroomId: dto.classroomId,
      classroomCode: dto.classroomCode,
      classroomName: dto.classroomName,
      serverStatus: new ExamServerStatus('finalized'),
      name: dto.name,
      course: dto.course,
      area: dto.area,
      count: dto.count,
      duration: dto.duration,
      scheduled: new Date(dto.startedAt),
      startedAt: new Date(dto.startedAt),
      finishedAt: new Date(dto.finishedAt),
      openUntil: this.parseNullableDate(dto.openUntil),
    });
  }

  private toTutorExamDetail(dto: VirtualExamDetailDto): TutorExamDetail {
    return {
      id: dto.id,
      recordId: dto.recordId,
      status: new ExamServerStatus(dto.status),
      name: dto.name,
      course: dto.course,
      area: dto.area,
      count: dto.count,
      duration: dto.duration,
      enabledStudentIds: dto.enabledStudentIds,
      startedAt: this.parseNullableDate(dto.startedAt),
      finishedAt: this.parseNullableDate(dto.finishedAt),
      openUntil: this.parseNullableDate(dto.openUntil),
      createdAt: new Date(dto.createdAt),
    };
  }

  private toClassroomStudent(dto: ClassroomStudentDto): ClassroomStudent {
    return {
      studentId: dto.studentId,
      studentCode: dto.studentCode,
      firstName: dto.firstName,
      lastName: dto.lastName,
      enabled: dto.enabled,
      hasSubmitted: dto.hasSubmitted,
    };
  }

  // Convierte string ISO 8601 → Date con guarda de NaN. null → null.
  private parseNullableDate(value: string | null): Date | null {
    if (value === null) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
}
