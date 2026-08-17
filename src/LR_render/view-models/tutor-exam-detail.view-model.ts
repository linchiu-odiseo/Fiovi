import {
  Injectable,
  Signal,
  WritableSignal,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { GetTutorExamsUseCase } from '../../L2_application/use-cases/get-tutor-exams.use-case';
import { GetTutorExamDetailUseCase } from '../../L2_application/use-cases/get-tutor-exam-detail.use-case';
import { ListClassroomStudentsUseCase } from '../../L2_application/use-cases/list-classroom-students.use-case';
import { IniciarExamenUseCase } from '../../L2_application/use-cases/iniciar-examen.use-case';
import { FinalizarExamenUseCase } from '../../L2_application/use-cases/finalizar-examen.use-case';
import { ArchivarExamenUseCase } from '../../L2_application/use-cases/archivar-examen.use-case';
import { ActualizarAlumnosHabilitadosUseCase } from '../../L2_application/use-cases/actualizar-alumnos-habilitados.use-case';
import { RefreshHabilitadosUseCase } from '../../L2_application/use-cases/refresh-habilitados.use-case';
import { TutorExamsStore } from '../state/tutor-exams.store';
import { TutorExamDetail } from '../../L1_domain/value-objects/tutor-exam-detail';
import { ClassroomStudent } from '../../L1_domain/value-objects/classroom-student';
import { TutorExam } from '../../L1_domain/entities/tutor-exam';
import { ExamServerStatus } from '../../L1_domain/value-objects/exam-server-status';
import { CLOCK } from '../../app.config';
import { NetworkError } from '../../L1_domain/errors/network.error';
import { ExamConflictError } from '../../L1_domain/errors/exam-conflict.error';
import { ExamPreconditionError } from '../../L1_domain/errors/exam-precondition.error';
import { VirtualExamNotFoundError } from '../../L1_domain/errors/virtual-exam-not-found.error';
import { TutorExamForbiddenError } from '../../L1_domain/errors/tutor-exam-forbidden.error';
import { formatRestante, formatRestanteTarea } from '../utils/countdown-format';

// Ticker del countdown: refresca `nowTick` cada 1s para que los signals
// derivados (countdownRestante) recomputen. Idéntico al del simulacro del
// alumno — la referencia es el `Clock` server-anchored, nunca Date.now().
const COUNTDOWN_TICK_MS = 1_000;

// Ventana de tolerancia hacia el pasado para `startedAt` programado.
// El tutor puede seleccionar hasta 5 min atrás sin error; el server valida
// la misma ventana. Se usa como guarda client-side, no como fuente de verdad.
const CLOCK_SKEW_MS = 5 * 60 * 1_000;

// Estado del gate de reconciliación (reconcile-enabled-on-start-gate):
//   idle       — antes del primer intento; muestra CTA "Actualizar lista".
//   refreshing — POST /refresh en vuelo; muestra CTA "Actualizando...".
//   ready      — gate superado; el roster toma el control (showRoster=true).
type GateState = 'idle' | 'refreshing' | 'ready';

// Ventana máxima hacia el futuro para `openUntil` en modo tarea.
// 15 días en ms — el server también rechaza ventanas mayores.
const HOMEWORK_MAX_WINDOW_MS = 15 * 24 * 60 * 60 * 1_000;

// El countdown del tutor siempre corre en formato digital (MM:SS o HH:MM:SS
// según duración) — a diferencia del simulacro del alumno, que arriba de 5
// min degrada a "X min restantes" para no distraer al que está marcando.
// Acá el tutor es un observador, y ver el reloj corriendo entero da un
// feedback más claro del estado del examen.

// Un único refresh diferido tras cruzar el cierre local del countdown:
// da al back el tiempo del grace del auto-finalize (5s post-cierre) + un
// margen para que la cola de finalización procese. Se dispara UNA sola vez
// por recordId. Si el back tardó más, el próximo refresh manual / navegación
// del tutor lo recupera — no armamos ráfagas para no cargar el back cuando
// hay 500 alumnos convergiendo al mismo segundo.
const POST_CIERRE_REFRESH_MS = 10_000;

// Jitter simétrico (±3s) para dispersar el refresh entre los tutores/alumnos
// que terminen sus exámenes al mismo instante. Sin jitter, 500 clientes que
// arrancaron a la misma hora golpean al back en el mismo ms (thundering herd).
const POST_CIERRE_JITTER_MS = 3_000;

// View-model de la pantalla de gestión de un virtual exam (/tutor/exams/:recordId).
// Provider-local al TutorExamDetailPage (NO providedIn root) — cada montaje
// arranca limpio (D6 + D4). Ver diseño D1 (classroomId resolution), D2 (copy-by-action),
// D3 (online-only), D5 (UI guards), D8 (Strict TDD).
@Injectable()
export class TutorExamDetailViewModel {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly getTutorExams = inject(GetTutorExamsUseCase);
  private readonly getTutorExamDetail = inject(GetTutorExamDetailUseCase);
  private readonly listClassroomStudents = inject(ListClassroomStudentsUseCase);
  private readonly iniciarExamen = inject(IniciarExamenUseCase);
  private readonly finalizarExamen = inject(FinalizarExamenUseCase);
  private readonly archivarExamen = inject(ArchivarExamenUseCase);
  private readonly actualizarAlumnos = inject(ActualizarAlumnosHabilitadosUseCase);
  private readonly refreshHabilitadosUseCase = inject(RefreshHabilitadosUseCase);
  private readonly store = inject(TutorExamsStore);
  private readonly clock = inject(CLOCK);

  // Ticker del countdown en vivo. Se activa cuando el detalle está cargado
  // y su status es `in_progress`. Se detiene al pasar a `finalized` o al
  // destruir el componente. Idéntico al patrón del alumno (simulacro).
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  // Refresh diferido tras cruzar el cierre local. Se agenda una única vez por
  // recordId mediante el effect del constructor y se cancela en stop().
  private postCierreTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly postCierreRefreshDone = new Set<string>();

  constructor() {
    // Detecta el instante en que el countdown local cruza el cierre efectivo
    // con status=in_progress y programa un único refresh diferido para captar
    // el `status=finalized` que dispara el auto-finalize del back (~5s + grace).
    // Guardia por recordId: si el detail se recarga y sigue in_progress por
    // lag del back, no re-agenda; si el refresh trae finalized, tampoco lo
    // vuelve a intentar. Ver POST_CIERRE_REFRESH_MS + POST_CIERRE_JITTER_MS.
    effect(() => {
      const d = this.detail();
      if (!d) return;
      if (!d.status.is('in_progress')) return;
      const closeAt = this.effectiveCloseAt();
      if (closeAt === null) return;
      if (this.nowTick().getTime() < closeAt.getTime()) return;
      if (this.postCierreRefreshDone.has(d.recordId)) return;

      this.postCierreRefreshDone.add(d.recordId);
      this.schedulePostCierreRefresh(d.recordId);
    });
  }

  // Reloj para el countdown — server-anchored via el puerto Clock. NUNCA
  // Date.now() directo: el tutor puede tener el reloj del OS desfasado.
  readonly nowTick = signal<Date>(this.clock.now());

  // ── Signals expuestos (spec Requirement "TutorExamDetailViewModel — Signals expuestos") ──

  // Detalle del examen cargado desde el backend (null hasta primer carga exitosa).
  readonly detail = signal<TutorExamDetail | null>(null);

  // Lista de alumnos del aula del examen.
  readonly students = signal<readonly ClassroomStudent[]>([]);

  // Query de búsqueda del filtro en pantalla. Se aplica sobre `visibleStudents`
  // (client-side, sin request al back). Vacío = sin filtro.
  readonly searchQuery = signal<string>('');

  /**
   * Vista derivada de `students` — ordenada alfabéticamente por apellido
   * (secundario por nombre) con collation es-PE case+accent-insensitive, y
   * filtrada por `searchQuery` sobre apellido/nombre/código.
   *
   * `enabledStudentIds` NO se cruza acá — el contador "X habilitados de Y"
   * sigue leyendo del total real. El filtro es solo visual.
   */
  readonly visibleStudents = computed<readonly ClassroomStudent[]>(() => {
    const all = this.students();
    const sorted = [...all].sort((a, b) => {
      const byLast = a.lastName.localeCompare(b.lastName, 'es', { sensitivity: 'base' });
      if (byLast !== 0) return byLast;
      return a.firstName.localeCompare(b.firstName, 'es', { sensitivity: 'base' });
    });
    const query = normalizeForSearch(this.searchQuery());
    if (query === '') return sorted;
    return sorted.filter((s) => {
      const haystack = normalizeForSearch(`${s.lastName} ${s.firstName} ${s.studentCode}`);
      return haystack.includes(query);
    });
  });

  /** true cuando hay query activa pero el filtro no matchea a ningún alumno. */
  readonly hasNoSearchMatches = computed<boolean>(() => {
    if (this.students().length === 0) return false;
    if (this.searchQuery().trim() === '') return false;
    return this.visibleStudents().length === 0;
  });

  /** Actualiza el query de búsqueda desde el input de la page. */
  setSearchQuery(value: string): void {
    this.searchQuery.set(value);
  }

  /** Limpia el buscador (botón ✕ del input). */
  clearSearchQuery(): void {
    this.searchQuery.set('');
  }

  // true mientras la carga inicial esté en vuelo.
  readonly loading = signal(false);

  // Estado de error de carga: 'network' (NetworkError D3), 'notFound' (VirtualExamNotFoundError),
  // 'forbidden' (TutorExamForbiddenError), null si todo OK.
  readonly error = signal<'network' | 'notFound' | 'forbidden' | null>(null);

  // Set local mutable de IDs de alumnos habilitados. Se inicializa desde
  // detail().enabledStudentIds y se actualiza optimísticamente en toggleStudent().
  readonly enabledStudentIds = signal<readonly string[]>([]);

  // true mientras un PATCH/POST de acción está en vuelo.
  readonly isSaving = signal(false);

  // Copy en español del último error de acción (iniciar/finalizar/habilitar).
  // null si no hay error activo.
  readonly actionError = signal<string | null>(null);

  // Modal para editar la duración al iniciar. `iniciarModalOpen()` gobierna
  // la visibilidad. La duración se edita como MINUTOS enteros (los segundos
  // se fijan en 0 — ningún tutor configura exams con precisión de segundos).
  // Rango válido: 1 .. 180 min — mismo que el back. El tope NO se expone
  // en la UI; si intenta pasarse, el error inline lo frena antes del round-trip.
  //
  // El display es tap-to-edit: por default se muestra "MM:00 min ✏️" como
  // texto grande; al tap se convierte en un input focused. `editingDuration`
  // gobierna ese toggle. Mismo patrón para el bloque deadline en tarea.
  readonly iniciarModalOpen = signal(false);
  readonly pendingMinutes = signal<number | null>(null);
  readonly durationError = signal<string | null>(null);
  readonly editingDuration = signal(false);
  static readonly DURATION_MIN_SECONDS = 60;
  static readonly DURATION_MAX_SECONDS = 10800;

  // ── Selector de modo (examen | tarea) del modal iniciar ─────────────────────
  // En modo "tarea" el tutor elige (a) qué DÍA cierra (rueda horizontal
  // con los próximos N días — chips "HOY 24", "MAÑ 25", "JUE 26"…) y
  // (b) a qué HORA entera cierra (rueda 1..23). Se eliminó el input
  // "días + horas relativas" porque forzaba al tutor a sumar manualmente
  // para llegar a "dentro de 2 semanas". El tope de días es regla del
  // server; en el front lo capeamos en HOMEWORK_MAX_DAYS.
  readonly pendingMode = signal<'examen' | 'tarea'>('examen');
  readonly pendingDeadlineDayOffset = signal<number | null>(null);
  readonly pendingDeadlineHour = signal<number | null>(null);

  // Source of truth para el flujo datetime-local (formato "YYYY-MM-DDTHH:mm").
  // Preserva minutos (los signals legacy `dayOffset`+`hour` perdían precisión
  // al reconstruir con setHours(h, 0, 0, 0)). `null` = tutor no eligió aún.
  // Los signals legacy siguen viviendo como fallback para no romper tests
  // que los setean directamente (spec de VM).
  readonly pendingOpenUntil = signal<string | null>(null);

  // ── Señales para la programación de apertura (startedAt) ─────────────────
  // Cuando el modal está en modo "tarea", el tutor puede opcionalmente
  // ingresar una fecha/hora de inicio. Valor null = usar "ahora" (default:
  // el server arranca el examen inmediatamente al confirmar).
  //
  // La granularidad es por string ISO local (datetime-local input del DOM),
  // no por Date — el input nativo emite strings; la conversión a Date ocurre
  // en confirmIniciarModal() al armar el payload.
  readonly pendingStartedAt = signal<string | null>(null);

  // Toggle expandido/colapsado del bloque "Iniciar tarea desde".
  //   false = pill button visible (default: el examen abre AHORA).
  //   true  = datetime-local input expandido para elegir apertura futura.
  // Al colapsar (toggleStartedAtEditing) también se limpia pendingStartedAt
  // para que el server interprete el envío como "abrir ahora".
  readonly pendingStartedAtEditing = signal<boolean>(false);

  /**
   * Toggle entre pill button (colapsado) y datetime input (expandido).
   * Al colapsar, limpia pendingStartedAt → server interpreta como "ahora".
   */
  toggleStartedAtEditing(): void {
    const current = this.pendingStartedAtEditing();
    if (current) {
      // Colapsando: limpiar el pendingStartedAt.
      this.pendingStartedAt.set(null);
    }
    this.pendingStartedAtEditing.set(!current);
  }

  // Error de validación client-side para startedAt.
  readonly startedAtError = computed<string | null>(() => {
    const raw = this.pendingStartedAt();
    if (raw === null) return null;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    const now = new Date();
    // Validación 1: no puede ser en el pasado más allá de CLOCK_SKEW_MS.
    if (d.getTime() < now.getTime() - CLOCK_SKEW_MS) {
      return 'No puede ser en el pasado';
    }
    // Validación 2: debe ser antes del cierre (openUntil derivado).
    const openUntil = this.pendingOpenUntilDate();
    if (openUntil !== null && d.getTime() >= openUntil.getTime()) {
      return 'Debe ser antes del cierre';
    }
    return null;
  });

  // `isScheduledSubmitDisabled` es true cuando:
  //   - hay error en startedAt (validación client-side), o
  //   - hay error en openUntil (validación client-side), o
  //   - en modo tarea NO se eligió aún fecha de cierre (pendingOpenUntilDate = null).
  // El botón "Iniciar actividad" en modo tarea usa este computed para el [disabled].
  // La condición del cierre-null fuerza al tutor a elegir explícitamente cuándo
  // cierra antes de poder confirmar — antes el modal precargaba HOY 23h como
  // default y el tutor podía confirmar sin haber elegido intencionalmente.
  readonly isScheduledSubmitDisabled = computed<boolean>(() => {
    if (this.startedAtError() !== null) return true;
    if (this.openUntilError() !== null) return true;
    if (this.pendingMode() === 'tarea' && this.pendingOpenUntilDate() === null) return true;
    return false;
  });

  // Fecha absoluta de apertura derivada del input datetime-local. Null cuando
  // el tutor no eligió (usa default "ahora") o el string no parsea. Consumido
  // por la pill preview "Abre" del modal, análogo a pendingOpenUntilDate.
  readonly pendingStartedAtDate = computed<Date | null>(() => {
    const raw = this.pendingStartedAt();
    if (raw === null) return null;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  });

  // `showHwheels` controla si las ruedas de día/hora legacy se muestran.
  // En modo "tarea" siempre se ocultan en favor de los inputs datetime-local.
  // Se expone como computed reactivo al modo del modal.
  readonly showHwheels = computed<boolean>(() => this.pendingMode() !== 'tarea');

  /**
   * Offset máximo (inclusivo) para el chip de día más lejano ofrecido.
   * 10 = "hoy + 10 días" → 11 chips totales (offsets 0..10). El server
   * también rechaza ventanas mayores; este cap es solo para no ofrecer
   * chips que van a fallar.
   */
  static readonly HOMEWORK_MAX_DAY_OFFSET = 10;

  /**
   * true cuando la hora entera dada (1..23) todavía no pasó hoy. Base para
   * el default del modal y para el filtro de chips de hora en HOY. Lee
   * `new Date()` directo — la rueda vive en interacción real del usuario,
   * no en el reloj server-anchored (que solo aplica al countdown en vivo).
   */
  static isHourFutureToday(hour: number, now: Date = new Date()): boolean {
    if (!Number.isInteger(hour) || hour < 1 || hour > 23) return false;
    return hour > now.getHours();
  }

  /**
   * Menor hora entera (1..23) que sigue siendo válida para el `dayOffset`
   * dado. Para MAÑ+ siempre es 1. Para HOY es la primera hora estrictamente
   * mayor a la hora actual, o null cuando ya no queda ninguna (≥23h).
   */
  static firstValidHour(dayOffset: number, now: Date = new Date()): number | null {
    if (!Number.isInteger(dayOffset) || dayOffset < 0) return null;
    if (dayOffset > 0) return 1;
    const next = now.getHours() + 1;
    return next > 23 ? null : next;
  }

  /**
   * Fecha absoluta de cierre derivada del datetime-local (source of truth) o,
   * como fallback, del día+hora legacy (h-wheels). El fallback existe SOLO
   * para no romper tests que setean directamente `pendingDeadlineDayOffset`
   * y `pendingDeadlineHour`; el flujo real usa `pendingOpenUntil`.
   */
  readonly pendingOpenUntilDate = computed<Date | null>(() => {
    const raw = this.pendingOpenUntil();
    if (raw !== null && raw.length > 0) {
      const d = new Date(raw);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const offset = this.pendingDeadlineDayOffset();
    const hour = this.pendingDeadlineHour();
    if (offset === null || hour === null) return null;
    if (!Number.isInteger(offset) || !Number.isInteger(hour)) return null;
    const d = new Date();
    d.setDate(d.getDate() + offset);
    d.setHours(hour, 0, 0, 0);
    return d;
  });

  /**
   * Error de validación de `openUntil` derivado del estado. Aplica solo en
   * modo tarea. Reglas (en orden): (a) raw seteado que no parsea → fecha
   * inválida; (b) sin fecha → sin error (helper text aparte); (c) fecha en
   * el pasado; (d) fecha > now + 15d; (e) lapso menor a la duración del
   * examen (openUntil - startedAt < duration).
   *
   * NOTA: la copy `'Tope 15 días'` está congelada por un test que la aserta
   * literal (spec del VM). No cambiar sin actualizar el spec.
   */
  readonly openUntilError = computed<string | null>(() => {
    if (this.pendingMode() !== 'tarea') return null;

    const raw = this.pendingOpenUntil();
    if (raw !== null && raw.length > 0) {
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) return 'Fecha inválida.';
    }

    const d = this.pendingOpenUntilDate();
    if (d === null) return null; // Sin fecha aún: no es error, la helper text avisa.

    const now = Date.now();
    if (d.getTime() < now) return 'La fecha ya pasó.';
    if (d.getTime() > now + HOMEWORK_MAX_WINDOW_MS) return 'Tope 15 días';

    // Guard de duración: el lapso entre apertura (o AHORA) y cierre debe
    // alcanzar para que el examen quepa. Sin esto, el server rechaza al
    // arrancar y el tutor se lleva el error tarde. Ceil de minutos para
    // que la copy sea legible ("30 min" en vez de "29.5 min").
    const durationSec = this.detail()?.duration ?? 0;
    const startAnchor = this.pendingStartedAtDate()?.getTime() ?? now;
    const lapseMs = d.getTime() - startAnchor;
    if (durationSec > 0 && lapseMs < durationSec * 1000) {
      const durationMin = Math.ceil(durationSec / 60);
      return `El lapso debe ser al menos ${durationMin} min (duración del examen).`;
    }
    return null;
  });

  /**
   * `min`/`max` para los inputs datetime-local. Prevención de primer nivel:
   * el picker nativo NO permite elegir fechas fuera del rango — el error
   * computed queda como red de seguridad para escritura manual y edge cases
   * de timezone. Formato requerido por el input: "YYYY-MM-DDTHH:mm".
   *
   * - openUntilMinAttr: AHORA (no cerrar en el pasado).
   * - openUntilMaxAttr: AHORA + 15d (regla HOMEWORK_MAX_WINDOW_MS).
   * - startedAtMinAttr: AHORA - CLOCK_SKEW_MS (tolerancia de reloj).
   * - startedAtMaxAttr: openUntil - duración (para que el examen quepa)
   *   o AHORA + 15d si el tutor todavía no eligió cierre.
   */
  readonly openUntilMinAttr = computed<string>(() =>
    this.toDatetimeLocalString(new Date()),
  );
  readonly openUntilMaxAttr = computed<string>(() =>
    this.toDatetimeLocalString(new Date(Date.now() + HOMEWORK_MAX_WINDOW_MS)),
  );
  readonly startedAtMinAttr = computed<string>(() =>
    this.toDatetimeLocalString(new Date(Date.now() - CLOCK_SKEW_MS)),
  );
  readonly startedAtMaxAttr = computed<string>(() => {
    const openUntil = this.pendingOpenUntilDate();
    const durationSec = this.detail()?.duration ?? 0;
    if (openUntil === null) {
      return this.toDatetimeLocalString(new Date(Date.now() + HOMEWORK_MAX_WINDOW_MS));
    }
    return this.toDatetimeLocalString(new Date(openUntil.getTime() - durationSec * 1000));
  });

  /**
   * Total en segundos derivado de minutos (segundos = 0 fijo en la UI). Retorna
   * null cuando el input no es entero válido. Se usa para el display del tutor
   * y como fuente del `override` en `confirmIniciarModal()`.
   */
  readonly pendingTotalSeconds = computed<number | null>(() => {
    const m = this.pendingMinutes();
    if (m === null || !Number.isFinite(m) || !Number.isInteger(m)) return null;
    return m * 60;
  });

  // Modal de confirmación para finalizar. Requerido por UX: cerrar antes de
  // tiempo es una acción irreversible que congela el enabled set y dispara el
  // grader; el tutor confirma explícitamente.
  readonly finalizarModalOpen = signal(false);

  // Modal de confirmación para archivar. El examen archivado sale de la lista
  // del tutor — el back retorna sólo no-archived — por eso pedimos confirmación
  // explícita antes de sacarlo de la vista.
  readonly archivarModalOpen = signal(false);

  // Modal de confirmación para deshabilitar un alumno mientras el examen
  // está EN CURSO. Mientras scheduled, el toggle es directo sin modal.
  // `desactivarPendingStudentId` guarda el id del alumno cuyo toggle está
  // pendiente de confirmación — null cuando el modal no está abierto.
  readonly desactivarModalOpen = signal(false);
  readonly desactivarPendingStudentId = signal<string | null>(null);

  // Cuenta de alumnos ACTUALES del aula que están habilitados. Filtra por
  // `s.enabled` (flag del back) en vez de `enabledStudentIds.length` para
  // evitar contar IDs stale (alumnos que ya salieron del aula pero siguen
  // registrados en el examen — el refresh add-only no los quita).
  readonly enabledCount = computed(() => this.students().filter((s) => s.enabled).length);
  readonly totalStudents = computed(() => this.students().length);

  // ── Countdown (mismo cómputo que el simulacro del alumno) ───────────────────

  /**
   * Instante de cierre efectivo del examen:
   *   - `finishedAt` si el tutor ya cerró (real).
   *   - `startedAt + duration` cuando arrancó pero no terminó (cierre esperado).
   *   - `null` si aún no arrancó → sin countdown.
   * Mismo criterio que `Exam.effectiveCloseAt()` en el dominio del alumno —
   * NO usamos `scheduled + duration` como fallback para no engañar con
   * countdowns falsos antes de que el tutor active el examen.
   */
  readonly effectiveCloseAt = computed<Date | null>(() => {
    const d = this.detail();
    if (!d) return null;
    if (d.finishedAt !== null) return d.finishedAt;
    // Modo "tarea": el cierre es la fecha límite global, independiente de
    // cuándo arrancó el tutor. Prevalece sobre startedAt + duration porque en
    // tarea `duration` es el cap por alumno (client-side), no el cierre real.
    if (d.openUntil !== null) return d.openUntil;
    // Modo "examen": startedAt + duration cuando ya arrancó.
    if (d.startedAt !== null) {
      return new Date(d.startedAt.getTime() + d.duration * 1000);
    }
    return null;
  });

  /**
   * Countdown formateado. Recomputa cada tick del reloj server-anchored.
   *
   * En modo examen (siempre corto, ≤ 3h): reloj digital corriendo (MM:SS
   * o HH:MM:SS). El tutor está observando en tiempo real.
   *
   * En modo tarea (puede durar días): formato humano hasta los últimos 5
   * min, donde recién baja a MM:SS. Ver `formatRestanteTarea` para el
   * detalle de tramos.
   *
   * Vacío cuando aún no hay cierre determinable (no arrancado).
   */
  readonly countdownRestante = computed<string>(() => {
    const closeAt = this.effectiveCloseAt();
    if (closeAt === null) return '';
    // Ancla: `startedAt` (garantizado no-null si `effectiveCloseAt` no lo es).
    // Si el reloj cliente está por debajo del `startedAt`, tomamos el
    // `startedAt` como piso — evita mostrar "más tiempo del debido" cuando
    // el reloj cliente está atrasado respecto del server.
    const anchor = this.detail()?.startedAt ?? new Date(0);
    const referenceNow = Math.max(this.nowTick().getTime(), anchor.getTime());
    const remainingMs = Math.max(0, closeAt.getTime() - referenceNow);
    if (this.esTarea()) return formatRestanteTarea(remainingMs);
    return formatRestante(remainingMs);
  });

  /**
   * Hora de cierre formateada "HH:MM" para el header ("CIERRA A LAS 18:09").
   * Vacío cuando el examen aún no arrancó. En modo "tarea" con cierre a más
   * de 24h del `now` el label largo (closeDateTimeText) es el que muestra la
   * page — este signal sigue devolviendo solo hora para no reventar los tests
   * de proctored.
   */
  readonly closeTimeText = computed<string>(() => {
    const closeAt = this.effectiveCloseAt();
    if (closeAt === null) return '';
    return formatHHMM(closeAt);
  });

  /**
   * Cierre formateado como "DD/MM HH:MM" para el modo "tarea" cuando el cierre
   * puede caer en otro día. La page decide qué signal usar según `esTarea()`.
   */
  readonly closeDateTimeText = computed<string>(() => {
    const closeAt = this.effectiveCloseAt();
    if (closeAt === null) return '';
    return `${formatDDMM(closeAt)} ${formatHHMM(closeAt)}`;
  });

  /** true = detail cargado y `openUntil !== null` (modo tarea). */
  readonly esTarea = computed<boolean>(() => this.detail()?.openUntil !== null);

  /**
   * Prefijo del label de cierre: "Cierra a las" mientras el examen está
   * activo, "Cerrado a las" una vez finalizado. Deriva del status del
   * detail — así el header refleja instantáneamente el post-finalize sin
   * cambios extra en la page.
   */
  readonly closeLabelPrefix = computed<string>(() => {
    const d = this.detail();
    if (!d) return 'Cierra a las';
    return d.status.is('in_progress') ? 'Cierra a las' : 'Cerrado a las';
  });

  // ── Derived state helpers (para los guards de D5) ───────────────────────────

  // El botón "Iniciar" debe estar habilitado SOLO si status=scheduled Y hay ≥1 alumno
  // habilitado. (D5: defense-in-depth UI guard).
  canIniciar(): boolean {
    const d = this.detail();
    if (!d) return false;
    return d.status.is('scheduled') && this.enabledStudentIds().length > 0;
  }

  // El botón "Finalizar" debe estar habilitado SOLO si status=in_progress.
  canFinalizar(): boolean {
    const d = this.detail();
    if (!d) return false;
    return d.status.is('in_progress');
  }

  // El botón "Archivar" reemplaza a "Finalizar" cuando el examen ya terminó
  // (status=finalized). Guard D5 análogo — la page solo lo muestra si esto
  // es true; el back también valida la transición (409 si no aplica).
  canArchivar(): boolean {
    const d = this.detail();
    if (!d) return false;
    return d.status.is('finalized');
  }

  // Un checkbox de alumno está deshabilitado si el examen está finalizado (read-only)
  // o si el alumno ya entregó (hasSubmitted — backend 409 si se intenta cambiar).
  isCheckboxDisabled(student: ClassroomStudent): boolean {
    const d = this.detail();
    if (!d) return true;
    if (d.status.is('finalized')) return true;
    return student.hasSubmitted;
  }

  // ── Load sequence (D1) ──────────────────────────────────────────────────────

  // Carga completa: resolución de classroomId (D1) + detalle + alumnos en paralelo.
  // Es el punto de entrada principal del VM — la page lo llama en su constructor.
  async load(): Promise<void> {
    const recordId = this.route.snapshot.paramMap.get('recordId') ?? '';

    this.loading.set(true);
    this.error.set(null);

    try {
      // D1: Warm path — store ya tiene el exam → classroomId resuelto sin request extra.
      let exam = this.store.findByRecordId(recordId);

      if (!exam) {
        // D1: Cold path (deep-link / hard refresh) — store vacío → refetch lista una vez
        // para hidratar el store, luego re-resolver.
        const list = await this.getTutorExams.execute();
        this.store.setExams(list);
        exam = this.store.findByRecordId(recordId);
      }

      if (!exam) {
        // El recordId no existe en la lista del tutor — VirtualExamNotFoundError UX (D1).
        this.error.set('notFound');
        return;
      }

      const classroomId = exam.classroomId;
      const detailId = exam.detailId;

      // Cargar detalle + alumnos con los IDs ya resueltos.
      await this.loadDetailAndStudents(recordId, classroomId, detailId);
    } catch (err) {
      // Error durante el refetch de lista (D1 cold path).
      this.error.set(this.classifyLoadError(err));
    } finally {
      this.loading.set(false);
    }
  }

  // Reinvoca la secuencia completa de carga (D3: retry button).
  async retry(): Promise<void> {
    await this.load();
  }

  // ── Actions ─────────────────────────────────────────────────────────────────

  // Abre el modal de "iniciar actividad" precargando la duración actual del
  // detail como minutos enteros (redondeados). Segundos siempre 0 en la UI —
  // configurar exams con precisión de segundos no es un caso real.
  openIniciarModal(): void {
    if (!this.canIniciar()) return;
    const d = this.detail();
    if (!d) return;
    this.pendingMinutes.set(Math.round(d.duration / 60));
    // Default modo "examen" — el comportamiento heredado no cambia si el tutor
    // no toca el selector. En modo "tarea" YA NO precargamos día/hora de cierre:
    // el tutor debe elegir explícitamente cuándo cierra antes de poder confirmar.
    // Antes el modal precargaba HOY 23h → tutor podía disparar iniciar sin
    // haber puesto atención al cierre. Ahora `isScheduledSubmitDisabled` bloquea
    // el botón hasta que haya `pendingOpenUntilDate` no-null.
    this.pendingMode.set('examen');
    this.pendingDeadlineDayOffset.set(null);
    this.pendingDeadlineHour.set(null);
    this.pendingOpenUntil.set(null);
    this.pendingStartedAt.set(null);
    this.pendingStartedAtEditing.set(false);
    this.durationError.set(null);
    this.editingDuration.set(false);
    this.iniciarModalOpen.set(true);
  }

  cancelIniciarModal(): void {
    this.iniciarModalOpen.set(false);
    this.pendingMinutes.set(null);
    this.pendingMode.set('examen');
    this.pendingDeadlineDayOffset.set(null);
    this.pendingDeadlineHour.set(null);
    this.pendingOpenUntil.set(null);
    this.pendingStartedAt.set(null);
    this.pendingStartedAtEditing.set(false);
    this.durationError.set(null);
    this.editingDuration.set(false);
  }

  // Valida y arma el payload de `openUntil`/`startedAt` en modo "tarea".
  // Los errores ya se derivan por computeds (openUntilError, startedAtError)
  // y bloquean el botón (isScheduledSubmitDisabled). Acá solo garantizamos
  // que hay valores válidos para armar el payload.
  // Return: `null` si falta info o si algún computed reporta error (no debería
  // pasar en la práctica porque el botón queda disabled — segunda línea de
  // defensa contra confirm por doble click / bypass programático).
  private validateTareaModeInputs(): {
    openUntil: Date;
    startedAt: Date | undefined;
  } | null {
    const parsed = this.pendingOpenUntilDate();
    if (parsed === null) return null;
    if (this.openUntilError() !== null) return null;
    if (this.startedAtError() !== null) return null;

    const rawStartedAt = this.pendingStartedAt();
    let startedAt: Date | undefined;
    if (rawStartedAt !== null) {
      const parsedStartedAt = new Date(rawStartedAt);
      if (!Number.isNaN(parsedStartedAt.getTime())) {
        startedAt = parsedStartedAt;
      }
    }
    return { openUntil: parsed, startedAt };
  }

  // Confirma el modal: valida los minutos, arma el total en segundos (segundos
  // siempre 0 en la UI), y dispara `iniciar()` con el override si el tutor
  // cambió el valor original.
  async confirmIniciarModal(): Promise<void> {
    const m = this.pendingMinutes();
    const min = TutorExamDetailViewModel.DURATION_MIN_SECONDS;
    const max = TutorExamDetailViewModel.DURATION_MAX_SECONDS;

    if (m === null || !Number.isInteger(m)) {
      this.durationError.set('Ingresá los minutos como número entero.');
      return;
    }
    if (m < 0) {
      this.durationError.set('Los minutos no pueden ser negativos.');
      return;
    }

    const totalSeconds = m * 60;
    if (totalSeconds < min || totalSeconds > max) {
      const minMm = Math.floor(min / 60);
      const maxMm = Math.floor(max / 60);
      this.durationError.set(`La duración debe estar entre ${minMm} y ${maxMm} minutos.`);
      return;
    }

    let openUntil: Date | undefined;
    let startedAt: Date | undefined;
    if (this.pendingMode() === 'tarea') {
      const tareaInputs = this.validateTareaModeInputs();
      if (tareaInputs === null) return;
      openUntil = tareaInputs.openUntil;
      startedAt = tareaInputs.startedAt;
    }

    const currentDuration = this.detail()?.duration ?? null;
    const override = totalSeconds === currentDuration ? undefined : totalSeconds;

    this.iniciarModalOpen.set(false);
    this.durationError.set(null);
    this.pendingMinutes.set(null);
    this.pendingDeadlineDayOffset.set(null);
    this.pendingDeadlineHour.set(null);
    this.pendingOpenUntil.set(null);
    this.pendingStartedAt.set(null);
    this.editingDuration.set(false);

    await this.iniciar(override, openUntil, startedAt);
  }

  // Inicia el examen (scheduled → in_progress). Guard D5: solo si canIniciar().
  // `newDuration` opcional en segundos (60..7200). Cuando viene, el back lo
  // persiste atómicamente junto con la transición de estado.
  // `openUntil` opcional. Cuando viene, el examen arranca en modo "tarea".
  // `startedAt` opcional. Cuando viene, programa la apertura a futuro.
  async iniciar(newDuration?: number, openUntil?: Date, startedAt?: Date): Promise<void> {
    if (!this.canIniciar()) return;

    const recordId = this.route.snapshot.paramMap.get('recordId') ?? '';
    this.actionError.set(null);
    this.isSaving.set(true);

    try {
      await this.iniciarExamen.execute({ recordId, duration: newDuration, openUntil, startedAt });
      // Reload detail y upsert store (R4: list reflects new status immediately).
      await this.reloadDetail(recordId);
    } catch (err) {
      this.actionError.set(this.copyForAction('iniciar', err));
    } finally {
      this.isSaving.set(false);
    }
  }

  // Abre el modal de confirmación antes de finalizar. Guard D5: solo si el
  // examen está in_progress.
  openFinalizarModal(): void {
    if (!this.canFinalizar()) return;
    this.finalizarModalOpen.set(true);
  }

  cancelFinalizarModal(): void {
    this.finalizarModalOpen.set(false);
  }

  async confirmFinalizarModal(): Promise<void> {
    this.finalizarModalOpen.set(false);
    await this.finalizar();
  }

  // Finaliza el examen (in_progress → finalized). Guard D5: solo si canFinalizar().
  // transitioned:false es idempotente — no es un error (spec Requirement "Finalizar idempotencia").
  async finalizar(): Promise<void> {
    if (!this.canFinalizar()) return;

    const recordId = this.route.snapshot.paramMap.get('recordId') ?? '';
    this.actionError.set(null);
    this.isSaving.set(true);

    try {
      await this.finalizarExamen.execute({ recordId });
      // Ambos transitioned:true y transitioned:false son éxito → reload + upsert (R4).
      await this.reloadDetail(recordId);
    } catch (err) {
      this.actionError.set(this.copyForAction('finalizar', err));
    } finally {
      this.isSaving.set(false);
    }
  }

  // Abre el modal de confirmación de archivar. Guard D5: solo si el examen
  // está finalized.
  openArchivarModal(): void {
    if (!this.canArchivar()) return;
    this.archivarModalOpen.set(true);
  }

  cancelArchivarModal(): void {
    this.archivarModalOpen.set(false);
  }

  async confirmArchivarModal(): Promise<void> {
    this.archivarModalOpen.set(false);
    await this.archivar();
  }

  // Archiva el examen (finalized → archived). Tras éxito, quita el exam del
  // store local (deja de aparecer en la lista) y redirige al padre lógico
  // (parentRoute()) — que respeta `?from=` para volver a /tutor/actividad
  // cuando ese fue el punto de entrada, o a /tutor/home por default.
  async archivar(): Promise<void> {
    if (!this.canArchivar()) return;

    const recordId = this.route.snapshot.paramMap.get('recordId') ?? '';
    this.actionError.set(null);
    this.isSaving.set(true);

    try {
      await this.archivarExamen.execute({ recordId });
      // El back ya no lo va a devolver en la lista — sacamos del store local
      // para que /tutor/home no muestre el card obsoleto.
      this.store.remove(recordId);
      void this.router.navigate([this.parentRoute()]);
    } catch (err) {
      this.actionError.set(this.copyForAction('archivar', err));
    } finally {
      this.isSaving.set(false);
    }
  }

  // Ruta a la que "Volver" y "Archivar" navegan al salir del detail. Se lee
  // del queryParam `?from=` (seteado por el caller cuando venís de una
  // pantalla específica como /tutor/actividad) o cae al default /tutor/home.
  // Whitelist de destinos permitidos: los paths conocidos donde tiene sentido
  // volver. Cualquier otro valor cae al default para evitar open redirect.
  parentRoute(): string {
    const from = this.route.snapshot.queryParamMap.get('from');
    const allowed = new Set(['/tutor/home', '/tutor/actividad']);
    if (from !== null && allowed.has(from)) return from;
    return '/tutor/home';
  }

  /**
   * Punto de entrada del toggle desde el UI. Decide si abrir el modal de
   * confirmación o aplicar el toggle directo:
   *   - `scheduled` → toggle directo (activar/desactivar sin fricción).
   *   - `in_progress` + está ACTIVO → abre modal (desactivar en curso es
   *     irreversible en la práctica: el alumno queda sin nota al finalizar).
   *   - `in_progress` + está INACTIVO → toggle directo (habilitar no
   *     necesita confirmación, es una acción "segura").
   *   - `finalized` → no llega acá (el guard visual bloquea el input).
   */
  requestToggleStudent(studentId: string): void {
    const d = this.detail();
    if (!d) return;
    const isCurrentlyEnabled = this.enabledStudentIds().includes(studentId);
    if (d.status.is('in_progress') && isCurrentlyEnabled) {
      this.desactivarPendingStudentId.set(studentId);
      this.desactivarModalOpen.set(true);
      return;
    }
    void this.toggleStudent(studentId);
  }

  /**
   * Confirma la deshabilitación pendiente desde el modal. Cierra el modal
   * y dispara el toggle real. Silencioso si no hay pending (defensa por
   * doble click).
   */
  async confirmDesactivarStudent(): Promise<void> {
    const studentId = this.desactivarPendingStudentId();
    this.desactivarModalOpen.set(false);
    this.desactivarPendingStudentId.set(null);
    if (studentId === null) return;
    await this.toggleStudent(studentId);
  }

  /** Cierra el modal sin aplicar cambios. El checkbox visual queda como estaba. */
  cancelDesactivarStudent(): void {
    this.desactivarModalOpen.set(false);
    this.desactivarPendingStudentId.set(null);
  }

  // Alterna el estado habilitado de un alumno.
  // Actualiza enabledStudentIds localmente (optimistic) y dispara el PATCH.
  // En error → revierte enabledStudentIds y setea actionError (D5 rollback).
  async toggleStudent(studentId: string): Promise<void> {
    const prev = this.enabledStudentIds();
    const recordId = this.route.snapshot.paramMap.get('recordId') ?? '';

    // Optimistic local update.
    const next = prev.includes(studentId)
      ? prev.filter((id) => id !== studentId)
      : [...prev, studentId];

    this.enabledStudentIds.set(next);
    this.actionError.set(null);
    this.isSaving.set(true);

    try {
      await this.actualizarAlumnos.execute({ recordId, enabledStudentIds: next });
    } catch (err) {
      // Rollback local state on error (spec Scenario "PATCH falla — enabledStudentIds se revierte").
      this.enabledStudentIds.set(prev);
      this.actionError.set(this.copyForAction('actualizarAlumnos', err));
    } finally {
      this.isSaving.set(false);
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  // Carga detalle + alumnos en paralelo una vez que classroomId y detailId están resueltos.
  private async loadDetailAndStudents(
    recordId: string,
    classroomId: string,
    detailId: string,
  ): Promise<void> {
    try {
      const [detail, students] = await Promise.all([
        this.getTutorExamDetail.execute({ recordId }),
        this.listClassroomStudents.execute({ classroomId, virtualExamDetailId: detailId }),
      ]);

      this.detail.set(detail);
      this.students.set(students);
      this.enabledStudentIds.set(detail.enabledStudentIds);
      this.error.set(null);
      this.syncCountdownTicker();
    } catch (err) {
      this.error.set(this.classifyLoadError(err));
    }
  }

  // Recarga el detalle tras una acción exitosa (iniciar/finalizar).
  // También llama store.upsert para que la lista refleje el nuevo estado (R4).
  private async reloadDetail(recordId: string): Promise<void> {
    const detail = await this.getTutorExamDetail.execute({ recordId });
    this.detail.set(detail);
    this.enabledStudentIds.set(detail.enabledStudentIds);
    this.syncCountdownTicker();

    // Upsert en el store con el nuevo status (R4 mitigation).
    // Construimos un TutorExam mínimo desde el detail — el classroomId y el
    // `scheduled` los obtenemos del store (ya los teníamos en el warm path o
    // tras el refetch); el detail sí trae course + area actualizados.
    const existingExam = this.store.findByRecordId(recordId);
    if (existingExam) {
      const updatedExam = new TutorExam({
        detailId: detail.id,
        recordId: detail.recordId,
        classroomId: existingExam.classroomId,
        serverStatus: detail.status,
        name: detail.name,
        course: detail.course,
        area: detail.area,
        count: detail.count,
        duration: detail.duration,
        scheduled: existingExam.scheduled,
        startedAt: detail.startedAt,
        finishedAt: detail.finishedAt,
        openUntil: detail.openUntil,
      });
      this.store.upsert(updatedExam);
    }
  }

  // Clasifica errores de carga (initial load / retry) al error signal.
  private classifyLoadError(err: unknown): 'network' | 'notFound' | 'forbidden' {
    if (err instanceof NetworkError) return 'network';
    if (err instanceof VirtualExamNotFoundError) return 'notFound';
    if (err instanceof TutorExamForbiddenError) return 'forbidden';
    // Unexpected errors during load → treat as network for UX (log in future).
    return 'network';
  }

  // Copy-by-action table (D2): selecciona el mensaje en español según la
  // acción × tipo de error. Usa instanceof — NUNCA lee body.message (design.md D2).
  //
  // Tabla completa en design.md §D2. Los valores exactos respetan el tone rioplatense
  // del copy de diseño.
  private copyForAction(
    action: 'iniciar' | 'finalizar' | 'archivar' | 'actualizarAlumnos',
    err: unknown,
  ): string {
    switch (action) {
      case 'iniciar':
        if (err instanceof ExamConflictError)
          return 'El examen ya cambió de estado. Actualizá la pantalla e intentá de nuevo.';
        if (err instanceof ExamPreconditionError)
          return 'No se puede iniciar: configurá las claves y habilitá al menos un alumno antes de iniciar el examen.';
        if (err instanceof VirtualExamNotFoundError) return 'Este examen ya no está disponible.';
        if (err instanceof TutorExamForbiddenError)
          return 'No tenés permiso para operar este examen.';
        if (err instanceof NetworkError) return 'Sin conexión. Revisá tu red y reintentá.';
        return 'Ocurrió un error al iniciar el examen. Reintentá.';

      case 'finalizar':
        if (err instanceof ExamConflictError)
          return 'El examen ya cambió de estado. Actualizá la pantalla e intentá de nuevo.';
        if (err instanceof ExamPreconditionError)
          return 'No se puede finalizar un examen que todavía no fue iniciado. Iniciálo primero.';
        if (err instanceof VirtualExamNotFoundError) return 'Este examen ya no está disponible.';
        if (err instanceof TutorExamForbiddenError)
          return 'No tenés permiso para operar este examen.';
        if (err instanceof NetworkError) return 'Sin conexión. Revisá tu red y reintentá.';
        return 'Ocurrió un error al finalizar el examen. Reintentá.';

      case 'archivar':
        if (err instanceof ExamConflictError)
          return 'El examen ya fue archivado o todavía no está finalizado.';
        if (err instanceof VirtualExamNotFoundError) return 'Este examen ya no está disponible.';
        if (err instanceof TutorExamForbiddenError)
          return 'No tenés permiso para archivar este examen.';
        if (err instanceof NetworkError) return 'Sin conexión. Revisá tu red y reintentá.';
        return 'Ocurrió un error al archivar el examen. Reintentá.';

      case 'actualizarAlumnos':
        if (err instanceof ExamConflictError)
          return 'No se pueden cambiar los alumnos: el set está congelado o un alumno ya entregó.';
        if (err instanceof ExamPreconditionError)
          return 'Configuración de alumnos inválida. Revisá la selección.';
        if (err instanceof VirtualExamNotFoundError) return 'Este examen ya no está disponible.';
        if (err instanceof TutorExamForbiddenError)
          return 'No tenés permiso para operar este examen.';
        if (err instanceof NetworkError) return 'Sin conexión. Revisá tu red y reintentá.';
        return 'Ocurrió un error al actualizar los alumnos. Reintentá.';
    }
  }

  // Format helper para inputs datetime-local (formato "YYYY-MM-DDTHH:mm").
  // Funcional puro: no toca signals, se puede llamar desde cualquier computed.
  // Vive acá y no en `utils/` porque solo se usa desde este VM (por ahora).
  private toDatetimeLocalString(d: Date): string {
    const pad = (n: number): string => String(n).padStart(2, '0');
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      `T${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  }

  // ── Countdown ticker lifecycle ───────────────────────────────────────────

  /**
   * Arranca el ticker si el examen está en curso, lo detiene si ya terminó
   * (o si aún no arrancó). Llamado tras cada carga/recarga del detail —
   * cubre los 3 flujos: primer load, tras iniciar, tras finalizar.
   */
  private syncCountdownTicker(): void {
    const d = this.detail();
    if (d && d.status.is('in_progress')) {
      this.startCountdownTicker();
    } else {
      this.stopCountdownTicker();
    }
  }

  private startCountdownTicker(): void {
    if (this.countdownTimer !== null) return;
    if (this.stopped) return;
    // Sync inmediato para que el primer render no espere 1s con el valor
    // desactualizado que quedó desde la construcción del VM.
    this.nowTick.set(this.clock.now());
    this.countdownTimer = setInterval(() => {
      if (this.stopped) return;
      this.nowTick.set(this.clock.now());
    }, COUNTDOWN_TICK_MS);
  }

  private stopCountdownTicker(): void {
    if (this.countdownTimer !== null) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  /**
   * Programa un único refresh diferido tras cruzar el cierre local del
   * countdown, con jitter simétrico para dispersar el pico cuando 500
   * clientes cruzan el cierre a la misma hora. `Math.random()` alcanza:
   * no necesitamos jitter criptográfico, sólo dispersión estadística.
   *
   * Reintento condicional: si el refresh falla (network) o si el back
   * responde todavía en `in_progress` (auto-finalize del backend aún no
   * procesó por lag), liberamos el guard para que el próximo tick del
   * countdown pueda re-agendar. El setTimeout de 10s + jitter actúa como
   * throttle natural, así que "reintento" no es spam.
   */
  private schedulePostCierreRefresh(recordId: string): void {
    if (this.stopped) return;
    const jitter = Math.random() * 2 * POST_CIERRE_JITTER_MS - POST_CIERRE_JITTER_MS;
    const delay = POST_CIERRE_REFRESH_MS + jitter;
    this.postCierreTimer = setTimeout(async () => {
      this.postCierreTimer = null;
      if (this.stopped) return;
      try {
        await this.reloadDetail(recordId);
        const d = this.detail();
        if (d && d.status.is('in_progress')) {
          // Back aún no finalizó (lag del auto-finalize). Liberá el guard
          // para permitir un segundo intento en el próximo tick.
          this.postCierreRefreshDone.delete(recordId);
        }
      } catch {
        // Error de red / timeout: liberamos el guard para permitir reintento.
        // No mostramos actionError — el poll normal / navegación posterior
        // levantará el estado real; molestar al tutor con un banner por un
        // refresh diferido interno sería confuso.
        this.postCierreRefreshDone.delete(recordId);
      }
    }, delay);
  }

  private cancelPostCierreRefresh(): void {
    if (this.postCierreTimer !== null) {
      clearTimeout(this.postCierreTimer);
      this.postCierreTimer = null;
    }
  }

  /**
   * Teardown del VM. La page lo invoca en `destroyRef.onDestroy` — sin esto,
   * el `setInterval` seguiría corriendo tras la navegación aunque el VM ya
   * no exista, generando un leak (y llamados a `clock.now()` sobre un
   * observable descartado).
   */
  stop(): void {
    this.stopped = true;
    this.stopCountdownTicker();
    this.cancelPostCierreRefresh();
  }

  // ─── Gate de reconciliación de habilitados (reconcile-enabled-on-start-gate) ─────
  //
  // Bloque completamente aislado del countdown ticker, D1 resolution y optimistic
  // updates. `_gateState` no es leído por ningún computed/effect existente. Su
  // único efecto colateral externo es disparar `reloadDetail()` en éxito y
  // escribir en `actionError` — ambos ya existían y son thread-safe via signals.
  //
  // El signal vive en la instancia del VM. Reset garantizado por el ciclo de vida
  // del componente: destruir → navegar → volver → VM nuevo → `_gateState` = 'idle'.
  // Ver design.md D4, D5, D7, D8.

  /** Estado interno mutable del gate. No accesible fuera del VM. */
  private readonly _gateState: WritableSignal<GateState> = signal<GateState>('idle');

  /** Estado readonly del gate expuesto al template via el page component. */
  readonly gateState: Signal<GateState> = this._gateState.asReadonly();

  /**
   * Computed single-source-of-truth para el condicional del roster.
   * Retorna true cuando el roster debe estar visible:
   *   - detail es null → false (sin datos, nada que mostrar).
   *   - status !== 'scheduled' → true (in_progress / finalized: sin gate).
   *   - status === 'scheduled' && gateState === 'ready' → true (gate superado).
   *   - status === 'scheduled' && gateState !== 'ready' → false (gate activo).
   */
  readonly showRoster = computed<boolean>(() => {
    const d = this.detail();
    if (!d) return false;
    return d.status.value !== 'scheduled' || this._gateState() === 'ready';
  });

  /**
   * Dispara la reconciliación de habilitados.
   * Transiciones de gateState: idle → refreshing → ready (exito) o idle (error).
   * En éxito: recarga el detalle para reflejar los alumnos nuevamente habilitados.
   * En error: setea actionError con copy en español clasificado por instanceof.
   */
  async handleRefresh(): Promise<void> {
    const recordId = this.route.snapshot.paramMap.get('recordId') ?? '';
    this._gateState.set('refreshing');

    try {
      await this.refreshHabilitadosUseCase.execute(recordId);
      this._gateState.set('ready');
      this.actionError.set(null);
      await this.reloadDetail(recordId);

      // Refetch del roster: reloadDetail() actualiza `detail.enabledStudentIds`
      // (contador X/Y) pero NO refresca `this.students` (lista visual con nombre,
      // apellido, hasSubmitted). Sin este refetch, los alumnos recién habilitados
      // aparecen en el contador pero no en la lista — el gate visualmente miente.
      const currentDetail = this.detail();
      const currentExam = this.store.findByRecordId(recordId);
      if (currentDetail && currentExam) {
        const students = await this.listClassroomStudents.execute({
          classroomId: currentExam.classroomId,
          virtualExamDetailId: currentDetail.id,
        });
        this.students.set(students);
      }
    } catch (err) {
      this._gateState.set('idle');
      if (err instanceof ExamConflictError) {
        this.actionError.set(
          'El examen ya fue iniciado. Recargá la página para ver el estado actual.',
        );
      } else if (err instanceof NetworkError) {
        this.actionError.set('Sin conexión. Verificá tu red y volvé a intentar.');
      } else if (err instanceof VirtualExamNotFoundError) {
        this.actionError.set('No se encontró el examen. Volvé a la lista.');
      } else if (err instanceof TutorExamForbiddenError) {
        this.actionError.set('No tenés permiso para actualizar la lista de este examen.');
      } else if (err instanceof ExamPreconditionError) {
        this.actionError.set('Hay un problema con los datos del examen. Volvé a la lista.');
      } else {
        throw err;
      }
    }
  }
}

// Re-export ExamServerStatus for template usage (avoids extra imports in page).
export { ExamServerStatus };

// ── Formatting helpers locales (los de countdown viven en utils/) ───────────

function formatHHMM(d: Date): string {
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatDDMM(d: Date): string {
  const dd = d.getDate().toString().padStart(2, '0');
  const mm = (d.getMonth() + 1).toString().padStart(2, '0');
  return `${dd}/${mm}`;
}

// Normaliza para búsqueda: lower + strip diacríticos. Así "garcia" matchea
// "GARCÍA" y "muñoz" matchea "MUNOZ". NFD descompone acentos en base+combining,
// después la regex \p{Diacritic} borra los combining marks.
function normalizeForSearch(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}
