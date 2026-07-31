import { describe, it, expect, beforeEach } from 'vitest';
import { Component } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { SwipeableCardComponent } from '../../../../src/LR_render/components/swipeable-card/swipeable-card.component';

// Host wrapper mínimo para poder proyectar contenido y espiar el output.
@Component({
  standalone: true,
  imports: [SwipeableCardComponent],
  template: `
    <app-swipeable-card actionLabel="Archivar" actionIcon="archive" (action)="onAction()">
      <div data-testid="card-body">Contenido</div>
    </app-swipeable-card>
    <div data-testid="outside">Afuera</div>
  `,
})
class HostComponent {
  actionCount = 0;
  onAction(): void {
    this.actionCount++;
  }
}

// Helper: dispara un pointer event sintético con clientX/Y en el target.
// jsdom no siempre soporta setPointerCapture; el componente atrapa el throw.
function firePointer(
  target: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  clientX: number,
  clientY: number,
  pointerId = 1,
): void {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    clientX: number;
    clientY: number;
    pointerId: number;
    pointerType: string;
    button: number;
  };
  event.clientX = clientX;
  event.clientY = clientY;
  event.pointerId = pointerId;
  event.pointerType = 'touch';
  event.button = 0;
  target.dispatchEvent(event);
}

describe('SwipeableCardComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let content: HTMLElement;
  let actionButton: HTMLButtonElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();

    content = fixture.nativeElement.querySelector('.swipeable-card__content') as HTMLElement;
    actionButton = fixture.nativeElement.querySelector(
      '[data-testid="swipeable-card-action"]',
    ) as HTMLButtonElement;
  });

  describe('render', () => {
    it('renderiza el wrap con el botón de acción y el content proyectado', () => {
      expect(fixture.nativeElement.querySelector('[data-testid="swipeable-card"]')).not.toBeNull();
      expect(actionButton).not.toBeNull();
      expect(actionButton.getAttribute('aria-label')).toBe('Archivar');
      expect(fixture.nativeElement.querySelector('[data-testid="card-body"]')).not.toBeNull();
    });

    it('estado inicial: transform=0 y tabindex=-1 en el botón (no alcanzable con Tab)', () => {
      expect(content.style.transform).toBe('translateX(0px)');
      expect(actionButton.getAttribute('tabindex')).toBe('-1');
    });
  });

  describe('gesto horizontal', () => {
    it('drag horizontal más allá del umbral (40% de 88px = 35.2px) → snap open', () => {
      firePointer(content, 'pointerdown', 200, 100);
      firePointer(content, 'pointermove', 190, 100); // dx=-10 (< umbral)
      firePointer(content, 'pointermove', 100, 100); // dx=-100 (traslada a -88 por clamp)
      firePointer(content, 'pointerup', 100, 100);
      fixture.detectChanges();

      expect(content.style.transform).toBe('translateX(-88px)');
      expect(actionButton.getAttribute('tabindex')).toBe('0');
    });

    it('drag horizontal por debajo del umbral → snap back a 0 (cerrado)', () => {
      firePointer(content, 'pointerdown', 200, 100);
      firePointer(content, 'pointermove', 190, 100); // dx=-10
      firePointer(content, 'pointermove', 180, 100); // dx=-20 (< 35.2px umbral)
      firePointer(content, 'pointerup', 180, 100);
      fixture.detectChanges();

      expect(content.style.transform).toBe('translateX(0px)');
      expect(actionButton.getAttribute('tabindex')).toBe('-1');
    });

    it('gesto predominantemente vertical → cancela el drag, no traslada', () => {
      firePointer(content, 'pointerdown', 200, 100);
      // dy > dx: scroll vertical, no swipe.
      firePointer(content, 'pointermove', 205, 150); // dx=5, dy=50
      firePointer(content, 'pointermove', 210, 200); // ya se decidió vertical, no debe trasladar
      firePointer(content, 'pointerup', 210, 200);
      fixture.detectChanges();

      expect(content.style.transform).toBe('translateX(0px)');
    });

    it('drag hacia la derecha no traslada más allá de 0 (clamp)', () => {
      firePointer(content, 'pointerdown', 100, 100);
      firePointer(content, 'pointermove', 90, 100); // dx=-10 (define horizontal)
      firePointer(content, 'pointermove', 200, 100); // dx=+100 (intenta ir a +100)
      firePointer(content, 'pointerup', 200, 100);
      fixture.detectChanges();

      // Clamp: no puede pasar de 0. Al soltar en 0 → snap closed.
      expect(content.style.transform).toBe('translateX(0px)');
    });

    it('pointercancel durante drag → snap closed sin emitir action', () => {
      firePointer(content, 'pointerdown', 200, 100);
      firePointer(content, 'pointermove', 100, 100); // -100, define horizontal
      firePointer(content, 'pointercancel', 100, 100);
      fixture.detectChanges();

      expect(content.style.transform).toBe('translateX(0px)');
      expect(host.actionCount).toBe(0);
    });
  });

  describe('output action', () => {
    it('click en el botón revelado emite (action) y cierra la card', () => {
      // Abrir la card primero.
      firePointer(content, 'pointerdown', 200, 100);
      firePointer(content, 'pointermove', 100, 100);
      firePointer(content, 'pointerup', 100, 100);
      fixture.detectChanges();
      expect(content.style.transform).toBe('translateX(-88px)');

      actionButton.click();
      fixture.detectChanges();

      expect(host.actionCount).toBe(1);
      expect(content.style.transform).toBe('translateX(0px)');
    });
  });

  describe('cierre al tocar afuera', () => {
    it('pointerdown fuera del host con card abierta → cierra', () => {
      // Abrir.
      firePointer(content, 'pointerdown', 200, 100);
      firePointer(content, 'pointermove', 100, 100);
      firePointer(content, 'pointerup', 100, 100);
      fixture.detectChanges();
      expect(content.style.transform).toBe('translateX(-88px)');

      const outside = fixture.nativeElement.querySelector('[data-testid="outside"]') as HTMLElement;
      firePointer(outside, 'pointerdown', 0, 0);
      fixture.detectChanges();

      expect(content.style.transform).toBe('translateX(0px)');
    });

    it('pointerdown fuera del host con card cerrada → no hace nada (short-circuit)', () => {
      const outside = fixture.nativeElement.querySelector('[data-testid="outside"]') as HTMLElement;
      firePointer(outside, 'pointerdown', 0, 0);
      fixture.detectChanges();

      // Sigue cerrada, sin efectos secundarios (test es que no lance).
      expect(content.style.transform).toBe('translateX(0px)');
    });
  });
});
