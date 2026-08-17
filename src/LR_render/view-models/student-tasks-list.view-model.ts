import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { GetTodaysExamsUseCase } from '../../L2_application/use-cases/get-todays-exams.use-case';
import { CLOCK, MARKINGS_STORAGE } from '../../app.config';
import { Exam } from '../../L1_domain/entities/exam';
import { SubmissionAck } from '../../L1_domain/value-objects/submission-ack';
import { NetworkError } from '../../L1_domain/errors/network.error';
import { SessionExpiredError } from '../../L1_domain/errors/session-expired.error';
import { ExamsPermissionRevokedError } from '../../L1_domain/errors/exams-permission-revoked.error';
import { StudentNotLinkedError } from '../../L1_domain/errors/student-not-linked.error';
import { formatRestanteTarea } from '../utils/countdown-format';
import { LogoutUseCase } from '../../L2_application/use-cases/logout.use-case';

// Estados visuales de una card de tarea. Mismos que `home.view-model.ts` para
// que la lógica de composición viaje idéntica — solo cambia el countdown
// (humano en días/horas en vez de minutos crudos).
// `programada`: el examen está in_progress en el server pero el `started` cae
// en el futuro → el alumno no puede entrar aún, ve countdown/fecha de apertura.
export type TareaEstado = 'pendiente' | 'abierto' | 'enviado' | 'cerrado' | 'programada';

// Umbral para mostrar el countdown en formato "Faltan Xh Ym":
// si la apertura está a menos de 24h, el countdown es visible.
// Si es mayor o igual a 24h, solo se muestra la fecha (sin countdown).
const SCHEDULED_COUNTDOWN_THRESHOLD_MS = 24 * 60 * 60 * 1_000;

export type ServerErrorKind = 'network' | 'session-expired' | 'unknown';

// Tick del countdown más lento que el home (30s) — las tareas se miden en
// horas/días, no en segundos. Refrescar cada segundo sería desperdicio.
const COUNTDOWN_TICK_MS = 30_000;

// View-model de `/student/tareas`. Provider-local para que cada montaje
// arranque limpio sus timers.
@Injectable()
export class StudentTasksListViewModel {
  private readonly getTodaysExams = inject(GetTodaysExamsUseCase);
  private readonly logoutUseCase = inject(LogoutUseCase);
  private readonly clock = inject(CLOCK);
  private readonly markings = inject(MARKINGS_STORAGE);
  private readonly router = inject(Router);

  readonly exams = signal<readonly Exam[]>([]);
  private readonly ackByExamId = signal<ReadonlyMap<string, SubmissionAck | null>>(new Map());
  readonly isLoading = signal(false);
  readonly serverError = signal<ServerErrorKind | null>(null);
  readonly studentNotLinked = signal(false);
  readonly nowTick = signal<Date>(this.clock.now());

  // Cards de tareas ordenadas por deadline más próximo primero. `openUntil` es
  // garantizado no-null en tareas (esTarea() lo verifica), así que el sort no
  // necesita fallback.
  readonly cards = computed<TareaCard[]>(() => {
    const acks = this.ackByExamId();
    const now = this.nowTick();
    return this.exams()
      .filter((exam) => exam.esTarea())
      .slice()
      .sort((a, b) => (a.openUntil?.getTime() ?? 0) - (b.openUntil?.getTime() ?? 0))
      .map((exam) => this.buildCard(exam, acks.get(exam.id) ?? null, now));
  });

  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor() {
    effect(() => {
      // Consume nowTick para forzar recomputo del countdown.
      this.nowTick();
    });
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.refresh();
    this.startCountdownTicker();
  }

  stop(): void {
    this.stopped = true;
    this.stopCountdownTicker();
  }

  async refresh(): Promise<void> {
    if (this.stopped) return;
    this.isLoading.set(true);
    try {
      const list = await this.getTodaysExams.execute();
      this.exams.set(list);
      await this.refreshAcks(list);
      this.studentNotLinked.set(false);
      this.serverError.set(null);
    } catch (err) {
      if (err instanceof ExamsPermissionRevokedError) {
        this.exams.set([]);
        this.ackByExamId.set(new Map());
        void this.logoutUseCase.execute();
      } else if (err instanceof StudentNotLinkedError) {
        this.exams.set([]);
        this.ackByExamId.set(new Map());
        this.studentNotLinked.set(true);
        this.serverError.set(null);
      } else if (err instanceof SessionExpiredError) {
        this.serverError.set('session-expired');
        void this.router.navigate(['/login']);
      } else if (err instanceof NetworkError) {
        this.serverError.set('network');
      } else {
        this.serverError.set('unknown');
        throw err;
      }
    } finally {
      this.isLoading.set(false);
    }
  }

  private async refreshAcks(list: readonly Exam[]): Promise<void> {
    const next = new Map<string, SubmissionAck | null>();
    for (const exam of list) {
      try {
        next.set(exam.id, await this.markings.getSubmissionAck(exam.id));
      } catch {
        next.set(exam.id, null);
      }
    }
    this.ackByExamId.set(next);
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

  private buildCard(exam: Exam, ack: SubmissionAck | null, now: Date): TareaCard {
    const estado = this.composeEstado(exam, ack, now);
    // Solo la card en estado 'abierto' permite navegación al simulacro.
    const clickable = estado === 'abierto';
    const closeAt = exam.openUntil;
    const remainingMs = closeAt !== null ? Math.max(0, closeAt.getTime() - now.getTime()) : 0;

    // Datos de apertura programada (solo aplica cuando estado === 'programada').
    let opensAt: Date | null = null;
    let opensInText: string | null = null;
    if (estado === 'programada' && exam.started !== null) {
      opensAt = exam.started;
      const diffMs = exam.started.getTime() - now.getTime();
      if (diffMs > 0 && diffMs < SCHEDULED_COUNTDOWN_THRESHOLD_MS) {
        opensInText = formatOpensIn(diffMs);
      }
    }

    return {
      id: exam.id,
      name: exam.name,
      course: exam.course,
      count: exam.count,
      estado,
      clickable,
      closeAt,
      countdownText: closeAt !== null ? formatRestanteTarea(remainingMs) : '',
      opensAt,
      opensInText,
    };
  }

  // Mismo criterio de composición que `home.view-model.ts` — la puerta es
  // `serverStatus`, el ack define enviado.
  // `programada`: in_progress pero el `started` del examen cae en el futuro.
  // La auto-transición programada → abierto la dispara el ticker de 30s
  // al recomputar cards — no se necesita lógica adicional.
  private composeEstado(exam: Exam, ack: SubmissionAck | null, now: Date): TareaEstado {
    switch (exam.serverStatus.value) {
      case 'scheduled':
        return 'pendiente';
      case 'in_progress':
        if (ack !== null) return 'enviado';
        // REQ-PA-02: started en el futuro → estado 'programada'.
        if (exam.started !== null && now.getTime() < exam.started.getTime()) {
          return 'programada';
        }
        return 'abierto';
      case 'finalized':
        if (ack !== null) return 'enviado';
        return 'cerrado';
    }
  }
}

// Formatea la diferencia en ms como "Faltan Xh Ym" para el countdown de apertura.
// Solo se llama cuando diffMs < 24h (el caller garantiza el threshold).
function formatOpensIn(diffMs: number): string {
  const totalMinutes = Math.ceil(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `Faltan ${hours}h ${minutes}min`;
}

export interface TareaCard {
  id: string;
  name: string;
  course: string | null;
  count: number;
  estado: TareaEstado;
  clickable: boolean;
  closeAt: Date | null;
  countdownText: string;
  // Fecha de apertura programada. Solo no-null cuando estado === 'programada'.
  opensAt: Date | null;
  // Texto de countdown "Faltan Xh Ym" cuando la apertura está a < 24h.
  // null cuando la apertura está a >= 24h o cuando estado !== 'programada'.
  opensInText: string | null;
}
