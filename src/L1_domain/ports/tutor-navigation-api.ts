import { AulaSemana } from '../entities/aula-semana';
import { AulaSemanaExamGrupo } from '../entities/aula-semana-exam-grupo';
import { ExamEnCurso } from '../entities/exam-en-curso';
import { ServerTime } from '../value-objects/server-time';

// Puerto del dominio para la navegación del tutor en Fiovi:
//   AULA → SEMANA → CURSO → EXÁMENES  + shortcut "en curso".
//
// Implementación concreta: HttpTutorNavigationApi en L3.
// NO importa nada de Angular — sin HttpClient, sin Injectable, sin decoradores.
//
// Mapeo de errores HTTP (clasificación en classifyTutorError — mismo criterio
// que TutorExamsApi):
//   401                     → manejado por credentials.interceptor (refresh + redirect)
//   403                     → TutorExamForbiddenError
//   404                     → VirtualExamNotFoundError (aula o período inexistente)
//   0 / 429 / 5xx / timeout → NetworkError
//
// `serverTime` de cada response viaja en el result y el adapter lo empuja al
// Clock port en el momento del parseo — la lógica de navegación consume el
// result "puro" sin preocuparse por el sync de reloj.

/** Resultado de GET /t/:slug/tutor/aulas/:classroomId/semanas */
export interface AulaSemanasResult {
  readonly cycle: { readonly id: string; readonly name: string };
  readonly classroom: { readonly id: string; readonly code: string; readonly name: string };
  readonly semanas: readonly AulaSemana[];
  /**
   * Ancla de reloj del servidor. El use-case caller la empuja al Clock port
   * (patrón GetTodaysExamsUseCase) — el adapter L3 no toca el reloj.
   */
  readonly serverTime: ServerTime;
}

/** Resultado de GET /t/:slug/tutor/aulas/:classroomId/semanas/:periodId/examenes */
export interface AulaSemanaExamenesResult {
  readonly week: {
    readonly periodId: string;
    readonly name: string;
    /** YYYY-MM-DD, sin timezone. */
    readonly startDate: string;
    readonly endDate: string;
  };
  readonly classroom: { readonly id: string; readonly code: string; readonly name: string };
  readonly cursos: readonly AulaSemanaExamGrupo[];
  readonly serverTime: ServerTime;
}

/** Resultado de GET /t/:slug/tutor/exams/en-curso */
export interface ExamsEnCursoResult {
  readonly items: readonly ExamEnCurso[];
  readonly serverTime: ServerTime;
}

export interface TutorNavigationApi {
  /**
   * Lista las semanas del ciclo del aula con contadores agregados por status.
   * Semanas vacías vienen igual (examCount=0) — Fiovi las muestra para
   * permitir navegación hacia adelante antes de que se creen los exámenes.
   * Errores: VirtualExamNotFoundError (404 — aula inexistente),
   *          TutorExamForbiddenError (403 — tutor no asignado), NetworkError.
   */
  getAulaSemanas(classroomId: string): Promise<AulaSemanasResult>;

  /**
   * Lista los exámenes de una (aula × semana) agrupados por curso.
   * `cursos` vacío = semana sin exámenes creados (estado válido, UI muestra
   * empty state). El grupo con `courseId=null` (bucket "General") aparece
   * al final por ORDER BY nulls-last del backend.
   * Errores: VirtualExamNotFoundError (404 — aula/período inválidos o cross-cycle),
   *          TutorExamForbiddenError (403), NetworkError.
   */
  getAulaSemanaExamenes(classroomId: string, periodId: string): Promise<AulaSemanaExamenesResult>;

  /**
   * Lista cross-aula de exámenes actualmente `in_progress` del tutor logueado.
   * Payload acotado server-side (~0-10 items típicos). Alimenta el shortcut
   * del home + los badges "N en curso" por card de aula (agrupamiento
   * client-side por classroomId).
   * Errores: NetworkError. Admin sin aulas asignadas → items: [] (no error).
   */
  getExamsEnCurso(): Promise<ExamsEnCursoResult>;
}
