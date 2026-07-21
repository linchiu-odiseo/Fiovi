import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  Injector,
  afterNextRender,
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
  private readonly injector = inject(Injector);

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
  private wheelInitialized = false;
  private initialLayoutDone = false;
  private reanchorInFlight = false;

  constructor() {
    void this.vm.load();

    // Setup de la rueda cuando (a) semanas está poblada Y (b) el elemento
    // #viewport ya está en el DOM. El viewChild signal actualiza recién
    // cuando Angular commiteó el @if que renderiza la rueda — usarlo como
    // dependencia del effect evita el race con la fase de render.
    //
    // `afterNextRender` es la API oficial de Angular para diferir trabajo
    // que depende de DOM + layout hasta después de la próxima paint. Sin
    // esto, viewport.clientHeight puede ser 0 al momento de configurar
    // spacers y scroll inicial, dejando la rueda vacía en pantalla.
    effect(() => {
      const viewportEl = this.viewport()?.nativeElement;
      const count = this.vm.semanas().length;
      if (!viewportEl || count === 0 || this.wheelInitialized) return;
      afterNextRender(() => this.initializeWheel(), { injector: this.injector });
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

  /** Tap en el chevron fijo del lens central — entra a la semana centrada. */
  protected onEnterCentered(): void {
    const semana = this.vm.selectedSemana();
    if (!semana) return;
    this.onEnter(semana);
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

    // Observers e listeners se attachean YA — no requieren tamaño.
    this.attachIntersectionObserver(viewportEl);
    this.attachResizeObserver(viewportEl);
    this.attachScrollListener(viewportEl);

    // Fuerzo layout leyendo offsetHeight (evita el caso donde el navegador
    // aún no calculó dimensiones tras el @for). Si aún así clientHeight es 0
    // (elemento colapsado por CSS o oculto), el ResizeObserver toma el
    // relevo cuando el tamaño cambie.
    void viewportEl.offsetHeight;

    if (viewportEl.clientHeight > 0) {
      this.syncSpacerHeight();
      this.performInitialLayout();
    }

    this.wheelInitialized = true;
  }

  private performInitialLayout(): void {
    if (this.initialLayoutDone) return;
    const N = this.vm.semanas().length;
    const initialReal = this.vm.initialSelectedIndex();
    if (initialReal < 0 || N === 0) return;

    const initialVirtual = N + initialReal;
    this.vm.selectByIndex(initialReal);
    this.observedVirtualIndex.set(initialVirtual);
    // 'instant' para que al abrir la página no se vea la animación de scroll
    // desde el tope hasta HOY.
    this.scrollToVirtualIndex(initialVirtual, 'instant');
    this.initialLayoutDone = true;
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
    // Doble propósito:
    //   1. Layout inicial diferido: la primera vez que viewportEl reciba
    //      un tamaño real (post-primer-paint), hacemos syncSpacerHeight +
    //      centrado inicial. Sin esto la rueda queda vacía en pantalla
    //      porque el scrollTop se calculó contra clientHeight=0.
    //   2. Resize continuo: rotación mobile, resize desktop, teclado on-screen
    //      → recomputar spacer y re-centrar el item seleccionado.
    //
    // El trabajo del callback se difiere con requestAnimationFrame por dos
    // razones críticas:
    //   a) Mutar DOM (setear style.height en spacers) dentro del propio callback
    //      del observer causa el error "ResizeObserver loop completed with
    //      undelivered notifications". Angular lo intercepta como error y
    //      puede cortar renders subsecuentes → rueda queda visualmente vacía.
    //   b) rAF garantiza que el trabajo corre después de que el navegador
    //      terminó de procesar el redimensionamiento actual.
    this.resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (!viewportEl.isConnected) return;
        if (viewportEl.clientHeight === 0) return;
        this.syncSpacerHeight();
        if (!this.initialLayoutDone) {
          this.performInitialLayout();
          return;
        }
        const virtualIdx = this.observedVirtualIndex();
        this.scrollToVirtualIndex(virtualIdx, 'instant');
      });
    });
    this.resizeObserver.observe(viewportEl);
  }

  private attachScrollListener(viewportEl: HTMLElement): void {
    // Re-anclaje SÍNCRONO en cada scroll event (no debounced). Motivo: el
    // debounce de 120ms permitía que el momentum de un fling atravesara
    // la copia superior/inferior COMPLETA antes de reaccionar. El usuario
    // veía la rueda "spinnear" por todos los items intermedios antes del
    // salto invisible.
    //
    // Con la lógica síncrona ajustamos scrollTop en cuanto el item
    // centrado cruza el borde entre copias. El delta que aplicamos es
    // exactamente `N * itemHeight` → posición final visualmente idéntica
    // (mismo item, otra copia) → el momentum del navegador continúa desde
    // la nueva scrollTop sin cortarse (Chrome/Safari/Firefox garantizan
    // esto porque el ajuste se hace dentro del handler).
    viewportEl.addEventListener('scroll', this.handleScrollReanchor, {
      passive: true,
    });
  }

  private handleScrollReanchor = (): void => {
    if (this.reanchorInFlight) return;
    const viewportEl = this.viewport()?.nativeElement;
    if (!viewportEl) return;
    const N = this.vm.semanas().length;
    if (N === 0) return;

    const itemH = WHEEL_ITEM_HEIGHT_PX;
    const centerY = viewportEl.scrollTop + viewportEl.clientHeight / 2;

    // Uso el item 0 para computar por aritmética la posición de cualquier
    // virtual index — evita un querySelectorAll caro en el hot path.
    const firstItem = viewportEl.querySelector<HTMLLIElement>(
      '.wheel-item[data-virtual-index="0"]',
    );
    if (!firstItem) return;
    const firstItemTop = firstItem.offsetTop;
    const virtualAtCenter = Math.round((centerY - firstItemTop - itemH / 2) / itemH);
    if (!Number.isFinite(virtualAtCenter)) return;

    const middleStart = N;
    const middleEnd = N * 2;
    if (virtualAtCenter >= middleStart && virtualAtCenter < middleEnd) return;

    const delta = virtualAtCenter < middleStart ? N * itemH : -N * itemH;
    this.reanchorInFlight = true;
    viewportEl.scrollTop += delta;
    // Adelanto el signal para que las clases CSS de blur se actualicen sin
    // esperar el observer.
    this.observedVirtualIndex.set(virtualAtCenter + delta / itemH);
    // Libero el guard en el siguiente frame — evita cascada de re-ajustes.
    requestAnimationFrame(() => {
      this.reanchorInFlight = false;
    });
  };

  private syncSpacerHeight(): void {
    const viewportEl = this.viewport()?.nativeElement;
    if (!viewportEl) return;
    const viewportH = viewportEl.clientHeight;
    // Guards:
    //   - viewportH === 0: aún sin layout válido, dejamos que ResizeObserver
    //     nos vuelva a llamar cuando el navegador determine el tamaño real.
    //   - viewportH > 10000: sanity check — un viewport de más de 10k px es
    //     casi seguro un feedback loop CSS (flex-basis: auto con contenido
    //     scrollable inflando su propio contenedor). Refuse to compute o
    //     seteo un spacer astronómico que empeoraría el loop.
    if (viewportH === 0 || viewportH > 10_000) return;
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
    const viewportEl = this.viewport()?.nativeElement;
    viewportEl?.removeEventListener('scroll', this.handleScrollReanchor);
  }
}
