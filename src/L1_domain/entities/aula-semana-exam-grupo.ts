import { TutorExam } from './tutor-exam';

// Value object AulaSemanaExamGrupo — grupo de exámenes de un curso dentro de
// una semana concreta. Mapeado desde el response de
// GET /t/{slug}/tutor/aulas/{classroomId}/semanas/{periodId}/examenes,
// specifically de la key `courses[]`.
//
// Reusa `TutorExam` para los items — el shape es idéntico al que devuelve
// /tutor/virtual-exams (mismo TutorVirtualExamListItemSchema del backend).
// Evita duplicar la entidad y mantiene una sola verdad para "una fila de
// examen que ve el tutor".
//
// `courseId` puede ser null cuando el examen viene de un ExamScheduleEntry
// con category='general' (courseId nullable en el schema). En ese caso el
// UI muestra el grupo como "General".
export class AulaSemanaExamGrupo {
  public readonly courseId: string | null;
  public readonly course: string | null;
  public readonly area: string | null;
  public readonly examenes: readonly TutorExam[];

  constructor(params: {
    courseId: string | null;
    course: string | null;
    area: string | null;
    examenes: readonly TutorExam[];
  }) {
    this.courseId = params.courseId;
    this.course = params.course;
    this.area = params.area;
    this.examenes = params.examenes;
  }

  /** Título mostrado en la card del grupo — "General" cuando no hay curso. */
  get displayName(): string {
    return this.course ?? 'General';
  }

  /** Total de exámenes en el grupo — atajo para el header de la card. */
  get total(): number {
    return this.examenes.length;
  }
}
