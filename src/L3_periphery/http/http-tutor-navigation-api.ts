import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { timeout } from 'rxjs/operators';
import {
  TutorNavigationApi,
  type AulaSemanaExamenesResult,
  type AulaSemanasResult,
  type ExamsEnCursoResult,
} from '../../L1_domain/ports/tutor-navigation-api';
import { AulaSemana } from '../../L1_domain/entities/aula-semana';
import { AulaSemanaExamGrupo } from '../../L1_domain/entities/aula-semana-exam-grupo';
import { ExamEnCurso } from '../../L1_domain/entities/exam-en-curso';
import { TutorExam } from '../../L1_domain/entities/tutor-exam';
import { ExamServerStatus } from '../../L1_domain/value-objects/exam-server-status';
import { ServerTime } from '../../L1_domain/value-objects/server-time';
import { NetworkError } from '../../L1_domain/errors/network.error';
import { TutorExamForbiddenError } from '../../L1_domain/errors/tutor-exam-forbidden.error';
import { VirtualExamNotFoundError } from '../../L1_domain/errors/virtual-exam-not-found.error';
import { apiPath } from './api-paths';
import { SlugStore } from './slug-store';

// DTO shapes — camelCase (mismo criterio que HttpTutorExamsApi: el back tutor
// habla camelCase, distinto del flujo del alumno que usa snake_case).

interface StatusCountsDto {
  scheduled: number;
  in_progress: number;
  finalized: number;
}

interface AulaSemanaItemDto {
  periodId: string;
  name: string;
  order: number;
  startDate: string;
  endDate: string;
  examCount: number;
  byStatus: StatusCountsDto;
}

interface AulaSemanasResponseDto {
  serverTime: string;
  cycle: { id: string; name: string };
  classroom: { id: string; code: string; name: string };
  items: AulaSemanaItemDto[];
}

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
}

interface AulaSemanaCourseGroupDto {
  courseId: string | null;
  course: string | null;
  area: string | null;
  examenes: TutorVirtualExamListItemDto[];
}

interface AulaSemanaExamenesResponseDto {
  serverTime: string;
  week: { periodId: string; name: string; startDate: string; endDate: string };
  classroom: { id: string; code: string; name: string };
  courses: AulaSemanaCourseGroupDto[];
}

interface TutorEnCursoItemDto {
  id: string;
  recordId: string;
  classroomId: string;
  classroomName: string;
  classroomCode: string;
  name: string;
  course: string | null;
  area: string | null;
  count: number | null;
  duration: number;
  startedAt: string;
}

interface TutorExamsEnCursoResponseDto {
  serverTime: string;
  items: TutorEnCursoItemDto[];
}

@Injectable({ providedIn: 'root' })
export class HttpTutorNavigationApi implements TutorNavigationApi {
  private readonly http = inject(HttpClient);
  private readonly slugStore = inject(SlugStore);

  // Mismo contrato que HttpTutorExamsApi.requireSlug — sin slug, NetworkError.
  private requireSlug(): string {
    const slug = this.slugStore.current();
    if (!slug) throw new NetworkError();
    return slug;
  }

  async getAulaSemanas(classroomId: string): Promise<AulaSemanasResult> {
    try {
      const dto = await firstValueFrom(
        this.http
          .get<AulaSemanasResponseDto>(apiPath.tutorAulaSemanas(this.requireSlug(), classroomId))
          .pipe(timeout(10_000)),
      );
      return {
        serverTime: new ServerTime(dto.serverTime),
        cycle: dto.cycle,
        classroom: dto.classroom,
        semanas: dto.items.map((item) => this.toAulaSemana(item)),
      };
    } catch (err) {
      throw this.classifyTutorError(err);
    }
  }

  async getAulaSemanaExamenes(
    classroomId: string,
    periodId: string,
  ): Promise<AulaSemanaExamenesResult> {
    try {
      const dto = await firstValueFrom(
        this.http
          .get<AulaSemanaExamenesResponseDto>(
            apiPath.tutorAulaSemanaExamenes(this.requireSlug(), classroomId, periodId),
          )
          .pipe(timeout(10_000)),
      );
      return {
        serverTime: new ServerTime(dto.serverTime),
        week: dto.week,
        classroom: dto.classroom,
        cursos: dto.courses.map((group) => this.toGrupo(group)),
      };
    } catch (err) {
      throw this.classifyTutorError(err);
    }
  }

  async getExamsEnCurso(): Promise<ExamsEnCursoResult> {
    try {
      const dto = await firstValueFrom(
        this.http
          .get<TutorExamsEnCursoResponseDto>(apiPath.tutorExamsEnCurso(this.requireSlug()))
          .pipe(timeout(10_000)),
      );
      return {
        serverTime: new ServerTime(dto.serverTime),
        items: dto.items.map((item) => this.toExamEnCurso(item)),
      };
    } catch (err) {
      throw this.classifyTutorError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // Clasificación de errores por HTTP status (mismo criterio D2 que HttpTutorExamsApi).
  // 401 lo absorbe credentials.interceptor (refresh + redirect) — no llega acá.
  // Los 3 endpoints solo devuelven 200 | 401 | 403 | 404 | 5xx — mapeo mínimo.
  // ---------------------------------------------------------------------------
  private classifyTutorError(err: unknown): Error {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 403) return new TutorExamForbiddenError();
      if (err.status === 404) return new VirtualExamNotFoundError();
      if (err.status === 0 || err.status === 429 || err.status >= 500) {
        return new NetworkError();
      }
    }
    // TimeoutError o cualquier otro error de transporte.
    return new NetworkError();
  }

  // ---------------------------------------------------------------------------
  // Mapeo DTO → dominio
  // ---------------------------------------------------------------------------

  private toAulaSemana(dto: AulaSemanaItemDto): AulaSemana {
    return new AulaSemana({
      periodId: dto.periodId,
      name: dto.name,
      order: dto.order,
      startDate: dto.startDate,
      endDate: dto.endDate,
      examCount: dto.examCount,
      byStatus: {
        scheduled: dto.byStatus.scheduled,
        in_progress: dto.byStatus.in_progress,
        finalized: dto.byStatus.finalized,
      },
    });
  }

  private toGrupo(dto: AulaSemanaCourseGroupDto): AulaSemanaExamGrupo {
    return new AulaSemanaExamGrupo({
      courseId: dto.courseId,
      course: dto.course,
      area: dto.area,
      examenes: dto.examenes.map((e) => this.toTutorExam(e)),
    });
  }

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
    });
  }

  private toExamEnCurso(dto: TutorEnCursoItemDto): ExamEnCurso {
    return new ExamEnCurso({
      id: dto.id,
      recordId: dto.recordId,
      classroomId: dto.classroomId,
      classroomCode: dto.classroomCode,
      classroomName: dto.classroomName,
      name: dto.name,
      course: dto.course,
      area: dto.area,
      count: dto.count,
      duration: dto.duration,
      startedAt: new Date(dto.startedAt),
    });
  }

  private parseNullableDate(value: string | null): Date | null {
    if (value === null) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
}
