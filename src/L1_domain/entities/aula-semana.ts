// Entidad AulaSemana — read-model de una fila de la lista de semanas del aula.
// Mapeada desde el response de GET /t/{slug}/tutor/aulas/{classroomId}/semanas.
//
// Representa una semana del ciclo del aula con los contadores agregados que
// pinta el badge de la card en el nav mobile (nivel 2 de AULA → SEMANA →
// CURSO → EXÁMENES).
//
// `startDate` / `endDate` viajan como YYYY-MM-DD del backend — mantenemos ese
// formato en dominio para evitar drift de timezone cuando el usuario está en
// GMT-5 y la BD en UTC. La UI los formatea con Intl al renderizar.
//
// `byStatus` no incluye `archived` porque el endpoint filtra archived
// server-side (invariante del contrato).
export interface AulaSemanaCounts {
  readonly scheduled: number;
  readonly in_progress: number;
  readonly finalized: number;
}

export class AulaSemana {
  public readonly periodId: string;
  public readonly name: string;
  /** cycle_periods.order — usar para ordenar sin parsear el name. */
  public readonly order: number;
  /** YYYY-MM-DD, sin timezone. */
  public readonly startDate: string;
  /** YYYY-MM-DD, sin timezone. */
  public readonly endDate: string;
  public readonly examCount: number;
  public readonly byStatus: AulaSemanaCounts;

  constructor(params: {
    periodId: string;
    name: string;
    order: number;
    startDate: string;
    endDate: string;
    examCount: number;
    byStatus: AulaSemanaCounts;
  }) {
    this.periodId = params.periodId;
    this.name = params.name;
    this.order = params.order;
    this.startDate = params.startDate;
    this.endDate = params.endDate;
    this.examCount = params.examCount;
    this.byStatus = params.byStatus;
  }

  /** Semana sin exámenes creados — la UI la lista igual con empty state. */
  estaVacia(): boolean {
    return this.examCount === 0;
  }

  /** Semana con al menos un examen `in_progress` — para el badge destacado. */
  tieneExamenesEnCurso(): boolean {
    return this.byStatus.in_progress > 0;
  }

  /**
   * Devuelve true si `nowServer` cae dentro del rango [startDate, endDate].
   * Recibe el "ahora" ya sincronizado con el reloj del servidor (ver
   * ServerAnchoredClock) — la entidad no consulta ningún reloj propio.
   * Comparación por string YYYY-MM-DD porque son fechas puras.
   */
  esSemanaActual(nowServer: Date): boolean {
    const today = nowServer.toISOString().slice(0, 10);
    return today >= this.startDate && today <= this.endDate;
  }
}
