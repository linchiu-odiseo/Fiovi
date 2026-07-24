import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  model,
  viewChild,
} from '@angular/core';

// Ítem de la rueda horizontal. `top` es opcional (línea chica superior, ej.
// "HOY" / "JUE"); `bottom` es la línea principal grande (ej. "24" o "15").
export interface HWheelItem {
  readonly id: string;
  readonly top?: string;
  readonly bottom: string;
}

// Ventana durante la cual ignoramos scroll events post-scroll-programático,
// para que el snap del browser + los reflows del ResizeObserver no disparen
// falsas emisiones de selectedId (ver `isProgrammaticScrolling`). 400ms cubre
// scrollIntoView smooth (~300ms) + margen para el rebound del snap.
const PROGRAMMATIC_SCROLL_WINDOW_MS = 400;

// Rueda horizontal simplificada — pensada para rangos cortos y acotados
// (chips de días 0..9, horas 1..23). Usa scroll-snap nativo del browser
// para el snap y un scroll listener throttled con rAF para sincronizar
// `selectedId`. No implementa modo cíclico (el rango es finito y chico,
// el usuario no siente la repetición como problema). Menos código que
// `tutor-aula-semanas.page` porque no necesita re-anchor ni virtualización.
@Component({
  selector: 'app-h-wheel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './h-wheel.component.html',
  styleUrl: './h-wheel.component.scss',
})
export class HWheelComponent implements AfterViewInit {
  readonly items = input.required<readonly HWheelItem[]>();
  readonly selectedId = model<string | null>(null);
  /** Ancho fijo de cada chip en px — mirror del $item-width en SCSS. */
  readonly itemWidthPx = input<number>(72);

  private readonly viewport = viewChild<ElementRef<HTMLDivElement>>('viewport');
  private readonly destroyRef = inject(DestroyRef);

  private scrollRafPending = false;
  private lastEmittedId: string | null = null;
  private initialized = false;
  private resizeObserver: ResizeObserver | null = null;

  // Timestamp hasta el que ignoramos scroll events como "input del usuario".
  // Cada scrollIntoView programático (init, resize, effect externo) empuja
  // esta ventana hacia adelante. Sin este guard, el mount dentro de un
  // modal que crece dispara: scrollToId → scroll event → handler emite un
  // id calculado sobre un layout intermedio → pisa el default con basura.
  private programmaticScrollUntil = 0;

  constructor() {
    // Cuando cambia `selectedId` desde afuera Y ya inicializamos, hacemos
    // scroll suave al chip. Evita el scroll en el mount inicial (que se
    // hace instant en ngAfterViewInit).
    effect(() => {
      const id = this.selectedId();
      if (!this.initialized || id === null) return;
      if (id === this.lastEmittedId) return;
      this.scrollToId(id, 'smooth');
    });
    this.destroyRef.onDestroy(() => this.teardown());
  }

  ngAfterViewInit(): void {
    const el = this.viewport()?.nativeElement;
    if (!el) return;
    el.addEventListener('scroll', this.handleScroll, { passive: true });

    // Recentrar al selectedId cada vez que el viewport cambia de tamaño
    // (mount inicial dentro de un modal que crece, rotación mobile, resize
    // desktop). El padding-inline se calcula con `100%` en SCSS — si el
    // container mide 0px en el momento del mount, el scroll inicial cae
    // en la posición incorrecta. Este observer lo corrige apenas el
    // browser mide el tamaño real. `initialized` se marca en la primera
    // vuelta con ancho > 0 para desbloquear el effect externo.
    this.resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        const width = el.clientWidth;
        if (width === 0) return;
        const id = this.selectedId();
        if (id === null) {
          this.initialized = true;
          return;
        }
        this.scrollToId(id, 'instant');
        if (!this.initialized) {
          this.initialized = true;
          this.lastEmittedId = id;
        }
      });
    });
    this.resizeObserver.observe(el);
  }

  protected onItemClick(id: string): void {
    this.scrollToId(id, 'smooth');
  }

  private handleScroll = (): void => {
    if (this.scrollRafPending) return;
    this.scrollRafPending = true;
    requestAnimationFrame(() => {
      this.scrollRafPending = false;
      this.emitCenteredItem();
    });
  };

  private emitCenteredItem(): void {
    // Ignora emisiones mientras dura la ventana de scroll programático —
    // sin este guard, el scroll event que dispara scrollIntoView (por el
    // mount o por resize) se lee como interacción del user y actualiza
    // selectedId con basura calculada sobre un layout intermedio.
    if (performance.now() < this.programmaticScrollUntil) return;
    const el = this.viewport()?.nativeElement;
    if (!el) return;
    const list = this.items();
    if (list.length === 0) return;
    const w = this.itemWidthPx();
    // El primer chip está posicionado con padding-left = (viewport - w)/2,
    // así que el centro geométrico del item i vive en (padding + i*w + w/2).
    // scrollLeft + viewport/2 = centro del viewport. Igualando:
    //   i = (scrollLeft + viewport/2 - padding - w/2) / w
    //     = (scrollLeft) / w      (con padding cancelando viewport/2 - w/2)
    // Válido cuando el padding se calcula con exactamente esa fórmula, que
    // es como lo setea la SCSS `padding-inline: calc((100% - {w}px)/2)`.
    const idx = Math.round(el.scrollLeft / w);
    const clamped = Math.max(0, Math.min(list.length - 1, idx));
    const item = list[clamped];
    if (!item) return;
    if (item.id === this.lastEmittedId) return;
    this.lastEmittedId = item.id;
    this.selectedId.set(item.id);
  }

  // Scroll al chip usando scrollIntoView con inline:'center'. Es más robusto
  // que calcular targetLeft = idx * w, porque no depende del padding-inline
  // haberse resuelto al ancho real del container (relevante durante el mount
  // en un modal que está creciendo).
  private scrollToId(id: string, behavior: ScrollBehavior): void {
    const el = this.viewport()?.nativeElement;
    if (!el) return;
    const target = el.querySelector<HTMLLIElement>(`.h-wheel__item[data-id="${id}"]`);
    if (!target) return;
    this.programmaticScrollUntil = performance.now() + PROGRAMMATIC_SCROLL_WINDOW_MS;
    target.scrollIntoView({ behavior, inline: 'center', block: 'nearest' });
  }

  private teardown(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    const el = this.viewport()?.nativeElement;
    el?.removeEventListener('scroll', this.handleScroll);
  }
}
