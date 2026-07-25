import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { GetTutorExamsUseCase } from '../../L2_application/use-cases/get-tutor-exams.use-case';
import { GetTutorExamDetailUseCase } from '../../L2_application/use-cases/get-tutor-exam-detail.use-case';
import { ListClassroomStudentsUseCase } from '../../L2_application/use-cases/list-classroom-students.use-case';
import { IniciarExamenUseCase } from '../../L2_application/use-cases/iniciar-examen.use-case';
import { FinalizarExamenUseCase } from '../../L2_application/use-cases/finalizar-examen.use-case';
import { ArchivarExamenUseCase } from '../../L2_application/use-cases/archivar-examen.use-case';
import { ActualizarAlumnosHabilitadosUseCase } from '../../L2_application/use-cases/actualizar-alumnos-habilitados.use-case';
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
  readonly openUntilError = signal<string | null>(null);
  /**
   * Offset máximo (inclusivo) para el chip de día más lejano ofrecido.
   * 10 = "hoy + 10 días" → 11 chips totales (offsets 0..10). El server
   * también rechaza ventanas mayores; este cap es solo para no ofrecer
   * chips que van a fallar.
   */
  static readonly HOMEWORK_MAX_DAY_OFFSET = 10;

  /**
   * Fecha absoluta de cierre derivada del día + hora seleccionados. Toma
   * `now`, avanza `dayOffset` días, y setea la hora entera con minuto/seg 0.
   * Retorna null cuando alguno de los signals es null.
   */
  readonly pendingOpenUntilDate = computed<Date | null>(() => {
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

  // Cuenta de alumnos habilitados en tiempo real (lo que el tutor ve en la
  // lista con checkboxes). Total = alumnos del aula.
  readonly enabledCount = computed(() => this.enabledStudentIds().length);
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
    // no toca el selector. Defaults del deadline: mañana (offset=1) a las 23h
    // (fin del día). Cubre el caso típico "abro tarea hoy, cierra mañana a la
    // noche".
    this.pendingMode.set('examen');
    this.pendingDeadlineDayOffset.set(1);
    this.pendingDeadlineHour.set(23);
    this.durationError.set(null);
    this.openUntilError.set(null);
    this.editingDuration.set(false);
    this.iniciarModalOpen.set(true);
  }

  cancelIniciarModal(): void {
    this.iniciarModalOpen.set(false);
    this.pendingMinutes.set(null);
    this.pendingMode.set('examen');
    this.pendingDeadlineDayOffset.set(null);
    this.pendingDeadlineHour.set(null);
    this.durationError.set(null);
    this.openUntilError.set(null);
    this.editingDuration.set(false);
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

    // Validación de openUntil cuando el modo es "tarea". El server también
    // rechaza fuera de rango con 422 — acá es solo UX temprana. Los signals
    // son ruedas discretas: offset de días (0..MAX-1) y hora entera (1..23).
    // La única corner case que puede fallar: día=hoy + hora ya pasada.
    let openUntil: Date | undefined;
    if (this.pendingMode() === 'tarea') {
      const parsed = this.pendingOpenUntilDate();
      if (parsed === null) {
        this.openUntilError.set('Elegí día y hora de cierre.');
        return;
      }
      if (parsed.getTime() <= Date.now()) {
        this.openUntilError.set('La hora ya pasó. Elegí otro día u otra hora.');
        return;
      }
      openUntil = parsed;
    }

    const currentDuration = this.detail()?.duration ?? null;
    const override = totalSeconds === currentDuration ? undefined : totalSeconds;

    this.iniciarModalOpen.set(false);
    this.durationError.set(null);
    this.openUntilError.set(null);
    this.pendingMinutes.set(null);
    this.pendingDeadlineDayOffset.set(null);
    this.pendingDeadlineHour.set(null);
    this.editingDuration.set(false);

    await this.iniciar(override, openUntil);
  }

  // Inicia el examen (scheduled → in_progress). Guard D5: solo si canIniciar().
  // `newDuration` opcional en segundos (60..7200). Cuando viene, el back lo
  // persiste atómicamente junto con la transición de estado.
  // `openUntil` opcional. Cuando viene, el examen arranca en modo "tarea".
  async iniciar(newDuration?: number, openUntil?: Date): Promise<void> {
    if (!this.canIniciar()) return;

    const recordId = this.route.snapshot.paramMap.get('recordId') ?? '';
    this.actionError.set(null);
    this.isSaving.set(true);

    try {
      await this.iniciarExamen.execute({ recordId, duration: newDuration, openUntil });
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
  // store local (deja de aparecer en la lista) y redirige a /tutor/home.
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
      void this.router.navigate(['/tutor/home']);
    } catch (err) {
      this.actionError.set(this.copyForAction('archivar', err));
    } finally {
      this.isSaving.set(false);
    }
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
