import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { AulaSemana } from '../../../L1_domain/entities/aula-semana';
import { TutorAulaSemanasViewModel } from '../../view-models/tutor-aula-semanas.view-model';

@Component({
  selector: 'app-tutor-aula-semanas-page',
  templateUrl: './tutor-aula-semanas.page.html',
  styleUrl: './tutor-aula-semanas.page.scss',
  providers: [TutorAulaSemanasViewModel],
})
export class TutorAulaSemanasPage {
  protected readonly vm = inject(TutorAulaSemanasViewModel);
  private readonly destroyRef = inject(DestroyRef);

  private readonly viewport = viewChild<ElementRef<HTMLDivElement>>('viewport');

  // Distancia signed del item i al item centrado. Recomputa cuando cambia
  // selectedIndex → cascada de clases CSS en el template sin listeners extra.
  protected readonly distanceFromCenter = (index: number): number =>
    Math.abs(index - this.vm.selectedIndex());

  private observer: IntersectionObserver | null = null;
  private wheelInitialized = false;

  constructor() {
    void this.vm.load();

    // Setup de la rueda cuando `semanas` está poblada. Corre una única vez
    // gracias al guard `wheelInitialized`. Usa queueMicrotask para dejar que
    // Angular renderice los <li> antes de attachar el observer.
    effect(() => {
      const count = this.vm.semanas().length;
      if (count === 0 || this.wheelInitialized) return;
      queueMicrotask(() => this.initializeWheel());
    });

    this.destroyRef.onDestroy(() => {
      this.observer?.disconnect();
      this.observer = null;
    });
  }

  protected onVolver(): void {
    this.vm.goBack();
  }

  protected onRetry(): void {
    void this.vm.load();
  }

  /**
   * Tap en un item:
   *   - Si está centrado: navega a los cursos de esa semana.
   *   - Si NO está centrado: hace scroll para llevarlo al centro (el
   *     IntersectionObserver actualiza selectedIndex al llegar).
   */
  protected onItemClick(index: number, semana: AulaSemana): void {
    if (index === this.vm.selectedIndex()) {
      this.vm.goToSemana(semana.periodId);
      return;
    }
    this.scrollToIndex(index, 'smooth');
  }

  /** Tap en el chevron / CTA "Entrar" — navega sin depender de doble tap. */
  protected onEnter(semana: AulaSemana): void {
    this.vm.goToSemana(semana.periodId);
  }

  /**
   * Keyboard nav — ↑/↓ mueven la selección, Enter entra al semana centrada.
   * Estamos en la pantalla completa; capturamos las teclas a nivel host.
   */
  @HostListener('keydown.arrowUp', ['$event'])
  protected onArrowUp(event: Event): void {
    event.preventDefault();
    this.scrollByDelta(-1);
  }

  @HostListener('keydown.arrowDown', ['$event'])
  protected onArrowDown(event: Event): void {
    event.preventDefault();
    this.scrollByDelta(1);
  }

  @HostListener('keydown.enter', ['$event'])
  protected onKeyboardEnter(event: Event): void {
    const semana = this.vm.selectedSemana();
    if (!semana) return;
    event.preventDefault();
    this.onEnter(semana);
  }

  /** True si la semana en `index` es la que contiene "hoy" (server clock). */
  protected isToday(index: number): boolean {
    return this.vm.todayIndex() === index;
  }

  // ── Wheel internals ──────────────────────────────────────────────────

  private initializeWheel(): void {
    const viewportEl = this.viewport()?.nativeElement;
    if (!viewportEl) return;

    // rootMargin negativo comprime el "hit-area" de intersección a solo la
    // franja central del viewport. Cuando un item cae en esa franja, se lo
    // considera centrado.
    // Con item de 80px y viewport de ~5×80=400px, dejamos un ±20% de margen
    // arriba/abajo para que solo un item a la vez califique como "centrado".
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          const rawIndex = el.dataset['index'];
          if (rawIndex === undefined) continue;
          const parsed = Number(rawIndex);
          if (!Number.isFinite(parsed)) continue;
          this.vm.selectByIndex(parsed);
        }
      },
      {
        root: viewportEl,
        rootMargin: '-45% 0px -45% 0px',
        threshold: 0,
      },
    );

    const items = viewportEl.querySelectorAll<HTMLLIElement>('.wheel-item');
    items.forEach((item) => this.observer!.observe(item));

    // Auto-scroll a la selección inicial (HOY o primera con contenido).
    const initialIdx = this.vm.initialSelectedIndex();
    if (initialIdx >= 0) {
      this.vm.selectByIndex(initialIdx);
      this.scrollToIndex(initialIdx, 'instant');
    }

    this.wheelInitialized = true;
  }

  private scrollToIndex(index: number, behavior: ScrollBehavior): void {
    const viewportEl = this.viewport()?.nativeElement;
    if (!viewportEl) return;
    const target = viewportEl.querySelector<HTMLLIElement>(`.wheel-item[data-index="${index}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior, block: 'center' });
  }

  private scrollByDelta(delta: number): void {
    const current = this.vm.selectedIndex();
    if (current < 0) return;
    const next = current + delta;
    if (next < 0 || next >= this.vm.semanas().length) return;
    this.scrollToIndex(next, 'smooth');
  }
}
