// Entidad ExamEnCurso — read-model del listado ligero de exámenes actualmente
// in_progress a través de TODAS las aulas del tutor. Mapeado desde
// GET /t/{slug}/tutor/exams/en-curso.
//
// Distinta de TutorExam: (a) trae classroomCode + classroomName pre-resueltos
// (para el badge/lista sin joins client-side), (b) `startedAt` es non-null
// por invariante (el backend garantiza que in_progress ⇒ started_at != null).
//
// El cálculo de tiempo restante recibe el reloj compensado por parámetro —
// la entidad NUNCA consulta Date.now() ni el Clock port directamente. Eso
// mantiene la entidad L1 pura y hace explícito qué reloj se usa (siempre
// server-anchored via el ClockPort del caller).
export class ExamEnCurso {
  public readonly id: string;
  public readonly recordId: string;
  public readonly classroomId: string;
  public readonly classroomCode: string;
  public readonly classroomName: string;
  public readonly name: string;
  public readonly course: string | null;
  public readonly area: string | null;
  public readonly count: number | null;
  /** Duración configurada, en segundos. */
  public readonly duration: number;
  public readonly startedAt: Date;

  constructor(params: {
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
    startedAt: Date;
  }) {
    this.id = params.id;
    this.recordId = params.recordId;
    this.classroomId = params.classroomId;
    this.classroomCode = params.classroomCode;
    this.classroomName = params.classroomName;
    this.name = params.name;
    this.course = params.course;
    this.area = params.area;
    this.count = params.count;
    this.duration = params.duration;
    this.startedAt = params.startedAt;
  }

  /**
   * Momento en el que el examen "debería" terminar según su duración
   * configurada. El backend no auto-transiciona a `finalized` cuando se
   * cumple — sigue mostrando `in_progress` hasta que alguien lo finalice
   * manualmente. Esto se usa en UI para pintar "finalizando…" cuando
   * `nowServer >= expectedEndAt`.
   */
  get expectedEndAt(): Date {
    return new Date(this.startedAt.getTime() + this.duration * 1000);
  }

  /**
   * Segundos restantes hasta `expectedEndAt` según el reloj server-anchored
   * recibido por parámetro. Nunca negativo: 0 significa "tiempo cumplido"
   * y el UI cambia el chip a "finalizando…".
   */
  remainingSeconds(nowServer: Date): number {
    const diffMs = this.expectedEndAt.getTime() - nowServer.getTime();
    return Math.max(0, Math.floor(diffMs / 1000));
  }

  /** True cuando `nowServer < expectedEndAt`. Falso al cumplirse el tiempo. */
  estaEnTiempo(nowServer: Date): boolean {
    return nowServer < this.expectedEndAt;
  }
}
