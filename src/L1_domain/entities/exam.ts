import { ExamServerStatus } from '../value-objects/exam-server-status';
import { InvalidExamError } from '../errors/invalid-exam.error';

function normalizeAllowedAreas(raw: readonly string[] | null): readonly string[] | null {
  if (raw === null) return null;
  const cleaned = raw
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return cleaned.length === 0 ? null : cleaned;
}

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
  /**
   * Fecha límite en modo "tarea". null = modo "examen" (heredado).
   *
   * En modo "tarea" el alumno puede entrar en cualquier momento antes de
   * `openUntil` y su countdown local corre por `duration` segundos desde el
   * click "Iniciar mi tarea" (persistido en localStorage). El servidor solo
   * valida que la entrega llegue con `now < openUntil` — el cap por alumno
   * es responsabilidad del cliente.
   */
  public readonly openUntil: Date | null;
  /**
   * Snapshot al CREATE del examen desde `ExamStructureArea.name` ordenado por
   * `order asc`. `null` = sin restricción (FICHAS y exámenes legacy); el
   * picker en LR renderiza las 16 conocidas por default. Array non-null =
   * subset elegible; el picker renderiza EXACTAMENTE esos strings en ese
   * orden. Puede contener labels que no están en `KnownAdmissionArea` — el
   * back es la autoridad.
   *
   * Invariante: nunca `[]` (el constructor normaliza array vacío a null).
   */
  public readonly allowedAdmissionAreas: readonly string[] | null;

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
    openUntil: Date | null;
    // Opcional para no romper factories/tests históricos que no lo pasan.
    // Undefined se trata como null (comportamiento por default: sin
    // restricción, picker muestra los 16 conocidos).
    allowedAdmissionAreas?: readonly string[] | null;
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
    if (
      params.openUntil !== null &&
      (!(params.openUntil instanceof Date) || Number.isNaN(params.openUntil.getTime()))
    ) {
      throw new InvalidExamError('Exam openUntil debe ser Date válido o null.');
    }
    if (!(params.serverStatus instanceof ExamServerStatus)) {
      throw new InvalidExamError('Exam requiere un ExamServerStatus válido.');
    }
    if (
      params.allowedAdmissionAreas !== null &&
      params.allowedAdmissionAreas !== undefined &&
      !Array.isArray(params.allowedAdmissionAreas)
    ) {
      throw new InvalidExamError('Exam allowedAdmissionAreas debe ser null o array de strings.');
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
    this.openUntil = params.openUntil;
    // Normalización invariante: `[]` o array con solo strings vacíos/whitespace
    // → `null` (semánticamente equivalente a "sin restricción"). Preservamos
    // el orden del back sin re-ordenar contra el VO — learnex ya ordena por
    // ExamStructureArea.order. Undefined en el input se trata como null.
    this.allowedAdmissionAreas = normalizeAllowedAreas(params.allowedAdmissionAreas ?? null);
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
    // Modo "tarea": el cierre server-side es `openUntil` sin importar cuándo
    // el tutor arrancó. La duración es cap per-alumno cliente-side y no
    // participa del cierre del server.
    if (this.openUntil !== null) return this.openUntil;
    // Modo "examen" heredado: startedAt + duration.
    if (this.started !== null) {
      return new Date(this.started.getTime() + this.duration * 1000);
    }
    return null;
  }

  /**
   * true = modo "tarea" (openUntil no-null → ventana global).
   * false = modo "examen" (contador desde started).
   */
  esTarea(): boolean {
    return this.openUntil !== null;
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
