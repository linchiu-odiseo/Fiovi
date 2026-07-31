import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { AboutModalComponent } from '../../../../src/LR_render/components/about-modal/about-modal.component';

// Cubre `<app-about-modal>` (LR):
// - Renderiza logo con alt describiendo la app
// - Renderiza el resumen, la versión (via input) y el crédito del equipo
// - Emite `dismiss` al click en el overlay, en el card y al presionar ESC
describe('AboutModalComponent', () => {
  let fixture: ComponentFixture<AboutModalComponent>;
  let component: AboutModalComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AboutModalComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(AboutModalComponent);
    component = fixture.componentInstance;
    component.appVersion = '1.2.5';
    fixture.detectChanges();
  });

  describe('render', () => {
    it('renderiza el logo con alt descriptivo', () => {
      const logo = fixture.nativeElement.querySelector('.modal__logo') as HTMLImageElement;
      expect(logo).not.toBeNull();
      expect(logo.getAttribute('src')).toBe('/img/logo.png');
      expect(logo.getAttribute('alt')).toContain('Fiovi');
    });

    it('renderiza el resumen de la app', () => {
      const summary = fixture.nativeElement.querySelector('.modal__summary') as HTMLElement;
      expect(summary).not.toBeNull();
      expect(summary.textContent).toContain('Cartilla virtual de marcaciones');
    });

    it('renderiza la versión con prefijo "v" a partir del input `appVersion`', () => {
      const version = fixture.nativeElement.querySelector('.modal__version') as HTMLElement;
      expect(version).not.toBeNull();
      expect(version.textContent?.trim()).toBe('v1.2.5');
    });

    it('renderiza el crédito del equipo R&D+I con el año 2026', () => {
      const credit = fixture.nativeElement.querySelector('.modal__credit') as HTMLElement;
      expect(credit).not.toBeNull();
      expect(credit.textContent).toContain('R&D+I');
      expect(credit.textContent).toContain('2026');
    });

    it('renderiza la marca de agua como imagen decorativa (alt vacío + aria-hidden)', () => {
      const watermark = fixture.nativeElement.querySelector(
        '.modal__watermark',
      ) as HTMLImageElement;
      expect(watermark).not.toBeNull();
      expect(watermark.getAttribute('src')).toBe('/img/fondo20.png');
      expect(watermark.getAttribute('alt')).toBe('');
      expect(watermark.getAttribute('aria-hidden')).toBe('true');
    });
  });

  describe('output `dismiss`', () => {
    let emissions: number;

    beforeEach(() => {
      emissions = 0;
      component.dismiss.subscribe(() => emissions++);
    });

    it('emite al click en el overlay', () => {
      const overlay = fixture.nativeElement.querySelector('.modal-overlay') as HTMLElement;
      overlay.click();
      expect(emissions).toBe(1);
    });

    it('emite al click en el card (cerrar tocando cualquier parte del modal)', () => {
      const card = fixture.nativeElement.querySelector('.modal') as HTMLElement;
      card.click();
      expect(emissions).toBe(1);
    });

    it('emite al presionar ESC (a11y)', () => {
      // HostListener('document:keydown.escape') — despachamos el evento en document.
      const event = new KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(event);
      expect(emissions).toBe(1);
    });
  });
});
