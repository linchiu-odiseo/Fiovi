import { ExamServerStatus } from '../value-objects/exam-server-status';

// Entidad TutorExam — read-model de la lista de virtual exams del tutor.
// Mapeado desde TutorVirtualExamListItemDto en L3.
//
// `classroomId` viaja en el DTO porque el detalle (endpoint aparte) no lo
// devuelve — el store lo cachea para que TutorExamDetailViewModel lo resuelva
// sin request extra (D1).
//
// `course` y `area` son SNAPSHOTS que el back guarda como texto plano en
// virtual_exam_detail al momento de crear el examen. No hay resolución de
// UUID en cliente; permiten agrupar/filtrar por curso o área directamente.
//
// `scheduled` es cuándo se programó el examen (created_at del traceability
// record) — misma semántica que el `scheduled` que ve el alumno.
//
// Los helpers de estado usan ExamServerStatus.is() que ya valida el enum.
// NO recomputa el estado: siempre lo recibe del backend.
export class TutorExam {
  public readonly detailId: string;
  public readonly recordId: string;
  public readonly classroomId: string;
  public readonly serverStatus: ExamServerStatus;
  public readonly name: string;
  public readonly course: string | null;
  public readonly area: string | null;
  public readonly count: number | null;
  /** Duración vigente del examen en segundos. */
  public readonly duration: number;
  public readonly scheduled: Date;
  public readonly startedAt: Date | null;
  public readonly finishedAt: Date | null;

  constructor(params: {
    detailId: string;
    recordId: string;
    classroomId: string;
    serverStatus: ExamServerStatus;
    name: string;
    course: string | null;
    area: string | null;
    count: number | null;
    duration: number;
    scheduled: Date;
    startedAt: Date | null;
    finishedAt: Date | null;
  }) {
    this.detailId = params.detailId;
    this.recordId = params.recordId;
    this.classroomId = params.classroomId;
    this.serverStatus = params.serverStatus;
    this.name = params.name;
    this.course = params.course;
    this.area = params.area;
    this.count = params.count;
    this.duration = params.duration;
    this.scheduled = params.scheduled;
    this.startedAt = params.startedAt;
    this.finishedAt = params.finishedAt;
  }

  /**
   * Duración expresada en minutos (redondeo estándar), para presentar en UI.
   * El campo de dominio queda siempre en segundos por consistencia con el back.
   */
  get durationInMinutes(): number {
    return Math.round(this.duration / 60);
  }

  // El tutor puede iniciar el examen solo si está en estado 'scheduled'.
  puedeIniciar(): boolean {
    return this.serverStatus.is('scheduled');
  }

  // El tutor puede finalizar el examen solo si está en progreso.
  puedeFinalizar(): boolean {
    return this.serverStatus.is('in_progress');
  }

  // El examen ya fue finalizado (read-only para el tutor — D5).
  estaFinalizado(): boolean {
    return this.serverStatus.is('finalized') || this.serverStatus.esTerminal();
  }
}
