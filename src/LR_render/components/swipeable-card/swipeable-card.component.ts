import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  ViewEncapsulation,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

// Ancho del botón de acción revelado al deslizar. Debe matchear el $width
// del SCSS. Se centraliza acá para que TS y CSS usen el mismo número.
const ACTION_WIDTH_PX = 88;

// Umbral (en px) para snap-open: si el drag supera este valor, la card queda
// abierta al soltar; si no, vuelve a 0. 40% del ancho del botón se siente
// natural en mobile (probado en YouTube/Gmail).
const OPEN_THRESHOLD_PX = ACTION_WIDTH_PX * 0.4;

// Distancia mínima (en px) para considerar el gesto como swipe horizontal
// y no como un scroll vertical del listado. Si el usuario se mueve más en
// Y que en X antes de superar este umbral, cancelamos el drag.
const HORIZONTAL_INTENT_PX = 6;

// Card contenedora que se puede deslizar a la izquierda para revelar un
// botón de acción destructiva (archivar). Estilo YouTube/Gmail:
//   - Drag horizontal: swipe left → aparece botón; swipe right desde abierto → cierra.
//   - Umbral de 40% del ancho del botón para snap-open.
//   - Tap en cualquier lado fuera de una card abierta → cierra.
//   - El contenido de la card va en <ng-content>, el componente no dicta layout.
//   - Emite (action) cuando se tapea el botón revelado.
//
// No usa Angular animations para evitar overhead; solo CSS transitions sobre
// transform. El estado se maneja con signals para que Angular re-renderice
// solamente el binding del [style.transform].
@Component({
  selector: 'app-swipeable-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="swipeable-card__wrap" data-testid="swipeable-card">
      <button
        type="button"
        class="swipeable-card__action"
        [attr.aria-label]="actionLabel()"
        [attr.tabindex]="isOpen() ? 0 : -1"
        data-testid="swipeable-card-action"
        (click)="onActionClick($event)"
      >
        <span class="material-symbols-outlined" aria-hidden="true">{{ actionIcon() }}</span>
        <span class="swipeable-card__action-label">{{ actionLabel() }}</span>
      </button>
      <div
        class="swipeable-card__content"
        [class.swipeable-card__content--dragging]="isDragging()"
        [style.transform]="transformStyle()"
        (pointerdown)="onPointerDown($event)"
        (pointermove)="onPointerMove($event)"
        (pointerup)="onPointerUp($event)"
        (pointercancel)="onPointerCancel($event)"
      >
        <ng-content></ng-content>
      </div>
    </div>
  `,
  styleUrl: './swipeable-card.component.scss',
})
export class SwipeableCardComponent {
  readonly actionLabel = input.required<string>();
  readonly actionIcon = input<string>('archive');

  readonly action = output<void>();

  // Traslación X actual (0 = cerrado, -ACTION_WIDTH_PX = totalmente abierto).
  private readonly translateX = signal(0);
  private readonly dragging = signal(false);

  private readonly hostRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  private pointerId: number | null = null;
  private startX = 0;
  private startY = 0;
  private startTranslate = 0;
  // Se resuelve al primer move: 'horizontal' captura el gesto, 'vertical' lo cancela.
  private axis: 'unknown' | 'horizontal' | 'vertical' = 'unknown';

  constructor() {
    this.destroyRef.onDestroy(() => this.releasePointer());
  }

  readonly isOpen = computed(() => this.translateX() <= -OPEN_THRESHOLD_PX);
  readonly isDragging = computed(() => this.dragging());
  readonly transformStyle = computed(() => `translateX(${this.translateX()}px)`);

  // Cierra la card cuando el usuario tapea afuera. Usamos capture:true para
  // atrapar el click antes de que llegue al target — si el usuario tapea otra
  // card abierta, queremos cerrar esta primero (una sola card abierta a la vez
  // sería otra feature: por ahora solo cerramos la propia si el click no
  // fue en el botón de acción ni dentro de la propia card).
  @HostListener('document:pointerdown', ['$event'])
  onDocumentPointerDown(event: PointerEvent): void {
    if (!this.isOpen() && this.translateX() === 0) return;
    const target = event.target as Node | null;
    if (target && this.hostRef.nativeElement.contains(target)) return;
    this.snapClosed();
  }

  protected onPointerDown(event: PointerEvent): void {
    // Solo botón primario del mouse; touch/pen siempre pasan.
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    this.pointerId = event.pointerId;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.startTranslate = this.translateX();
    this.axis = 'unknown';
    // No capturamos el pointer todavía — esperamos a confirmar que es un
    // gesto horizontal, para no robarle el scroll vertical al listado.
  }

  protected onPointerMove(event: PointerEvent): void {
    if (this.pointerId !== event.pointerId) return;
    const dx = event.clientX - this.startX;
    const dy = event.clientY - this.startY;

    if (this.axis === 'unknown') {
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      if (absDx < HORIZONTAL_INTENT_PX && absDy < HORIZONTAL_INTENT_PX) return;
      // Ya se pasó el umbral: decidimos eje y no lo cambiamos más.
      if (absDy > absDx) {
        this.axis = 'vertical';
        this.releasePointer();
        return;
      }
      this.axis = 'horizontal';
      this.dragging.set(true);
      // Capturamos ahora: futuros events van a este handler aunque el dedo
      // se salga del content div.
      try {
        (event.target as Element).setPointerCapture(event.pointerId);
      } catch {
        // Ignorar: algunos entornos de test no implementan setPointerCapture.
      }
    }

    if (this.axis !== 'horizontal') return;

    event.preventDefault();
    // Clamp: no permitimos deslizar a la derecha más allá de 0 (cerrado),
    // ni a la izquierda más allá del ancho del botón (con leve rebote para
    // feedback táctil).
    const next = this.startTranslate + dx;
    const clamped = Math.max(-ACTION_WIDTH_PX * 1.1, Math.min(0, next));
    this.translateX.set(clamped);
  }

  protected onPointerUp(event: PointerEvent): void {
    if (this.pointerId !== event.pointerId) return;
    const wasDragging = this.axis === 'horizontal';
    this.releasePointer();
    if (!wasDragging) return;

    // Decidimos snap por posición final: si pasó el umbral → abierto, si no → cerrado.
    if (this.translateX() <= -OPEN_THRESHOLD_PX) {
      this.snapOpen();
    } else {
      this.snapClosed();
    }
  }

  protected onPointerCancel(event: PointerEvent): void {
    if (this.pointerId !== event.pointerId) return;
    this.releasePointer();
    this.snapClosed();
  }

  protected onActionClick(event: MouseEvent): void {
    event.stopPropagation();
    // Cierra visualmente antes de emitir para que el consumidor vea la
    // animación de cierre aunque la lista se refresque en seguida.
    this.snapClosed();
    this.action.emit();
  }

  private snapOpen(): void {
    this.translateX.set(-ACTION_WIDTH_PX);
  }

  private snapClosed(): void {
    this.translateX.set(0);
  }

  private releasePointer(): void {
    this.pointerId = null;
    this.dragging.set(false);
    this.axis = 'unknown';
  }
}
