import { Injectable, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CLOCK } from '../../app.config';
import { GetAulaSemanasUseCase } from '../../L2_application/use-cases/get-aula-semanas.use-case';
import { AulaSemana } from '../../L1_domain/entities/aula-semana';
import { NetworkError } from '../../L1_domain/errors/network.error';
import { TutorExamForbiddenError } from '../../L1_domain/errors/tutor-exam-forbidden.error';
import { VirtualExamNotFoundError } from '../../L1_domain/errors/virtual-exam-not-found.error';

// VM de /tutor/aulas/:classroomId/semanas — nivel 2 del nav AULA → SEMANA →
// CURSO → EXÁMENES. Carga cold-path (load() al montar la page); polling
// diferido a un cambio posterior (no en este PR).
//
// Estado derivado:
//   - `semanas` ordenadas descendente por `order` (semana más nueva arriba).
//   - `semanaActual` computada con Clock server-anchored (nunca Date.now()).
//   - `error` clasifica los 3 flujos: red, forbidden, notFound.
@Injectable()
export class TutorAulaSemanasViewModel {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly getSemanas = inject(GetAulaSemanasUseCase);
  private readonly clock = inject(CLOCK);

  readonly classroomId = signal<string>('');
  readonly classroomName = signal<string | null>(null);
  readonly cycleName = signal<string | null>(null);
  readonly semanas = signal<readonly AulaSemana[]>([]);
  readonly loading = signal(true);
  readonly error = signal<'network' | 'forbidden' | 'notFound' | null>(null);

  /**
   * Índice de la semana centrada en la rueda. `-1` mientras no hay data
   * cargada. La page mantiene este signal sincronizado con la posición
   * del scroll via IntersectionObserver.
   */
  readonly selectedIndex = signal<number>(-1);

  // Semana que contiene el "hoy" (según reloj server-anchored). null cuando no
  // hay match — típicamente entre ciclos o cuando el ciclo aún no arrancó.
  readonly semanaActual = computed<AulaSemana | null>(() => {
    const now = this.clock.now();
    return this.semanas().find((s) => s.esSemanaActual(now)) ?? null;
  });

  /**
   * Índice de la semana "HOY" en el array `semanas()`. `-1` cuando no hay
   * ninguna que contenga la fecha actual del servidor.
   */
  readonly todayIndex = computed<number>(() => {
    const now = this.clock.now();
    return this.semanas().findIndex((s) => s.esSemanaActual(now));
  });

  /**
   * Semana actualmente centrada en la rueda. `null` mientras no cargó o si
   * `selectedIndex` cae fuera del rango.
   */
  readonly selectedSemana = computed<AulaSemana | null>(() => {
    const idx = this.selectedIndex();
    if (idx < 0) return null;
    return this.semanas()[idx] ?? null;
  });

  readonly hasSemanas = computed(() => this.semanas().length > 0);

  async load(): Promise<void> {
    const classroomId = this.route.snapshot.paramMap.get('classroomId') ?? '';
    this.classroomId.set(classroomId);
    this.loading.set(true);
    this.error.set(null);

    try {
      const result = await this.getSemanas.execute(classroomId);
      this.classroomName.set(result.classroom.name);
      this.cycleName.set(result.cycle.name);
      // Orden cronológico descendente: última semana arriba, semana 1 al final.
      // Mantiene la card destacada de "semana actual" cerca del top en la mayoría
      // de casos sin necesidad de fixed-pinning.
      const sorted = [...result.semanas].sort((a, b) => b.order - a.order);
      this.semanas.set(sorted);
    } catch (err) {
      if (err instanceof VirtualExamNotFoundError) {
        this.error.set('notFound');
      } else if (err instanceof TutorExamForbiddenError) {
        this.error.set('forbidden');
      } else if (err instanceof NetworkError) {
        this.error.set('network');
      } else {
        throw err;
      }
    } finally {
      this.loading.set(false);
    }
  }

  goToSemana(periodId: string): void {
    void this.router.navigate(['/tutor/aulas', this.classroomId(), 'semanas', periodId]);
  }

  goBack(): void {
    void this.router.navigate(['/tutor/home']);
  }

  /** Actualizado por la page cuando cambia la semana centrada en la rueda. */
  selectByIndex(index: number): void {
    if (index < 0 || index >= this.semanas().length) return;
    this.selectedIndex.set(index);
  }

  /**
   * Índice inicial al que la rueda debe hacer scroll al montar:
   *   1. Semana "HOY" si existe.
   *   2. Primera semana con exámenes.
   *   3. Índice 0 (primera del ciclo).
   * Devuelve `-1` si no hay semanas (la page renderiza empty state).
   */
  initialSelectedIndex(): number {
    const list = this.semanas();
    if (list.length === 0) return -1;
    const today = this.todayIndex();
    if (today >= 0) return today;
    const firstWithContent = list.findIndex((s) => !s.estaVacia());
    if (firstWithContent >= 0) return firstWithContent;
    return 0;
  }
}
