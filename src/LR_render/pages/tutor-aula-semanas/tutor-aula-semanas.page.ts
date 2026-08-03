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

// Umbral para activar el modo cíclico. Con N ≤ CYCLIC_THRESHOLD el usuario
// notaría rápidamente la repetición (subir/bajar recorre pocos items y
// vuelve a ver los mismos), así que la rueda pasa a modo lineal con topes
// naturales (rubber band del navegador). Solo con N > CYCLIC_THRESHOLD
// tiene sentido ciclar porque el usuario percibe un flujo continuo antes
// de completar una vuelta.
const CYCLIC_THRESHOLD = 6;

// Copias del array real cuando el modo cíclico está activo. 3 es el mínimo:
// bloque anterior + bloque central + bloque siguiente. El re-anclaje al
// bloque central es invisible siempre y cuando ocurra antes de que el
// usuario alcance el borde exterior de las copias vecinas — el margen de 1
// copia entera de buffer alcanza para cualquier fling humano.
const WHEEL_COPIES_CYCLIC = 3;

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
   * (0 .. copies*N - 1). La page mantiene este signal separado del
   * `vm.selectedIndex()` (que trabaja en índices reales 0..N-1) porque las
   * clases CSS de blur necesitan comparar con el item virtual centrado, no
   * con el real (que se repite entre copias).
   */
  protected readonly observedVirtualIndex = signal<number>(0);

  /**
   * True cuando la rueda debe operar en modo cíclico (N > CYCLIC_THRESHOLD).
   * Debajo del umbral el scroll es lineal con topes naturales.
   */
  protected readonly isCyclic = computed(() => this.vm.semanas().length > CYCLIC_THRESHOLD);

  /**
   * Copias del array real. En modo cíclico son 3 (bloque anterior/central/
   * siguiente); en modo lineal es 1 (una sola copia, scroll de tope a tope).
   */
  protected readonly wheelCopies = computed<number>(() => {
    const N = this.vm.semanas().length;
    if (N === 0) return 0;
    return this.isCyclic() ? WHEEL_COPIES_CYCLIC : 1;
  });

  /**
   * Array de semanas concatenado `wheelCopies` veces. La rueda scrollea sobre
   * este array; en modo cíclico el scroll handler re-ancla al bloque medio
   * cuando el usuario cruza al bloque anterior/siguiente.
   */
  protected readonly virtualSemanas = computed<readonly AulaSemana[]>(() => {
    const source = this.vm.semanas();
    if (source.length === 0) return [];
    const copies = this.wheelCopies();
    if (copies <= 1) return [...source];
    const out: AulaSemana[] = [];
    for (let c = 0; c < copies; c++) out.push(...source);
    return out;
  });

  /** Distancia absoluta al item virtualmente centrado. Alimenta clases CSS. */
  protected readonly distanceFromCenter = (virtualIndex: number): number =>
    Math.abs(virtualIndex - this.observedVirtualIndex());

  private resizeObserver: ResizeObserver | null = null;
  private wheelInitialized = false;
  private initialLayoutDone = false;
  private reanchorInFlight = false;
  private scrollRafPending = false;
  private lastVirtualCount = 0;

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

    // Si el conteo virtual cambia post-init (raro: solo si `wheelCopies` se
    // recomputa, típicamente por resize brusco que cambie N), re-centrar al
    // nuevo bloque medio manteniendo el item real seleccionado.
    effect(() => {
      const virtualCount = this.virtualSemanas().length;
      if (!this.wheelInitialized || virtualCount === this.lastVirtualCount) return;
      this.lastVirtualCount = virtualCount;
      afterNextRender(
        () => {
          const N = this.vm.semanas().length;
          if (N === 0) return;
          const realIdx = this.vm.selectedIndex();
          if (realIdx < 0) return;
          const middleStart = this.middleCopyIndex() * N;
          const virtualIdx = middleStart + realIdx;
          this.observedVirtualIndex.set(virtualIdx);
          this.scrollToVirtualIndex(virtualIdx, 'instant');
        },
        { injector: this.injector },
      );
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

  /** True si la semana virtualIndex es la semana "HOY". */
  protected isToday(virtualIndex: number): boolean {
    const N = this.vm.semanas().length;
    if (N === 0) return false;
    return this.vm.todayIndex() === virtualIndex % N;
  }

  // ── Wheel internals ──────────────────────────────────────────────────

  private middleCopyIndex(): number {
    // Con `copies` impares el bloque medio es el del medio geométrico. En
    // modo lineal (copies=1) el bloque medio es el único (0).
    return Math.floor(this.wheelCopies() / 2);
  }

  private initializeWheel(): void {
    const viewportEl = this.viewport()?.nativeElement;
    if (!viewportEl) return;

    this.attachResizeObserver(viewportEl);
    this.attachScrollListener(viewportEl);

    // Fuerzo layout leyendo offsetHeight (evita el caso donde el navegador
    // aún no calculó dimensiones tras el @for). Si aún así clientHeight es 0
    // (elemento colapsado por CSS o oculto), el ResizeObserver toma el relevo
    // cuando el tamaño cambie.
    void viewportEl.offsetHeight;

    if (viewportEl.clientHeight > 0) {
      this.syncSpacerHeight();
      this.performInitialLayout();
    }

    this.lastVirtualCount = this.virtualSemanas().length;
    this.wheelInitialized = true;
  }

  private performInitialLayout(): void {
    if (this.initialLayoutDone) return;
    const N = this.vm.semanas().length;
    const initialReal = this.vm.initialSelectedIndex();
    if (initialReal < 0 || N === 0) return;

    const middleStart = this.middleCopyIndex() * N;
    const initialVirtual = middleStart + initialReal;
    this.vm.selectByIndex(initialReal);
    this.observedVirtualIndex.set(initialVirtual);
    // 'instant' para que al abrir la página no se vea la animación de scroll
    // desde el tope hasta HOY.
    this.scrollToVirtualIndex(initialVirtual, 'instant');
    this.initialLayoutDone = true;
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
    // Un único handler para (a) mantener `observedVirtualIndex` sincronizado
    // con el item que ocupa el centro visual y (b) re-anclar al bloque medio
    // cuando el usuario se acerca a los bordes del contenido virtualizado.
    //
    // Reemplaza al ex-IntersectionObserver: éste tenía un race contra el
    // re-anclaje que provocaba desyncs (item mostrado con detalle no coincidía
    // con el chevron), saltos aparentes hacia atrás, y comportamiento errático
    // en fling rápido. Un solo handler síncrono sobre `scroll` es más simple y
    // más preciso porque calcula el centro exacto en cada tick.
    viewportEl.addEventListener('scroll', this.handleScroll, { passive: true });
  }

  private handleScroll = (): void => {
    if (this.scrollRafPending) return;
    this.scrollRafPending = true;
    requestAnimationFrame(() => {
      this.scrollRafPending = false;
      this.processScrollTick();
    });
  };

  private processScrollTick(): void {
    if (this.reanchorInFlight) return;
    const viewportEl = this.viewport()?.nativeElement;
    if (!viewportEl) return;
    const N = this.vm.semanas().length;
    if (N === 0) return;
    const copies = this.wheelCopies();
    if (copies === 0) return;

    const itemH = WHEEL_ITEM_HEIGHT_PX;
    const centerY = viewportEl.scrollTop + viewportEl.clientHeight / 2;

    // Uso el item 0 para computar por aritmética la posición de cualquier
    // virtual index — evita un querySelectorAll caro en el hot path.
    const firstItem = viewportEl.querySelector<HTMLLIElement>(
      '.wheel-item[data-virtual-index="0"]',
    );
    if (!firstItem) return;
    const firstItemTop = firstItem.offsetTop;
    const rawVirtual = Math.round((centerY - firstItemTop - itemH / 2) / itemH);
    if (!Number.isFinite(rawVirtual)) return;
    const totalVirtual = copies * N;
    // Clampeo defensivo — el clamp del navegador contra bordes puede devolver
    // un centro fuera de rango durante ajustes bruscos.
    const virtualAtCenter = Math.max(0, Math.min(totalVirtual - 1, rawVirtual));

    // 1) Sincronizar índice observado con posición real del scroll. Sustituye
    //    al IntersectionObserver — evita el desync visual (detalles del item
    //    seleccionado se muestran en un slot distinto al del chevron fijo).
    if (virtualAtCenter !== this.observedVirtualIndex()) {
      this.observedVirtualIndex.set(virtualAtCenter);
      const realIdx = ((virtualAtCenter % N) + N) % N;
      this.vm.selectByIndex(realIdx);
    }

    // 2) Re-anclar SOLO en modo cíclico. En modo lineal el scroll topa
    //    naturalmente con los extremos del contenido y el rubber band del
    //    navegador da el rebote elástico que espera el usuario.
    if (!this.isCyclic()) return;

    // Re-anclar al bloque medio si estamos a más de 1 copia de él. Con
    // WHEEL_COPIES_CYCLIC = 3 y el centro inicial en la copia media, esto
    // significa: re-anclar tan pronto el usuario cruza al bloque anterior o
    // siguiente. Como el bloque medio tiene N items completos de buffer a
    // cada lado, el momentum del fling nunca choca contra el clamp del
    // navegador → adiós rebote violento 28 → 27 → ... → 1.
    const middleCopyIdx = this.middleCopyIndex();
    const currentCopyIdx = Math.floor(virtualAtCenter / N);
    if (currentCopyIdx === middleCopyIdx) return;

    const delta = (middleCopyIdx - currentCopyIdx) * N * itemH;
    this.reanchorInFlight = true;
    // `behavior: 'instant'` explícito: aunque el CSS tenga `scroll-behavior:
    // smooth` en el viewport, forzamos teleport atómico. Con smooth el reanchor
    // se animaría → el usuario vería la rueda "girando" en la dirección opuesta
    // durante el ajuste, exactamente el bug que queremos eliminar.
    viewportEl.scrollTo({ top: viewportEl.scrollTop + delta, behavior: 'instant' });
    this.observedVirtualIndex.set(virtualAtCenter + Math.floor(delta / itemH));
    // Libero el guard en el siguiente frame — evita cascada de re-ajustes.
    requestAnimationFrame(() => {
      this.reanchorInFlight = false;
    });
  }

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
      const wanted = target.offsetTop + target.clientHeight / 2 - viewportEl.clientHeight / 2;
      // `scroll-snap-type: y mandatory` + `scroll-behavior: smooth` en .page.scss
      // hacen que la primera asignación de `scrollTop` durante el primer paint
      // sea rechazada silenciosamente (el navegador la descarta porque el layout
      // aún no puede snappear a un item, y la deja en 0). Sin esto, con N > ~20
      // la rueda arranca en Semana 1 en lugar de HOY.
      //
      // Suspendemos ambos estilos, asignamos, y los restauramos un frame
      // después — el scroll queda ya en el snap-point correcto, así que el
      // re-attach del snap no mueve nada. Blindamos el scroll listener con
      // `reanchorInFlight` para que los valores intermedios no desincronicen
      // `observedVirtualIndex`.
      this.reanchorInFlight = true;
      const prevSnap = viewportEl.style.scrollSnapType;
      const prevBehavior = viewportEl.style.scrollBehavior;
      viewportEl.style.scrollSnapType = 'none';
      viewportEl.style.scrollBehavior = 'auto';
      viewportEl.scrollTop = wanted;
      requestAnimationFrame(() => {
        viewportEl.style.scrollSnapType = prevSnap;
        viewportEl.style.scrollBehavior = prevBehavior;
        this.reanchorInFlight = false;
      });
    } else {
      target.scrollIntoView({ behavior, block: 'center' });
    }
  }

  private scrollByDelta(delta: number): void {
    const virtualIdx = this.observedVirtualIndex();
    if (virtualIdx < 0) return;
    const N = this.vm.semanas().length;
    if (N === 0) return;
    const totalVirtual = this.wheelCopies() * N;
    const next = virtualIdx + delta;
    // Los bordes son manejados por el re-anclaje — si next queda fuera del
    // rango virtual, dejo que el navegador clampee a 0/max, el re-anclaje
    // teleporta al equivalente en la copia central.
    if (next < 0 || next >= totalVirtual) return;
    this.scrollToVirtualIndex(next, 'smooth');
  }

  private teardown(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    const viewportEl = this.viewport()?.nativeElement;
    viewportEl?.removeEventListener('scroll', this.handleScroll);
  }
}
