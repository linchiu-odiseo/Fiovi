import { ExamServerStatus } from '../value-objects/exam-server-status';
import { InvalidExamError } from '../errors/invalid-exam.error';

// Entidad Exam. El `serverStatus` lo deriva learnex en cada GET y el
// cliente nunca lo recomputa. La entidad acepta `area`, `course`,
// `started` y `finished` como nullable porque learnex los emite null en
// ciertos casos (asignaciones sin curso atado, exámenes que aún no
// empiezan, etc.). El caso patológico (`serverStatus: 'in_progress'` +
// `started: null`) lo filtra el adapter L3 con skip silencioso ANTES de
// invocar este constructor — la entidad no lo valida.
//
// El estado "enviado" desde la perspectiva del alumno NO vive acá: se
// compone en el view-model LR con `serverStatus + getSubmissionAck(examId)`.
export class Exam {
  public readonly id: string;
  public readonly area: string | null;
  public readonly course: string | null;
  public readonly type: string;
  public readonly name: string;
  public readonly count: number;
  public readonly duration: number;
  public readonly serverStatus: ExamServerStatus;
  public readonly scheduled: Date;
  public readonly started: Date | null;
  public readonly finished: Date | null;

  constructor(params: {
    id: string;
    area: string | null;
    course: string | null;
    type: string;
    name: string;
    count: number;
    duration: number;
    serverStatus: ExamServerStatus;
    scheduled: Date;
    started: Date | null;
    finished: Date | null;
  }) {
    const id = (params.id ?? '').trim();
    if (id.length === 0) {
      throw new InvalidExamError('Exam requiere un id no vacío.');
    }
    const type = (params.type ?? '').trim();
    if (type.length === 0) {
      throw new InvalidExamError('Exam requiere un type no vacío.');
    }
    const name = (params.name ?? '').trim();
    if (name.length === 0) {
      throw new InvalidExamError('Exam requiere un name no vacío.');
    }
    if (!Number.isInteger(params.count) || params.count <= 0) {
      throw new InvalidExamError(`Exam count debe ser entero positivo. Recibido: ${params.count}.`);
    }
    if (!Number.isInteger(params.duration) || params.duration < 1) {
      throw new InvalidExamError(
        `Exam duration debe ser entero positivo (segundos). Recibido: ${params.duration}.`,
      );
    }
    if (!(params.scheduled instanceof Date) || Number.isNaN(params.scheduled.getTime())) {
      throw new InvalidExamError('Exam requiere scheduled Date válido.');
    }
    if (
      params.started !== null &&
      (!(params.started instanceof Date) || Number.isNaN(params.started.getTime()))
    ) {
      throw new InvalidExamError('Exam started debe ser Date válido o null.');
    }
    if (
      params.finished !== null &&
      (!(params.finished instanceof Date) || Number.isNaN(params.finished.getTime()))
    ) {
      throw new InvalidExamError('Exam finished debe ser Date válido o null.');
    }
    if (!(params.serverStatus instanceof ExamServerStatus)) {
      throw new InvalidExamError('Exam requiere un ExamServerStatus válido.');
    }

    this.id = id;
    this.area = params.area !== null ? params.area.trim() || null : null;
    this.course = params.course !== null ? params.course.trim() || null : null;
    this.type = type;
    this.name = name;
    this.count = params.count;
    this.duration = params.duration;
    this.serverStatus = params.serverStatus;
    this.scheduled = params.scheduled;
    this.started = params.started;
    this.finished = params.finished;
  }

  // Cierre efectivo de la vigencia. Prioridad:
  //   1. `finished` (cierre real ya emitido por learnex — manual del tutor
  //      o automático al cumplirse duration). Manda siempre que esté seteado:
  //      el back puede cerrarlo antes (manual) o con tiempo extra (después
  //      de started + duration). Sea cual sea el caso, la verdad es `finished`.
  //   2. `started + duration` (cierre automático esperado si nadie cierra
  //      antes). Solo cuando `finished` aún no fue emitido.
  //   3. `null` cuando el examen aún NO fue activado (`started === null` y
  //      `finished === null`). No usamos `scheduled + duration` como fallback
  //      porque `scheduled` puede ser de hace tiempo y eso induciría
  //      countdowns negativos ("cerrando…") en la UI para exámenes que el
  //      tutor todavía no arrancó. Los consumidores tratan `null` como
  //      "no hay cierre todavía": no muestran countdown, no redirigen por
  //      expiración, no programan auto-envío.
  //
  // Factor ×1000 porque `duration` viene de learnex en SEGUNDOS.
  effectiveCloseAt(): Date | null {
    if (this.finished !== null) return this.finished;
    if (this.started !== null) {
      return new Date(this.started.getTime() + this.duration * 1000);
    }
    return null;
  }

  // Si la vigencia ya arrancó para el momento `now`. La puerta de entrada
  // del alumno está controlada por `serverStatus.permiteEntrada()`, pero
  // un examen `in_progress` con `started` aún en el futuro (caso límite:
  // tutor configuró arranque programado, o el reloj cliente está
  // desfasado) NO es vigente todavía. El view-model usa este predicado
  // para mostrar alerta "Examen no iniciado" sin bloquear la entrada.
  // Si `started === null` retorna false: no hay vigencia hasta que el
  // tutor active.
  hasStartedBy(now: Date): boolean {
    if (this.started === null) return false;
    return now.getTime() >= this.started.getTime();
  }
}
