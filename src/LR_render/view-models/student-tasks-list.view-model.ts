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
export type TareaEstado = 'pendiente' | 'abierto' | 'enviado' | 'cerrado';

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
    const estado = this.composeEstado(exam, ack);
    const clickable = estado === 'abierto';
    const closeAt = exam.openUntil;
    const remainingMs = closeAt !== null ? Math.max(0, closeAt.getTime() - now.getTime()) : 0;

    return {
      id: exam.id,
      name: exam.name,
      course: exam.course,
      count: exam.count,
      estado,
      clickable,
      closeAt,
      countdownText: closeAt !== null ? formatRestanteTarea(remainingMs) : '',
    };
  }

  // Mismo criterio de composición que `home.view-model.ts` — la puerta es
  // `serverStatus`, el ack define enviado.
  private composeEstado(exam: Exam, ack: SubmissionAck | null): TareaEstado {
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
}
