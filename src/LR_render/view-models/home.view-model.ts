import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { GetIdentityUseCase } from '../../L2_application/use-cases/get-identity.use-case';
import { GetProfileUseCase } from '../../L2_application/use-cases/get-profile.use-case';
import { GetTodaysExamsUseCase } from '../../L2_application/use-cases/get-todays-exams.use-case';
import { LogoutUseCase } from '../../L2_application/use-cases/logout.use-case';
import { CLOCK, MARKINGS_STORAGE } from '../../app.config';
import { Exam } from '../../L1_domain/entities/exam';
import { StudentProfile } from '../../L1_domain/value-objects/student-profile';
import { SubmissionAck } from '../../L1_domain/value-objects/submission-ack';
import { NetworkError } from '../../L1_domain/errors/network.error';
import { SessionExpiredError } from '../../L1_domain/errors/session-expired.error';
import { ProfileNotAvailableError } from '../../L1_domain/errors/profile-not-available.error';
import { OfflineStorageUnavailableError } from '../../L1_domain/errors/offline-storage-unavailable.error';
import { ExamsPermissionRevokedError } from '../../L1_domain/errors/exams-permission-revoked.error';
import { StudentNotLinkedError } from '../../L1_domain/errors/student-not-linked.error';
import { randomQuote } from '../pages/home/inspirational-quotes';
import { randomGreeting } from '../pages/home/greetings';

export type ServerErrorKind = 'network' | 'session-expired' | 'unknown';

// Estado visual de cada card en /home. Compuesto en el view-model a partir
// de `exam.serverStatus` + `MarkingsStorage.getSubmissionAck(exam.id)`. Las
// claves se mantienen en español porque el template las usa como sufijo de
// clase CSS (`card--abierto`, `card--cerrado`, etc.).
export type CardEstado = 'pendiente' | 'abierto' | 'enviado' | 'cerrado';

// Cada 120s mientras la pestaña está visible: refresca la lista contra backend.
const POLL_INTERVAL_MS = 120_000;

// El countdown re-renderiza cada segundo. Lo separamos del polling porque son
// dos relojes con razones distintas: este es solo cosmético (texto del countdown),
// el otro recoge cambios de estado del backend.
const COUNTDOWN_TICK_MS = 1_000;

// Un único refresh diferido tras cruzar el cierre local de una card
// `in_progress`. El back tiene grace de 5s post-cierre + margen de cola de
// auto-finalize; a los ~10s el estado real ya suele ser `finalized`. Si no,
// el poll normal de 120s lo recupera. Evitamos ráfagas para no cargar el back
// cuando 500 alumnos convergen al mismo instante.
const POST_CIERRE_REFRESH_MS = 10_000;

// Jitter simétrico (±3s) para dispersar el refresh entre alumnos que terminen
// el mismo examen al mismo segundo. Sin jitter, 500 clientes pegan al back en
// el mismo ms (thundering herd).
const POST_CIERRE_JITTER_MS = 3_000;

// View-model de /home. Provider-local al HomePage (no providedIn root) para que
// cada montaje arranque limpio sus timers y listeners.
@Injectable()
export class HomePageViewModel {
  private readonly getIdentity = inject(GetIdentityUseCase);
  private readonly getProfile = inject(GetProfileUseCase);
  private readonly getTodaysExams = inject(GetTodaysExamsUseCase);
  private readonly logoutUseCase = inject(LogoutUseCase);
  private readonly clock = inject(CLOCK);
  private readonly markings = inject(MARKINGS_STORAGE);
  private readonly router = inject(Router);

  readonly exams = signal<readonly Exam[]>([]);
  // Map examId → SubmissionAck (null cuando no hay envío persistido). Se
  // completa en cada refresh consultando `getSubmissionAck` del puerto
  // MarkingsStorage. La presencia del ack es la señal de "yo envié este
  // examen" y alimenta el card-state `enviado` independientemente del
  // serverStatus.
  private readonly ackByExamId = signal<ReadonlyMap<string, SubmissionAck | null>>(new Map());
  readonly isLoading = signal(false);
  readonly serverError = signal<ServerErrorKind | null>(null);
  readonly offlineStorageBlocked = signal(false);
  readonly studentNotLinked = signal(false);
  readonly lastRefreshAt = signal<Date | null>(null);

  // Header del home alumno. `userEmail` viene de la identity (siempre presente
  // bajo authGuard + roleGuard('student')). `userName` (`firstName + lastName`)
  // y `userDni` (`profile.code`) vienen del `GetProfileUseCase` que fetchea
  // `/student/me` en paralelo. Mientras la promesa está en vuelo, ambos son
  // null y el template muestra skeleton. Si el back devuelve 403/404
  // (`ProfileNotAvailableError`), `profileUnavailable` se prende y la UI
  // muestra degraded state con solo email.
  readonly userEmail = signal<string | null>(null);
  readonly userName = signal<string | null>(null);
  readonly userDni = signal<string | null>(null);
  readonly profileLoading = signal(false);
  readonly profileUnavailable = signal(false);

  // Cita ambient de splash-Minecraft / epígrafe: una frase fija por mount.
  // No rota durante el polling de 120 s — distraería. Si el alumno recarga
  // la página, vuelve randomQuote() a sortear.
  readonly quote = signal(randomQuote());
  // Saludo aleatorio (Hola / Bienvenido / Buen día / ...) que precede al
  // nombre. Mismo mecanismo que `quote`: fijo por mount, resortea al
  // recargar. Sin coma entre saludo y nombre (ver `greetings.ts`).
  readonly greeting = signal(randomGreeting());
  // nowTick re-emite cada segundo desde el puerto Clock (server-anchored) para
  // que los countdowns derivados rerendericen sin que el template tenga lógica
  // de tiempo. NUNCA leer Date.now() directo desde la UI.
  readonly nowTick = signal<Date>(this.clock.now());

  // Cards derivadas: estado, copy y countdown. Recomputa cuando cambia la lista
  // o cada tick del reloj.
  //
  // Se separan las tareas de los exámenes: el home muestra SOLO exámenes en la
  // lista principal (el countdown en minutos crudos no tiene sentido para una
  // tarea de 3 días), y las tareas viven en la página dedicada `/student/tareas`
  // accesible via el CTA `tareasPendientesCount`. Ver ADR en README de la página.
  readonly cards = computed(() => {
    const acks = this.ackByExamId();
    const now = this.nowTick();
    return this.exams()
      .filter((exam) => !exam.esTarea())
      .map((exam) => this.buildCard(exam, acks.get(exam.id) ?? null, now));
  });

  // Contador para el CTA del home: solo tareas donde el alumno tiene algo por
  // hacer (`abierto`). Las enviadas / cerradas siguen apareciendo en la página
  // dedicada pero no inflan el badge del CTA — el número debe reflejar acción
  // pendiente, no historia.
  readonly tareasPendientesCount = computed<number>(() => {
    const acks = this.ackByExamId();
    return this.exams().filter((exam) => {
      if (!exam.esTarea()) return false;
      const estado = this.composeEstado(exam, acks.get(exam.id) ?? null);
      return estado === 'abierto';
    }).length;
  });

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private visibilityListener: (() => void) | null = null;
  private started = false;
  private stopped = false;

  // Guard 1-vez por examId: cada card dispara su refresh diferido a lo sumo
  // una vez por montaje del home. Si el alumno navega a /simulacro y vuelve,
  // el VM se re-instancia y el Set arranca limpio.
  private readonly postCierreRefreshDone = new Set<string>();
  // Timers activos por examId, para poder cancelarlos en `stop()`.
  private readonly postCierreTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor() {
    // Detector post-cierre: cuando el countdown local cruza `effectiveCloseAt`
    // en una card `in_progress`, agenda un refresh puntual para captar el
    // `finalized` que el back dispara ~5s post-cierre via auto-finalize.
    // Guard por examId: dispara a lo sumo una vez por card.
    effect(() => {
      const now = this.nowTick();
      if (this.stopped) return;
      for (const exam of this.exams()) {
        if (!exam.serverStatus.is('in_progress')) continue;
        const closeAt = exam.effectiveCloseAt();
        if (closeAt === null) continue;
        if (now.getTime() < closeAt.getTime()) continue;
        if (this.postCierreRefreshDone.has(exam.id)) continue;

        this.postCierreRefreshDone.add(exam.id);
        this.schedulePostCierreRefresh(exam.id);
      }
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.stopped = false;

    // Profile en paralelo (no bloquea precheck ni refresh). Cuando resuelve,
    // los signals userEmail/userName/userDni re-emiten y el template re-renderea
    // reactivamente — el header puede mostrar el saludo sin haber esperado a la
    // lista de exámenes. Mantiene la misma semántica que el `void loadEmail()`
    // que hacía el page component pre-C4.
    void this.loadUserProfile();
    await this.runOfflineStoragePrecheck();
    await this.refresh();

    this.startCountdownTicker();
    this.startPollingIfVisible();
    this.attachVisibilityListener();
  }

  stop(): void {
    this.stopped = true;
    this.stopPolling();
    this.stopCountdownTicker();
    this.detachVisibilityListener();
    this.cancelPostCierreRefreshes();
  }

  async refresh(): Promise<void> {
    if (this.stopped) return;
    this.isLoading.set(true);
    try {
      const list = await this.getTodaysExams.execute();
      this.handleAbiertosDegradation(list);
      this.exams.set(list);
      await this.refreshAcks(list);
      this.studentNotLinked.set(false);
      this.serverError.set(null);
      this.lastRefreshAt.set(this.clock.now());
    } catch (err) {
      if (err instanceof ExamsPermissionRevokedError) {
        // El back retiró el permiso `student:exams:view`. Limpiamos sesión y
        // mandamos al login; no mostramos banner — el logout flow se encarga
        // de la navegación final.
        this.exams.set([]);
        this.ackByExamId.set(new Map());
        void this.logoutUseCase.execute();
      } else if (err instanceof StudentNotLinkedError) {
        // Usuario sin Student asociado en learnex. Mantenemos el resto del
        // home visible y mostramos el banner dedicado; la lista queda vacía.
        this.exams.set([]);
        this.ackByExamId.set(new Map());
        this.studentNotLinked.set(true);
        this.serverError.set(null);
      } else if (err instanceof SessionExpiredError) {
        this.serverError.set('session-expired');
        // Limpieza completa la hace el interceptor / logout silencioso; aquí
        // solo redirigimos para no quedarnos pintando una lista vieja.
        void this.router.navigate(['/login']);
      } else if (err instanceof NetworkError) {
        this.serverError.set('network');
      } else {
        this.serverError.set('unknown');
        // Bug del programador o error no modelado: re-lanzar para no silenciar.
        throw err;
      }
    } finally {
      this.isLoading.set(false);
    }
  }

  // Lee identity (email instantáneo desde IdentityStorage) y fetchea profile
  // (firstName + lastName + code/DNI desde /student/me con cache 24h).
  // Email se publica de inmediato; nombre y DNI llegan cuando el profile
  // resuelve. Errores benignos (sin identity, sin profile) degradan
  // silenciosamente — el header muestra lo que tiene.
  private async loadUserProfile(): Promise<void> {
    const identity = await this.getIdentity.execute();
    if (!identity) {
      // Estado raro: el authGuard normalmente ya redirigió. Dejamos el
      // header vacío sin lanzar.
      this.userEmail.set(null);
      return;
    }
    this.userEmail.set(identity.email);

    this.profileLoading.set(true);
    try {
      const profile = (await this.getProfile.execute('student')) as StudentProfile;
      this.userName.set(`${profile.firstName} ${profile.lastName}`);
      this.userDni.set(profile.code);
    } catch (err) {
      if (err instanceof ProfileNotAvailableError) {
        // Caso conocido: user con rol student pero sin fila en `students`
        // (seed inconsistente o user nuevo). Degradamos a solo email.
        this.profileUnavailable.set(true);
      } else if (err instanceof NetworkError) {
        // Sin perfil pero sesión OK — no rompemos el home; solo no mostramos
        // nombre/dni. El próximo refresh manual lo intenta de nuevo.
      } else {
        // Bug del programador o error no modelado: re-lanzar.
        throw err;
      }
    } finally {
      this.profileLoading.set(false);
    }
  }

  // Pre-check temprano de IndexedDB. GetTodaysExamsUseCase no toca el storage,
  // pero queremos detectar IDB unavailable ANTES de que el alumno tape en una
  // card abierta y fracase en /simulacro/:id.
  private async runOfflineStoragePrecheck(): Promise<void> {
    try {
      await this.markings.getEnviosPendientes();
      this.offlineStorageBlocked.set(false);
    } catch (err) {
      if (err instanceof OfflineStorageUnavailableError) {
        this.offlineStorageBlocked.set(true);
      } else {
        // Otros errores del storage no son de UI: los dejamos propagar a consola.
        // No bloqueamos la lista ni mostramos banner por algo no clasificado.
        console.error('MarkingsStorage precheck unexpected error', err);
      }
    }
  }

  // Consulta `getSubmissionAck` por cada examen y arma el mapa que alimenta
  // la composición de estado de card. El ack persistido (sha256 + submittedAt)
  // alimenta tanto `composeEstado` ('enviado' cuando hay ack) como
  // `primaryText` ("Enviado · HH:MM" con la hora real del server).
  private async refreshAcks(list: readonly Exam[]): Promise<void> {
    const next = new Map<string, SubmissionAck | null>();
    for (const exam of list) {
      try {
        next.set(exam.id, await this.markings.getSubmissionAck(exam.id));
      } catch {
        // Si el storage falla por examen puntual, asumimos null: el ack
        // local nunca debe bloquear la visibilidad de la lista.
        next.set(exam.id, null);
      }
    }
    this.ackByExamId.set(next);
  }

  private handleAbiertosDegradation(list: readonly Exam[]): void {
    const abiertos = list.filter((e) => e.serverStatus.is('in_progress'));
    if (abiertos.length > 1) {
      console.warn(
        `Backend devolvió ${abiertos.length} exámenes en progreso simultáneos; ` +
          `tratando el primero (${abiertos[0].id}) como activo.`,
      );
    }
  }

  private startCountdownTicker(): void {
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

  private startPollingIfVisible(): void {
    if (this.pollTimer !== null) return;
    if (typeof document === 'undefined') return;
    if (document.visibilityState !== 'visible') return;
    this.pollTimer = setInterval(() => {
      if (this.stopped) return;
      void this.refresh();
    }, POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private attachVisibilityListener(): void {
    if (typeof document === 'undefined') return;
    const handler = (): void => {
      if (this.stopped) return;
      if (document.visibilityState === 'visible') {
        void this.refresh();
        this.startPollingIfVisible();
      } else {
        this.stopPolling();
      }
    };
    document.addEventListener('visibilitychange', handler);
    this.visibilityListener = handler;
  }

  private detachVisibilityListener(): void {
    if (this.visibilityListener !== null && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityListener);
    }
    this.visibilityListener = null;
  }

  /**
   * Programa un refresh diferido de la lista tras cruzar el cierre local de
   * una card. Jitter simétrico dispersa el pico cuando 500 alumnos cruzan
   * el cierre a la misma hora. `Math.random()` alcanza — no es criptografía,
   * solo dispersión estadística.
   */
  private schedulePostCierreRefresh(examId: string): void {
    if (this.stopped) return;
    const jitter = Math.random() * 2 * POST_CIERRE_JITTER_MS - POST_CIERRE_JITTER_MS;
    const delay = POST_CIERRE_REFRESH_MS + jitter;
    const handle = setTimeout(() => {
      this.postCierreTimers.delete(examId);
      if (this.stopped) return;
      void this.refresh();
    }, delay);
    this.postCierreTimers.set(examId, handle);
  }

  private cancelPostCierreRefreshes(): void {
    for (const handle of this.postCierreTimers.values()) {
      clearTimeout(handle);
    }
    this.postCierreTimers.clear();
  }

  private buildCard(exam: Exam, ack: SubmissionAck | null, now: Date): SimulacroCard {
    const estado = this.composeEstado(exam, ack);
    const clickable = estado === 'abierto';
    const tone: CardTone = clickable ? 'verde' : 'gris';

    return {
      id: exam.id,
      name: exam.name,
      count: exam.count,
      estado,
      clickable,
      tone,
      primaryText: this.primaryText(exam, estado, ack, now),
      secondaryText: this.secondaryText(exam, estado),
    };
  }

  // Matriz de composición de estado:
  //
  //   serverStatus      | ack !== null | estado
  //   scheduled         | (any)        | pendiente
  //   in_progress       | false        | abierto
  //   in_progress       | true         | enviado
  //   finalized         | true         | enviado
  //   finalized         | false        | cerrado
  //
  // `serverStatus` es la PUERTA (entrar o no). Un `in_progress` cuyo
  // `started` aún está en el futuro sigue siendo `abierto` — el alumno
  // entra y `simulacro.view-model` muestra alerta "Examen no iniciado"
  // hasta que el reloj cruce `started`. La vigencia real (started/finished)
  // no se mezcla con la puerta.
  private composeEstado(exam: Exam, ack: SubmissionAck | null): CardEstado {
    switch (exam.serverStatus.value) {
      case 'scheduled':
        return 'pendiente';
      case 'in_progress':
        if (ack !== null) return 'enviado';
        return 'abierto';
      case 'finalized':
        if (ack !== null) return 'enviado';
        return 'cerrado';
    }
  }

  private primaryText(
    exam: Exam,
    estado: CardEstado,
    ack: SubmissionAck | null,
    now: Date,
  ): string {
    switch (estado) {
      case 'pendiente':
        // serverStatus === 'scheduled' implica `started === null`: el tutor
        // todavía no apretó "empezar". No mostramos timestamp — `scheduled`
        // es solo el horario de programación del tutor, no algo accionable
        // para el alumno hasta que arranque la sesión.
        return '';
      case 'abierto': {
        const closeDate = exam.effectiveCloseAt();
        // Examen aún no activado por el tutor (started y finished null):
        // no hay cierre determinable. Mostramos vacío para no fingir un
        // countdown — el banner "tomando un café" aparece al entrar.
        if (closeDate === null) return '';
        // Si `started` cae en el futuro (reloj cliente atrasado o `started`
        // configurado a futuro), `closeAt - now` infla el restante por
        // encima de la duración real. Usamos `started` como referencia
        // mínima del countdown: nunca decimos "65 min restantes" para un
        // examen de 5 min cuya ventana aún no abrió. La alerta visual de
        // "no iniciado" se muestra adentro de simulacro.page; acá solo nos
        // aseguramos de que el contador no engañe.
        const anchor = exam.started ?? exam.scheduled;
        const referenceNow = Math.max(now.getTime(), anchor.getTime());
        const restante = msToMinutesCeiling(closeDate.getTime() - referenceNow);
        if (restante <= 0) {
          return `Cierra a las ${formatHHMM(closeDate)} · cerrando…`;
        }
        return `Cierra a las ${formatHHMM(closeDate)} · ${restante} min restantes`;
      }
      case 'enviado': {
        // Hora real del envío según el server (anclada al SHA256 del ack),
        // no aproximación por `effectiveCloseAt`. Si por defensa el ack
        // viene null acá (no debería: `enviado` exige ack !== null), caemos
        // a "Enviado" sin hora.
        if (ack === null) return 'Enviado';
        return `Enviado · ${formatHHMM(ack.submittedAt)}`;
      }
      case 'cerrado':
        return 'No enviaste · cerrado';
    }
  }

  private secondaryText(exam: Exam, estado: CardEstado): string {
    if (estado === 'enviado') return 'Pendiente de calificación';
    const label = exam.course ?? exam.area ?? '—';
    return `${label} · ${exam.count} preguntas`;
  }
}

export type CardTone = 'verde' | 'gris';

export interface SimulacroCard {
  id: string;
  name: string;
  count: number;
  estado: CardEstado;
  clickable: boolean;
  tone: CardTone;
  primaryText: string;
  secondaryText: string;
}

function formatHHMM(d: Date): string {
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

// Redondeamos hacia arriba: si faltan 30s, decimos "1 min restante" — el alumno
// se merece el aviso completo, no que el contador caiga a 0 prematuramente.
function msToMinutesCeiling(ms: number): number {
  if (ms <= 0) return 0;
  return Math.ceil(ms / 60_000);
}
