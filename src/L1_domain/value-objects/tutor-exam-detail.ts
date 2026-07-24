import { ExamServerStatus } from './exam-server-status';

// Detalle de un virtual exam para la pantalla de gestión del tutor.
// El backend (GET /virtual-exams/:recordId) devuelve este shape — NOTA:
// NO incluye `classroomId` (solo la lista lo lleva). El `id` es el
// detailId interno del backend; `recordId` es el id que usan todos los demás
// endpoints (start/finalize/enabled-students). `enabledStudentIds` es la lista
// de studentIds habilitados para rendir.
// `course` / `area` son snapshots plain-text; pueden ser null cuando el examen
// se creó desde un entry sin curso.
export interface TutorExamDetail {
  readonly id: string; // detailId interno
  readonly recordId: string; // id usado por endpoints de gestión
  readonly status: ExamServerStatus;
  readonly name: string;
  readonly course: string | null;
  readonly area: string | null;
  readonly count: number | null;
  readonly duration: number; // segundos
  readonly enabledStudentIds: readonly string[];
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  /**
   * Fecha límite en modo "tarea". null = modo "examen" (heredado). El
   * view-model del tutor lo consume para elegir entre countdown por duración
   * (examen) y "Cierra el DD/MM HH:mm" (tarea).
   */
  readonly openUntil: Date | null;
  readonly createdAt: Date;
}
