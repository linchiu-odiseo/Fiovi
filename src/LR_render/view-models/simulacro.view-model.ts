import { Injectable, Signal, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { GetTodaysExamsUseCase } from '../../L2_application/use-cases/get-todays-exams.use-case';
import { GetMySubmissionUseCase } from '../../L2_application/use-cases/get-my-submission.use-case';
import { MarcarRespuestaUseCase } from '../../L2_application/use-cases/marcar-respuesta.use-case';
import { EnviarSimulacroUseCase } from '../../L2_application/use-cases/enviar-simulacro.use-case';
import { EnviarTareaUseCase } from '../../L2_application/use-cases/enviar-tarea.use-case';
import {
  AutoEnvioHandle,
  ProgramarAutoEnvioUseCase,
} from '../../L2_application/use-cases/programar-auto-envio.use-case';
import { SeleccionarAdmissionAreaUseCase } from '../../L2_application/use-cases/seleccionar-admission-area.use-case';
import { CLOCK, MARKINGS_STORAGE } from '../../app.config';
import { DraftAutoSaveDispatcher } from '../../L3_periphery/envio/draft-auto-save-dispatcher.service';
import { Exam } from '../../L1_domain/entities/exam';
import { Alternativa } from '../../L1_domain/value-objects/alternativa';
import { AlternativaValue, AnswersMap } from '../../L1_domain/ports/markings-storage';
import {
  AdmissionArea,
  DEFAULT_ADMISSION_AREA,
} from '../../L1_domain/value-objects/admission-area';
import { SubmissionAck } from '../../L1_domain/value-objects/submission-ack';
import { NetworkError } from '../../L1_domain/errors/network.error';
import { SessionExpiredError } from '../../L1_domain/errors/session-expired.error';
import { SimulacroCerradoError } from '../../L1_domain/errors/simulacro-cerrado.error';
import { SimulacroNoAsignadoError } from '../../L1_domain/errors/simulacro-no-asignado.error';
import { InvalidSubmissionTimeError } from '../../L1_domain/errors/invalid-submission-time.error';
import { InvalidPayloadError } from '../../L1_domain/errors/invalid-payload.error';

// Razón de redirect al /home, lo usa el view-model para no renderizar UI de
// error en la página. Si en el futuro queremos un toast global, el `flash`
// del router (state) es el canal natural.
export type SimulacroErrorState =
  | 'not-found'
  | 'pendiente'
  | 'enviado'
  | 'cerrado'
  | 'session-expired'
  | 'network'
  | 'invalid-submission-time'
  | 'invalid-payload'
  | 'unknown';

// Estado del flujo de envío. 'idle' antes de cualquier intento;
// 'sending' mientras el POST está en vuelo; 'sent' tras éxito (la página
// va a /home, por lo que el alumno no llega a verlo casi); 'queued' cuando
// el POST falló por NetworkError y el envío quedó en cola para retry — el
// alumno se queda en la página viendo el banner naranja hasta que decida
// volver manualmente o expire el ticker.
export type SubmissionState = 'idle' | 'sending' | 'sent' | 'queued' | 'error';

// Estado de protección por fila contra cambios accidentales. La grilla
// permite marcar en 1 tap cualquier pregunta vacía, pero modificar una ya
// marcada requiere un gesto deliberado (long-press) que pone la fila en
// `editing` por un tiempo limitado. Ver Requirement "Protección contra
// cambios accidentales" en exam-marking.spec.md.
//
//   unmarked → marca con 1 tap → locked
//   locked   → long-press 500ms en la fila → editing
//   editing  → tap en burbuja aplica cambio → locked (o unmarked si borró)
//   editing  → 5s sin acción / scroll / long-press otra fila → locked
export type SimulacroRowState = 'unmarked' | 'locked' | 'editing';

// El countdown re-renderiza cada segundo. Mismo patrón que HomePageViewModel:
// nowTick es un signal puro alimentado por el puerto Clock (server-anchored).
const COUNTDOWN_TICK_MS = 1_000;

// Umbral para cambiar el formato del countdown: por debajo de 5 minutos
// queremos ver los segundos para que el alumno sienta la urgencia; por encima
// con minutos basta y la pantalla no parpadea cada segundo en algo irrelevante.
const SHOW_SECONDS_BELOW_MS = 5 * 60_000;

// Cuánto dura el modo `editing` antes de auto-bloquearse si el alumno no
// toca nada. Elegido balanceando "tiempo suficiente para reaccionar" vs
// "volver pronto a la protección". 5s es lo que mostraba el preview de UX.
const EDITING_AUTO_LOCK_MS = 5_000;

// View-model de /simulacro/:id. Provider-local a SimulacroPage (no providedIn
// root) para que cada montaje arranque limpio sus timers y estado.
//
// DEUDA: hoy reutilizamos GetTodaysExamsUseCase y filtramos en cliente. Cuando
// learnex exponga `GET /t/{slug}/student/exam-sessions/{id}` sería más limpio
// un ObtenerExamenPorIdUseCase dedicado — evita traer N-1 exámenes que no
// vamos a usar y separa la responsabilidad de "lista del día" de "uno".
@Injectable()
export class SimulacroPageViewModel {
  private readonly getTodaysExams = inject(GetTodaysExamsUseCase);
  private readonly getMySubmission = inject(GetMySubmissionUseCase);
  private readonly marcarRespuesta = inject(MarcarRespuestaUseCase);
  private readonly enviarSimulacro = inject(EnviarSimulacroUseCase);
  private readonly enviarTarea = inject(EnviarTareaUseCase);
  private readonly programarAutoEnvio = inject(ProgramarAutoEnvioUseCase);
  private readonly seleccionarAdmissionArea = inject(SeleccionarAdmissionAreaUseCase);
  private readonly markings = inject(MARKINGS_STORAGE);
  private readonly clock = inject(CLOCK);
  private readonly router = inject(Router);
  // El provider en app.config.ts devuelve DraftAutoSaveDispatcher real si
  // environment.draftEnabled===true, o NoopDraftAutoSaveDispatcher si está
  // apagado. El view-model llama métodos sin condicional (design.md D7).
  private readonly draftDispatcher = inject(DraftAutoSaveDispatcher);

  readonly exam = signal<Exam | null>(null);
  readonly marcaciones = signal<AnswersMap>({});
  readonly isLoading = signal(false);
  readonly errorState = signal<SimulacroErrorState | null>(null);
  readonly nowTick = signal<Date>(this.clock.now());
  readonly isSubmitting = signal(false);
  readonly submissionState = signal<SubmissionState>('idle');
  // Comprobante criptográfico del último envío exitoso. Cuando es no-null,
  // el page renderiza `<app-submission-receipt-modal>` y NO navega: el alumno
  // ve el recibo. `onReceiptClose()` lo limpia y dispara el redirect a /home.
  readonly lastAck = signal<SubmissionAck | null>(null);

  // Número de la pregunta cuya fila está actualmente en modo `editing`, o
  // null si ninguna lo está. Solo puede haber una a la vez — entrar a
  // edición en otra cierra la anterior automáticamente. El template usa
  // este signal para mostrar el chip flotante "Toca para cambiar" sobre
  // la fila editing.
  readonly editingRow = signal<number | null>(null);

  // Área de POSTULACIÓN elegida por el alumno para este examen.
  // Se hidrata desde storage en loadMarcaciones; si nunca se persistió,
  // arranca en DEFAULT_ADMISSION_AREA (GENERAL) — pero el default NO se
  // materializa en storage (design.md D3 de add-admission-area).
  // NO confundir con `Exam.area` (curso: Letras/Ciencias/Números).
  readonly admissionArea = signal<AdmissionArea>(DEFAULT_ADMISSION_AREA);

  // Signal opcional para UI futura. Hoy queda en 'idle' — el dispatcher no
  // expone ganchos para actualizarla. Change posterior los agregará cuando
  // UX pida render visible del estado del auto-save.
  readonly draftStatus = signal<'idle' | 'syncing' | 'synced' | 'offline'>('idle');

  // Lista derivada de números de pregunta 1..count. Recomputa solo cuando
  // cambia el examen — barato.
  readonly preguntas: Signal<readonly number[]> = computed(() => {
    const e = this.exam();
    if (e === null) return [];
    return Array.from({ length: e.count }, (_, i) => i + 1);
  });

  /**
   * Cierre efectivo desde el punto de vista del ALUMNO — usado por countdown
   * y auto-envio locales.
   *
   * Modo "tarea": min(myStartedAt + duration, openUntil). Antes de hidratar
   * myStartedAt (o si el alumno nunca abrió la tarea) fallback a openUntil
   * pelado — es el cutoff hard del server.
   *
   * Modo "examen" (heredado): delega en `Exam.effectiveCloseAt()`.
   *
   * Este cómputo NO cambia el dominio — el server sigue viendo openUntil
   * como fuente de verdad. Es una vista "personal" para el UX local del alumno.
   */
  readonly personalCloseAt: Signal<Date | null> = computed(() => {
    const e = this.exam();
    if (e === null) return null;
    if (e.finished !== null) return e.finished;
    if (e.esTarea()) {
      const openUntil = e.openUntil!;
      const my = this.myStartedAt();
      if (my === null) return openUntil;
      const personalMs = my.getTime() + e.duration * 1000;
      return personalMs < openUntil.getTime() ? new Date(personalMs) : openUntil;
    }
    return e.effectiveCloseAt();
  });

  // Countdown formateado para el header. Recomputa cada segundo (al cambiar
  // nowTick) y cuando se setea/cambia el examen. Cuenta hasta el cierre
  // efectivo personal — `personalCloseAt` — usando `started` como referencia
  // mínima. Cuando `personalCloseAt` es null (examen aún no activado por el
  // tutor), retorna vacío — el banner "tomando un café" comunica el estado.
  readonly countdownRestante: Signal<string> = computed(() => {
    const e = this.exam();
    if (e === null) return '';
    const closeAt = this.personalCloseAt();
    if (closeAt === null) return '';
    // En tarea la ancla es el myStartedAt local (el alumno arranca su
    // countdown al entrar); en examen sigue siendo el started global del tutor.
    const anchor = e.esTarea() ? (this.myStartedAt() ?? e.scheduled) : (e.started ?? e.scheduled);
    const referenceNow = Math.max(this.nowTick().getTime(), anchor.getTime());
    const remainingMs = Math.max(0, closeAt.getTime() - referenceNow);
    return formatRestante(remainingMs);
  });

  // Hora de cierre efectivo como "HH:MM" para mostrar junto al countdown.
  // Usa `personalCloseAt` para reflejar el cutoff del alumno (en tarea puede
  // ser antes del openUntil global si su duración local vence primero).
  readonly cierreHHMM: Signal<string> = computed(() => {
    const closeAt = this.personalCloseAt();
    if (closeAt === null) return '';
    return formatHHMM(closeAt);
  });

  // True cuando el reloj cliente aún no cruzó `started`. La página usa
  // este signal para mostrar el banner "tomando un café" y para
  // deshabilitar el botón Enviar — el examen es entrable (status =
  // in_progress) pero no vigente todavía.
  // `Exam.hasStartedBy(now)` devuelve false también cuando `started === null`,
  // caso defensivo: si llegara así, banner aparece y Enviar queda gris.
  readonly examenNoIniciado: Signal<boolean> = computed(() => {
    const e = this.exam();
    if (e === null) return false;
    return !e.hasStartedBy(this.nowTick());
  });

  // True cuando el examen está vigente para marcar/enviar: status
  // permite entrada y el reloj cliente cae dentro del intervalo
  // [started, effectiveCloseAt]. Cuando esto es false la grilla queda
  // visualmente atenuada y los clicks no aplican — las marcas previas
  // siguen visibles pero no se pueden cambiar ni agregar.
  readonly vigente: Signal<boolean> = computed(() => {
    return !this.examenNoIniciado() && !this.examenTiempoCumplido();
  });

  // True cuando el reloj cliente ya cruzó el cierre efectivo del examen.
  // El cliente NO redirige por esto — el server manda el cierre real
  // (siguiente polling de /home detecta `status === 'finalized'`). La
  // función de este signal es solo decorativa: muestra banner "tiempo
  // agotado" y deshabilita el botón Enviar para evitar envíos local-only
  // que el back rechazaría. Cuando `effectiveCloseAt` es null (examen
  // aún no activado), retorna false — no aplica el concepto de "tiempo
  // agotado" si nunca arrancó.
  readonly examenTiempoCumplido: Signal<boolean> = computed(() => {
    const closeAt = this.personalCloseAt();
    if (closeAt === null) return false;
    return this.nowTick().getTime() >= closeAt.getTime();
  });

  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private autoEnvioHandle: AutoEnvioHandle | null = null;
  // Auto-envio en modo tarea usa setTimeout local en vez de
  // programarAutoEnvio.execute — el cierre efectivo es
  // min(myStartedAt + duration, openUntil), no exam.effectiveCloseAt().
  private tareaAutoEnvioTimer: ReturnType<typeof setTimeout> | null = null;
  private editingTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private stopped = false;
  // sessionId activo: se setea en start() cuando el examen existe. Necesario
  // para que stop() y submit() puedan cancelar el dispatcher sin tener que
  // leer exam() (que puede ser null en edge cases de lifecycle).
  private sessionId = '';

  // Modo "tarea": momento en que el alumno abrió la tarea localmente.
  // Se persiste en localStorage con clave `homework:<sessionId>` para que si
  // el alumno cierra y reabre Fiovi, el countdown de 10 min continúe donde
  // estaba. Signal null hasta que start() lo hidrate o cree.
  readonly myStartedAt = signal<Date | null>(null);
  private static readonly HOMEWORK_START_KEY_PREFIX = 'homework:';

  constructor() {
    // Observa la signal closedSessions del dispatcher. Si el back devuelve
    // 409 SESSION_NOT_ACTIVE en un POST /draft mientras el alumno está en la
    // cartilla, el dispatcher emite el sessionId a esta signal y el effect
    // lo detecta para disparar el flujo "cerrado" + redirect a /home.
    // Design.md D3 + spec "409 escala al view-model".
    effect(() => {
      const closed = this.draftDispatcher.closedSessions();
      if (this.sessionId.length > 0 && closed.includes(this.sessionId)) {
        this.errorState.set('cerrado');
        void this.router.navigate(['/home']);
      }
    });
  }

  async start(examId: string): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.stopped = false;

    const trimmedId = examId.trim();
    if (trimmedId.length === 0) {
      this.errorState.set('not-found');
      void this.router.navigate(['/home']);
      return;
    }

    this.isLoading.set(true);
    let lista: readonly Exam[];
    try {
      lista = await this.getTodaysExams.execute();
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        this.errorState.set('session-expired');
        void this.router.navigate(['/login']);
        return;
      } else if (err instanceof NetworkError) {
        this.errorState.set('network');
        void this.router.navigate(['/home']);
        return;
      } else {
        this.errorState.set('unknown');
        void this.router.navigate(['/home']);
        throw err;
      }
    } finally {
      this.isLoading.set(false);
    }

    const encontrado = lista.find((e) => e.id === trimmedId);
    if (encontrado === undefined) {
      this.errorState.set('not-found');
      void this.router.navigate(['/home']);
      return;
    }

    if (!encontrado.serverStatus.permiteEntrada()) {
      // Mapea status servidor → razón de redirect. `scheduled` → 'pendiente';
      // `finalized` → 'cerrado'. La traducción a copy concreta vive en /home.
      const status = encontrado.serverStatus.value;
      const reason: SimulacroErrorState =
        status === 'scheduled' ? 'pendiente' : status === 'finalized' ? 'cerrado' : 'unknown';
      this.errorState.set(reason);
      void this.router.navigate(['/home']);
      return;
    }

    // `in_progress` con `started` en el futuro NO bloquea entrada: el
    // alumno entra pero ve el banner `examenNoIniciado` y la grilla
    // queda accesible. Las marcaciones se guardan en IDB; el countdown
    // arranca cuando el reloj cliente cruza `started`.

    this.sessionId = encontrado.id;
    this.exam.set(encontrado);
    // Modo "tarea": hidratar / crear el myStartedAt local antes de programar
    // countdown y auto-envio — ambos dependen de él.
    if (encontrado.esTarea()) {
      this.hydrateHomeworkStartedAt(encontrado.id);
    }
    await this.loadMarcaciones(encontrado);
    this.startCountdownTicker();
    this.scheduleAutoEnvio(encontrado);
  }

  /**
   * Modo "tarea": lee `homework:<sessionId>` de localStorage; si no existe,
   * escribe `now` y setea la signal — así el countdown arranca desde el
   * primer momento en que el alumno entra a la tarea. Si el alumno cierra
   * Fiovi y reabre, el valor persistido continúa el countdown donde estaba.
   *
   * Falla silenciosa contra localStorage indisponible (SSR, safari private,
   * quota exceeded) — el signal queda null y `personalCloseAt` cae al
   * openUntil global. El alumno no queda bloqueado.
   */
  private hydrateHomeworkStartedAt(sessionId: string): void {
    const key = SimulacroPageViewModel.HOMEWORK_START_KEY_PREFIX + sessionId;
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null && raw.trim().length > 0) {
        const d = new Date(raw);
        if (!Number.isNaN(d.getTime())) {
          this.myStartedAt.set(d);
          return;
        }
      }
      // Primera vez: sellar `now` en localStorage + signal.
      const now = this.clock.now();
      localStorage.setItem(key, now.toISOString());
      this.myStartedAt.set(now);
    } catch {
      // localStorage indisponible: queda null; personalCloseAt usará openUntil
      // como fallback (cutoff hard del server). UX degradada pero no rota.
    }
  }

  stop(): void {
    this.stopped = true;
    // Cancela el debounce del dispatcher para prevenir timer leak (design.md R1).
    // Si el alumno navega fuera de /simulacro sin enviar, no queremos que el
    // debounce dispare un POST espurio desde /home.
    this.draftDispatcher.cancelarDraftsPendientes(this.sessionId);
    this.stopCountdownTicker();
    this.cancelAutoEnvio();
    this.cancelTareaAutoEnvio();
    this.cancelEditingTimer();
    this.editingRow.set(null);
  }

  private cancelTareaAutoEnvio(): void {
    if (this.tareaAutoEnvioTimer !== null) {
      clearTimeout(this.tareaAutoEnvioTimer);
      this.tareaAutoEnvioTimer = null;
    }
  }

  // Estado actual de la fila para una pregunta. Reactivo: depende de los
  // signals `marcaciones` y `editingRow`. El template lo invoca para
  // decidir clases CSS y comportamiento.
  rowState(pregunta: number): SimulacroRowState {
    if (this.editingRow() === pregunta) return 'editing';
    const marca = this.marcaciones()[String(pregunta)] ?? null;
    return marca === null ? 'unmarked' : 'locked';
  }

  // Entrar a modo edición en una fila. Solo aplica si la fila está `locked`
  // (no tiene sentido en `unmarked` — el primer tap ya cambia, no protege).
  // Cierra cualquier edición previa (solo una fila a la vez), arma el
  // timeout de auto-bloqueo, y dispara un pulso háptico si el navegador lo
  // soporta. Sin efecto si el componente ya se destruyó.
  enterEditing(pregunta: number): void {
    if (this.stopped) return;
    if (this.rowState(pregunta) !== 'locked') return;

    this.cancelEditingTimer();
    this.editingRow.set(pregunta);
    this.tryHapticPulse();

    this.editingTimer = setTimeout(() => {
      this.editingTimer = null;
      if (this.editingRow() === pregunta) {
        this.editingRow.set(null);
      }
    }, EDITING_AUTO_LOCK_MS);
  }

  // Salir de modo edición sin aplicar cambios. Llamada desde el page al
  // detectar scroll/cancel del gesto, o internamente desde `marcar` tras
  // aplicar el cambio.
  exitEditing(): void {
    this.cancelEditingTimer();
    this.editingRow.set(null);
  }

  // Aplica una marca/desmarca/cambio en una pregunta SI la fila lo permite:
  //
  //   - `unmarked`: marca con la letra recibida → la fila pasa a `locked`.
  //   - `editing`:  toggle con la letra (si coincide con la actual desmarca,
  //                 si difiere cambia) → la fila vuelve a `locked` o
  //                 `unmarked` según el resultado, cancelando el timeout.
  //   - `locked`:   NO aplica el cambio. La ausencia de cambio visual ES el
  //                 feedback: el alumno descubre el long-press por uso real,
  //                 y cuando lo activa ve el chip "Toca para cambiar" sobre
  //                 la fila editing (template responde a `rowState() ===
  //                 'editing'`). No hay toast inicial ni hint inline.
  //
  // Esta es la única puerta para mutaciones de marcaciones desde la UI —
  // así el invariante de "no se cambia sin gesto deliberado" no depende de
  // disciplina del template.
  async marcar(pregunta: number, letra: AlternativaValue): Promise<void> {
    if (this.stopped) return;
    // Bloqueo de marcación cuando el examen no es vigente (no iniciado o
    // tiempo cumplido). Las marcas previas se mantienen visibles en IDB,
    // pero ningún click cambia el estado. Espejo de [class.grilla--disabled]
    // en el template.
    if (!this.vigente()) return;
    const e = this.exam();
    if (e === null) return;

    const state = this.rowState(pregunta);
    if (state === 'locked') {
      return;
    }

    const actual = this.marcaciones()[String(pregunta)] ?? null;
    const proxima: AlternativaValue = actual === letra ? null : letra;

    // Persistencia fallida no debería ocurrir en condiciones normales (la
    // home ya hizo el precheck de IndexedDB). Si fallara, dejamos que el
    // error propague para no silenciar bugs y la UI queda consistente con
    // el storage (no actualizamos el signal porque la línea siguiente no
    // se ejecuta).
    await this.marcarRespuesta.execute({
      examId: e.id,
      pregunta,
      alternativa: Alternativa.fromString(proxima),
    });

    this.marcaciones.update((prev) => ({ ...prev, [String(pregunta)]: proxima }));
    // Notificar al dispatcher que hay cambios para auto-save. Se llama DESPUÉS
    // de la escritura exitosa en IDB — el dispatcher leerá el snapshot de IDB
    // cuando el debounce expire. Si el flag está apagado, el Noop absorbe la
    // llamada silenciosamente.
    // `e.count` se pasa al dispatcher para que el use case L2 arme el string
    // compacto de longitud fija (design.md D12). Es estable durante la sesión;
    // el dispatcher lo cachea idempotentemente.
    this.draftDispatcher.notificarCambio(this.sessionId, e.count);
    // Volver a `locked` (o `unmarked` derivado por rowState) cancelando el
    // timer de edición si estábamos en `editing`. Si veníamos de `unmarked`
    // estas llamadas son no-op pero seguras.
    this.exitEditing();
  }

  // DEV-ONLY: sobreescribe todas las marcaciones con una elección aleatoria
  // en {A, B, C, D, E, vacío} uniforme (1/6 c/u). Salta el guard `locked` de
  // `marcar()` a propósito — la protección contra cambios accidentales no
  // aplica a una acción explícita del desarrollador. La UI solo expone el
  // botón cuando `environment.devTools` (flag `DEV_TOOLS` en `.env`) es true.
  async marcarAleatorio(): Promise<void> {
    if (this.stopped) return;
    const e = this.exam();
    if (e === null) return;
    if (!this.vigente()) return;

    const opciones: readonly AlternativaValue[] = ['A', 'B', 'C', 'D', 'E', null];
    const nuevoMap: AnswersMap = {};

    for (const pregunta of this.preguntas()) {
      const proxima = opciones[Math.floor(Math.random() * opciones.length)] ?? null;
      await this.marcarRespuesta.execute({
        examId: e.id,
        pregunta,
        alternativa: Alternativa.fromString(proxima),
      });
      nuevoMap[String(pregunta)] = proxima;
    }

    this.marcaciones.set(nuevoMap);
    this.draftDispatcher.notificarCambio(this.sessionId, e.count);
    this.exitEditing();
  }

  // Persiste el área de POSTULACIÓN elegida por el alumno en el picker,
  // actualiza el signal y notifica al dispatcher — mismo hook que post-
  // `marcarRespuesta` (design.md D7 de add-admission-area). El use case
  // revalida el input contra el set cerrado; si el picker emite algo
  // inválido, propaga InvalidAdmissionAreaError.
  async seleccionarArea(area: AdmissionArea): Promise<void> {
    if (this.stopped) return;
    const e = this.exam();
    if (e === null) return;
    await this.seleccionarAdmissionArea.execute({ examId: e.id, area });
    this.admissionArea.set(area);
    this.draftDispatcher.notificarCambio(this.sessionId, e.count);
  }

  volver(): void {
    void this.router.navigate(['/home']);
  }

  // Envío manual disparado por el botón "Enviar". Idempotente frente a
  // doble click (si ya hay un POST en vuelo no relanza). Cancela primero
  // el auto-envío para que el manual gane: nunca queremos que el timer
  // dispare un segundo POST mientras el alumno ya está enviando.
  //
  // Si el use case retorna `status === 'queued'` significa que el POST
  // falló por NetworkError; el use case ya encoló el envío. La página NO
  // navega — el alumno se queda viendo el banner naranja. El dispatcher
  // global (EnvioRetryDispatcher) hace el retry cuando vuelve la red; el
  // alumno puede tocar "Volver" cuando quiera, el envío ya está en cola.
  async submit(): Promise<void> {
    if (this.isSubmitting()) return;
    const e = this.exam();
    if (e === null) return;
    if (!e.serverStatus.permiteEntrada()) return;

    // Cancel-on-submit: limpiar el debounce pendiente y marcar la sesión como
    // stopped ANTES de cualquier rama del submit. El POST en vuelo (si lo hay)
    // completará en el back, que hará no-op silent si el submit ya escribió
    // `final` en Redis. Design.md D3 cancel-on-submit + spec Requirement.
    this.draftDispatcher.cancelarDraftsPendientes(this.sessionId);
    this.cancelAutoEnvio();
    this.cancelTareaAutoEnvio();
    this.isSubmitting.set(true);
    this.submissionState.set('sending');

    try {
      // Router por modo: tarea usa el nuevo endpoint /submit-homework
      // (INSERT sincrono directo, sin queue).
      const result = e.esTarea()
        ? await this.enviarTarea.execute({ examId: e.id })
        : await this.enviarSimulacro.execute({ examId: e.id });
      if (result.status === 'enviado') {
        this.submissionState.set('sent');
        if (result.ack !== null) {
          // Muestra el modal de comprobante; la navegación a /home queda
          // diferida hasta que el alumno toque "Volver al inicio".
          this.lastAck.set(result.ack);
        } else {
          // Defensa: el use case promete ack en path síncrono enviado, pero
          // si por alguna razón llega null no nos quedamos congelados.
          void this.router.navigate(['/home']);
        }
      } else {
        this.submissionState.set('queued');
      }
    } catch (err) {
      this.handleSubmissionError(err);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  // Dismiss del modal de comprobante. Limpia el ack del view-model y navega
  // a /home — el flujo "envío exitoso" se completa visualmente cuando el
  // alumno ve la card "Enviado · HH:MM · Pendiente de calificación".
  onReceiptClose(): void {
    this.lastAck.set(null);
    void this.router.navigate(['/home']);
  }

  // Programa el auto-envío en el momento de cierre del examen. Los callbacks
  // viven en el view-model para que cuando el timer dispare la UI reaccione
  // en signals locales — el use case no conoce ni el Router ni el estado.
  //
  // Edge case: si el alumno ya inició un envío manual (`isSubmitting=true`)
  // cuando el timer dispara, el manual ya canceló este handle en `submit()`,
  // así que el callback NO debería correr. Lo defensivo aquí es no relanzar
  // estado de envío encima si ya hay uno en vuelo.
  private scheduleAutoEnvio(exam: Exam): void {
    this.cancelAutoEnvio();
    this.cancelTareaAutoEnvio();

    // Modo "tarea": el cierre efectivo es personal (min de myStartedAt + duration
    // y openUntil). Programamos un setTimeout local que dispara `submit()` — que
    // ya elige el use case correcto (enviarTarea) por el `esTarea()` guard.
    // El anti-thundering-herd no aplica: en tarea los alumnos entran dispersos
    // en el tiempo, no hay pico de submits simultáneos.
    if (exam.esTarea()) {
      const closeAt = this.personalCloseAt();
      if (closeAt === null) return;
      const delay = Math.max(0, closeAt.getTime() - this.clock.now().getTime());
      this.tareaAutoEnvioTimer = setTimeout(() => {
        this.tareaAutoEnvioTimer = null;
        if (this.stopped) return;
        if (this.isSubmitting()) return;
        // submit() se encarga del router por modo, del stateo de submissionState,
        // del cancel del draft dispatcher, etc.
        void this.submit();
      }, delay);
      return;
    }

    // Modo "examen": comportamiento heredado — timer + jitter + call directo
    // a EnviarSimulacroUseCase con clientFinishedAtOverride para lock exact.
    this.autoEnvioHandle = this.programarAutoEnvio.execute({
      exam,
      onResult: (result) => {
        // El timer ya disparó: el handle representa un cancelable agotado.
        // Lo soltamos para que `maybeRedirectIfExpired` no quede bloqueado
        // indefinidamente si el auto-envío terminó en `enviado` y vuelve
        // alguna corrida del ticker antes de `stop()`.
        this.autoEnvioHandle = null;
        if (this.isSubmitting()) return;
        if (this.stopped) return;
        if (result.status === 'enviado') {
          this.submissionState.set('sent');
          if (result.ack !== null) {
            this.lastAck.set(result.ack);
          } else {
            void this.router.navigate(['/home']);
          }
        } else {
          this.submissionState.set('queued');
        }
      },
      onError: (err) => {
        this.autoEnvioHandle = null;
        if (this.isSubmitting()) return;
        if (this.stopped) return;
        this.handleSubmissionError(err);
      },
    });
  }

  private cancelAutoEnvio(): void {
    if (this.autoEnvioHandle !== null) {
      this.autoEnvioHandle.cancel();
      this.autoEnvioHandle = null;
    }
  }

  private cancelEditingTimer(): void {
    if (this.editingTimer !== null) {
      clearTimeout(this.editingTimer);
      this.editingTimer = null;
    }
  }

  // Pulso háptico opcional al entrar a modo edición. `navigator.vibrate`
  // existe en Chrome Android y Firefox; en iOS Safari devuelve undefined o
  // ignora la llamada. Encapsulado con guard para no romper el view-model
  // en entornos de test (jsdom) o navegadores sin la API.
  private tryHapticPulse(): void {
    if (typeof navigator === 'undefined') return;
    const vibrate = (navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean })
      .vibrate;
    if (typeof vibrate !== 'function') return;
    try {
      // Pasamos [40] (array) en vez de 40 (number) porque la definición de
      // tipos en lib.dom.d.ts de Angular 22 espera Iterable<number>.
      // Funcionalmente equivalente: un pulso único de 40ms.
      vibrate.call(navigator, [40]);
    } catch {
      // Algunos navegadores tiran si la pestaña no está visible o si el
      // usuario no interactuó aún. No nos importa — el feedback háptico
      // es nice-to-have, no funcional.
    }
  }

  // Mapea errores del envío a errorState + redirect. NetworkError no debería
  // llegar acá: EnviarSimulacroUseCase lo captura y devuelve `status: queued`.
  // Aun así lo dejamos por defensa: si llegara, lo tratamos como red caída.
  private handleSubmissionError(err: unknown): void {
    this.submissionState.set('error');
    if (err instanceof SimulacroCerradoError) {
      // El back rechazó el envío porque el examen ya cerró. Aprovechamos que
      // ya sabemos que hay potencialmente una fila del alumno en BD
      // (promovida por el finalize del tutor) y la pre-cargamos en IDB para
      // que /student/historial la vea sin round-trip adicional. Best-effort:
      // si el fetch falla, el historial la resolverá igual en su próxima
      // carga.
      const examId = this.exam()?.id;
      if (examId) {
        void this.getMySubmission.execute(examId).catch(() => {
          // Silencioso — el historial reintenta cuando se abra.
        });
      }
      this.errorState.set('cerrado');
      void this.router.navigate(['/home']);
      return;
    }
    if (err instanceof SimulacroNoAsignadoError) {
      this.errorState.set('not-found');
      void this.router.navigate(['/home']);
      return;
    }
    if (err instanceof InvalidSubmissionTimeError) {
      this.errorState.set('invalid-submission-time');
      void this.router.navigate(['/home']);
      return;
    }
    if (err instanceof InvalidPayloadError) {
      this.errorState.set('invalid-payload');
      void this.router.navigate(['/home']);
      return;
    }
    if (err instanceof SessionExpiredError) {
      this.errorState.set('session-expired');
      void this.router.navigate(['/login']);
      return;
    }
    if (err instanceof NetworkError) {
      this.errorState.set('network');
      void this.router.navigate(['/home']);
      return;
    }
    this.errorState.set('unknown');
    void this.router.navigate(['/home']);
    throw err;
  }

  private async loadMarcaciones(e: Exam): Promise<void> {
    const stored = await this.markings.getMarcaciones(e.id);
    // Inicializamos el map con todas las preguntas presentes (null por
    // defecto) y sobreescribimos con lo que vino del storage. El template
    // así puede leer marcaciones()[String(p)] sin chequeos extra de undefined.
    const fullMap: AnswersMap = {};
    for (let i = 1; i <= e.count; i++) {
      fullMap[String(i)] = stored[String(i)] ?? null;
    }
    this.marcaciones.set(fullMap);

    // Hidratar admissionArea desde storage. `null` = el alumno nunca eligió
    // expresamente para este examen → caemos al default (GENERAL). No
    // persistimos el default en storage para mantener distinguibles "eligió
    // GENERAL" vs "todavía no eligió nada" (design.md D3 de add-admission-area).
    const persistedArea = await this.markings.getAdmissionArea(e.id);
    this.admissionArea.set(persistedArea ?? DEFAULT_ADMISSION_AREA);
  }

  // El ticker solo refresca `nowTick` para que los signals derivados
  // (countdownRestante, examenTiempoCumplido) recomputen. NO redirige por
  // reloj local: el cierre real lo confirma el server en el próximo
  // polling de /home. Si el alumno está offline cuando se cumple el
  // tiempo, sigue dentro de la cartilla con el banner "tiempo agotado"
  // y el botón Enviar deshabilitado.
  private startCountdownTicker(): void {
    if (this.countdownTimer !== null) return;
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
}

function formatHHMM(d: Date): string {
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

// Formato adaptativo:
//   ≥ 5 min   → "X min restantes"
//   < 5 min   → "MM:SS"
//   ≤ 0       → "00:00"
// Con tabular-nums en el template el "MM:SS" no salta horizontalmente al
// caer cada segundo.
function formatRestante(ms: number): string {
  if (ms <= 0) return '00:00';
  if (ms >= SHOW_SECONDS_BELOW_MS) {
    const mins = Math.ceil(ms / 60_000);
    return `${mins} min restantes`;
  }
  const totalSeconds = Math.ceil(ms / 1_000);
  const mm = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const ss = (totalSeconds % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}
