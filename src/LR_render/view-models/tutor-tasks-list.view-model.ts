import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { GetExamsEnCursoUseCase } from '../../L2_application/use-cases/get-exams-en-curso.use-case';
import { ExamEnCurso } from '../../L1_domain/entities/exam-en-curso';
import { NetworkError } from '../../L1_domain/errors/network.error';
import { CLOCK } from '../../app.config';
import { formatRestanteTarea } from '../utils/countdown-format';

// Tick del countdown lento — las tareas del tutor se miden en horas/días.
const COUNTDOWN_TICK_MS = 30_000;

// View-model de `/tutor/tareas`. Consume el mismo endpoint
// `/tutor/exams/en-curso` que el home (mismos items) y filtra las tareas
// (openUntil !== null). Provider-local para arranque limpio por montaje.
@Injectable()
export class TutorTasksListViewModel {
  private readonly getExamsEnCurso = inject(GetExamsEnCursoUseCase);
  private readonly clock = inject(CLOCK);

  readonly items = signal<readonly ExamEnCurso[]>([]);
  readonly loading = signal(true);
  readonly error = signal(false);
  readonly nowTick = signal<Date>(this.clock.now());

  // Tareas ordenadas por deadline más próximo primero. Segundo criterio:
  // classroomName (para que el orden sea determinístico si dos tareas cierran
  // al mismo tiempo, ej. flujo bulk desde el mismo tutor).
  private readonly tareasOrdenadas = computed<readonly ExamEnCurso[]>(() => {
    return this.items()
      .filter((e) => e.esTarea())
      .slice()
      .sort((a, b) => {
        const dt = (a.openUntil?.getTime() ?? 0) - (b.openUntil?.getTime() ?? 0);
        if (dt !== 0) return dt;
        return a.classroomName.localeCompare(b.classroomName);
      });
  });

  // Grupos por aula. Preserva el orden inicial por deadline al iterar
  // linealmente (Map JS es insertion-ordered) — el primer grupo es el aula
  // cuya tarea más próxima cierra antes. Dentro del grupo, tareas también
  // ordenadas por deadline.
  readonly grupos = computed<readonly TareaTutorGroup[]>(() => {
    const grupos = new Map<string, TareaTutorGroup>();
    for (const t of this.tareasOrdenadas()) {
      let g = grupos.get(t.classroomId);
      if (!g) {
        g = {
          classroomId: t.classroomId,
          classroomName: t.classroomName,
          classroomCode: t.classroomCode,
          tareas: [],
        };
        grupos.set(t.classroomId, g);
      }
      g.tareas.push(this.buildCard(t));
    }
    return Array.from(grupos.values());
  });

  readonly totalTareas = computed<number>(() => this.tareasOrdenadas().length);
  readonly hasTareas = computed<boolean>(() => this.totalTareas() > 0);

  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private started = false;

  constructor() {
    effect(() => {
      // Consume nowTick para forzar recomputo del countdown en los cards.
      this.nowTick();
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
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
    this.loading.set(true);
    try {
      const result = await this.getExamsEnCurso.execute();
      this.items.set(result.items);
      this.error.set(false);
    } catch (err) {
      if (err instanceof NetworkError) {
        this.error.set(true);
      } else {
        throw err;
      }
    } finally {
      this.loading.set(false);
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

  private buildCard(t: ExamEnCurso): TareaTutorCard {
    const now = this.nowTick();
    const closeAt = t.openUntil;
    const remainingMs = closeAt !== null ? Math.max(0, closeAt.getTime() - now.getTime()) : 0;
    return {
      id: t.id,
      recordId: t.recordId,
      name: t.name,
      course: t.course,
      count: t.count,
      closeAt,
      countdownText: closeAt !== null ? formatRestanteTarea(remainingMs) : '',
    };
  }
}

export interface TareaTutorCard {
  id: string;
  recordId: string;
  name: string;
  course: string | null;
  count: number | null;
  closeAt: Date | null;
  countdownText: string;
}

export interface TareaTutorGroup {
  classroomId: string;
  classroomName: string;
  classroomCode: string;
  tareas: TareaTutorCard[];
}
