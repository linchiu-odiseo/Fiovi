import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { AulaSemana } from '../../../L1_domain/entities/aula-semana';
import { TutorAulaSemanasViewModel } from '../../view-models/tutor-aula-semanas.view-model';

// Altura fija de cada item en px — debe matchear la SCSS ($wheel-item-height).
// Se usa para calcular el spacer necesario para centrar el primer/último item.
const WHEEL_ITEM_HEIGHT_PX = 80;

// Cantidad de copias del array de semanas renderizadas para simular scroll
// cíclico. 3 es el mínimo que permite re-anclaje sin gap visual: el usuario
// scrollea en la copia central; al acercarse al borde de una copia, saltamos
// silenciosamente al item equivalente en la copia central.
const WHEEL_COPIES = 3;

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

  /**
   * Índice virtual del item actualmente centrado, en el array `virtualSemanas`
   * (0 .. N*WHEEL_COPIES - 1). La page mantiene este signal separado del
   * `vm.selectedIndex()` (que trabaja en índices reales 0..N-1) porque las
   * clases CSS de blur necesitan comparar con el item virtual centrado, no
   * con el real (que se repite entre copias).
   */
  protected readonly observedVirtualIndex = signal<number>(0);

  /**
   * Array de semanas concatenado WHEEL_COPIES veces. La rueda scrollea sobre
   * este array; cuando el observer detecta un cambio de centro, extraemos el
   * índice real vía módulo y lo empujamos al VM.
   */
  protected readonly virtualSemanas = computed<readonly AulaSemana[]>(() => {
    const source = this.vm.semanas();
    if (source.length === 0) return [];
    const out: AulaSemana[] = [];
    for (let c = 0; c < WHEEL_COPIES; c++) out.push(...source);
    return out;
  });

  /** Distancia absoluta al item virtualmente centrado. Alimenta clases CSS. */
  protected readonly distanceFromCenter = (virtualIndex: number): number =>
    Math.abs(virtualIndex - this.observedVirtualIndex());

  private observer: IntersectionObserver | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private scrollEndTimer: ReturnType<typeof setTimeout> | null = null;
  private wheelInitialized = false;
  private reanchorInFlight = false;

  constructor() {
    void this.vm.load();

    // Setup de la rueda cuando `semanas` está poblada. Corre una única vez
    // gracias al guard `wheelInitialized`. Usa queueMicrotask para dejar que
    // Angular renderice los <li> antes de attachar los observers.
    effect(() => {
      const count = this.vm.semanas().length;
      if (count === 0 || this.wheelInitialized) return;
      queueMicrotask(() => this.initializeWheel());
    });

    this.destroyRef.onDestroy(() => this.teardown());
  }

  protected onVolver(): void {
    this.vm.goBack();
  }

  protected onRetry(): void {
    void this.vm.load();
  }

  /**
   * Tap en un item:
   *   - Si está centrado (virtualmente): navega a los cursos de esa semana.
   *   - Si NO está centrado: hace scroll para llevarlo al centro.
   */
  protected onItemClick(virtualIndex: number, semana: AulaSemana): void {
    if (virtualIndex === this.observedVirtualIndex()) {
      this.vm.goToSemana(semana.periodId);
      return;
    }
    this.scrollToVirtualIndex(virtualIndex, 'smooth');
  }

  /** Tap en el botón chevron / CTA "Entrar" — navega sin doble tap. */
  protected onEnter(semana: AulaSemana): void {
    this.vm.goToSemana(semana.periodId);
  }

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

  /** True si la semana en `virtualIndex` corresponde a la semana "HOY". */
  protected isToday(virtualIndex: number): boolean {
    const N = this.vm.semanas().length;
    if (N === 0) return false;
    return this.vm.todayIndex() === virtualIndex % N;
  }

  // ── Wheel internals ──────────────────────────────────────────────────

  private initializeWheel(): void {
    const viewportEl = this.viewport()?.nativeElement;
    if (!viewportEl) return;

    this.attachIntersectionObserver(viewportEl);
    this.attachResizeObserver(viewportEl);
    this.attachScrollListener(viewportEl);

    this.syncSpacerHeight();

    // Auto-scroll a la selección inicial (HOY o primera con contenido) en la
    // copia CENTRAL del array virtual — deja copias arriba y abajo para el
    // scroll cíclico.
    const N = this.vm.semanas().length;
    const initialReal = this.vm.initialSelectedIndex();
    if (initialReal >= 0 && N > 0) {
      const initialVirtual = N + initialReal;
      this.vm.selectByIndex(initialReal);
      this.observedVirtualIndex.set(initialVirtual);
      // 'instant' para que al abrir la página no se vea la animación de scroll
      // desde el tope hasta HOY.
      this.scrollToVirtualIndex(initialVirtual, 'instant');
    }

    this.wheelInitialized = true;
  }

  private attachIntersectionObserver(viewportEl: HTMLElement): void {
    // rootMargin negativo comprime el "hit-area" de intersección a solo la
    // franja central del viewport, así solo un item a la vez califica.
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          const rawVirtual = el.dataset['virtualIndex'];
          if (rawVirtual === undefined) continue;
          const virtualIdx = Number(rawVirtual);
          if (!Number.isFinite(virtualIdx)) continue;
          const N = this.vm.semanas().length;
          if (N === 0) continue;
          this.observedVirtualIndex.set(virtualIdx);
          this.vm.selectByIndex(virtualIdx % N);
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
  }

  private attachResizeObserver(viewportEl: HTMLElement): void {
    // La rueda usa flex: 1 para ocupar el alto disponible; cuando el viewport
    // cambia (rotación mobile, resize desktop, teclado on-screen), hay que
    // recomputar el spacer y re-centrar el item seleccionado.
    this.resizeObserver = new ResizeObserver(() => {
      this.syncSpacerHeight();
      const virtualIdx = this.observedVirtualIndex();
      // Instant scroll para no animar durante el resize.
      this.scrollToVirtualIndex(virtualIdx, 'instant');
    });
    this.resizeObserver.observe(viewportEl);
  }

  private attachScrollListener(viewportEl: HTMLElement): void {
    // El re-anclaje del scroll cíclico ocurre cuando el usuario se queda
    // quieto (scroll-end). Usamos debounce de 120ms — evita que un fling
    // largo dispare múltiples re-anclajes mid-scroll.
    viewportEl.addEventListener('scroll', () => {
      if (this.scrollEndTimer !== null) clearTimeout(this.scrollEndTimer);
      this.scrollEndTimer = setTimeout(() => this.maybeReanchor(), 120);
    });
  }

  /**
   * Si el item virtual centrado cayó en la copia superior o inferior, salta
   * (sin animación) al item equivalente en la copia central. El contenido
   * de las copias es idéntico → el usuario no percibe el salto.
   */
  private maybeReanchor(): void {
    if (this.reanchorInFlight) return;
    const N = this.vm.semanas().length;
    if (N === 0) return;
    const virtualIdx = this.observedVirtualIndex();
    const middleStart = N;
    const middleEnd = N * 2;
    if (virtualIdx >= middleStart && virtualIdx < middleEnd) return;

    const targetVirtual = virtualIdx < middleStart ? virtualIdx + N : virtualIdx - N;

    this.reanchorInFlight = true;
    this.scrollToVirtualIndex(targetVirtual, 'instant');
    this.observedVirtualIndex.set(targetVirtual);
    // Libero el guard al final del tick para dar tiempo a que el observer
    // reporte el nuevo center y no dispare otro re-anclaje inmediato.
    queueMicrotask(() => {
      this.reanchorInFlight = false;
    });
  }

  private syncSpacerHeight(): void {
    const viewportEl = this.viewport()?.nativeElement;
    if (!viewportEl) return;
    const viewportH = viewportEl.clientHeight;
    if (viewportH === 0) return;
    const spacerH = Math.max(0, (viewportH - WHEEL_ITEM_HEIGHT_PX) / 2);
    const spacers = viewportEl.querySelectorAll<HTMLElement>('.wheel__spacer');
    spacers.forEach((s) => {
      s.style.height = `${spacerH}px`;
    });
  }

  private scrollToVirtualIndex(virtualIndex: number, behavior: ScrollBehavior): void {
    const viewportEl = this.viewport()?.nativeElement;
    if (!viewportEl) return;
    const target = viewportEl.querySelector<HTMLLIElement>(
      `.wheel-item[data-virtual-index="${virtualIndex}"]`,
    );
    if (!target) return;
    // Uso scrollTop directo en instant para bypass del scroll-behavior CSS
    // (que en algunos browsers ignora la opción 'instant' de scrollIntoView).
    if (behavior === 'instant') {
      const targetCenter = target.offsetTop + target.clientHeight / 2;
      const viewportCenter = viewportEl.clientHeight / 2;
      viewportEl.scrollTop = targetCenter - viewportCenter;
    } else {
      target.scrollIntoView({ behavior, block: 'center' });
    }
  }

  private scrollByDelta(delta: number): void {
    const virtualIdx = this.observedVirtualIndex();
    if (virtualIdx < 0) return;
    const N = this.vm.semanas().length;
    if (N === 0) return;
    const totalVirtual = N * WHEEL_COPIES;
    const next = virtualIdx + delta;
    // Los bordes son manejados por el re-anclaje — si next queda fuera del
    // rango virtual, dejo que el navegador clampee a 0/max, el re-anclaje
    // teleporta al equivalente en la copia central.
    if (next < 0 || next >= totalVirtual) return;
    this.scrollToVirtualIndex(next, 'smooth');
  }

  private teardown(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.scrollEndTimer !== null) {
      clearTimeout(this.scrollEndTimer);
      this.scrollEndTimer = null;
    }
  }
}
