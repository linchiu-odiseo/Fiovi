import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import {
  SubmissionReceiptModalComponent,
  formatHashBlock,
} from '../../../../src/LR_render/components/submission-receipt-modal/submission-receipt-modal.component';
import { SubmissionAck } from '../../../../src/L1_domain/value-objects/submission-ack';

// Cubre `<app-submission-receipt-modal>` (LR) según los scenarios del spec
// `exam-marking` Requirements "Modal de comprobante shape" y
// "Hash visible 4×4×4":
// - Renderiza título "Envío exitoso", subtítulo con "Pendiente de calificación"
// - Renderiza la hora del servidor en formato "HH:MM — DD mmm YYYY"
// - Renderiza el hash en 4 líneas × 4 grupos × 4 chars hex
// - Emite `closed` (NO `close` — regla ESLint no-output-native) al tocar el botón
// - Defensa contra hash inválido: renderiza fallback sin crashear
describe('SubmissionReceiptModalComponent', () => {
  // Hash válido (64 hex chars) — el del scenario del spec.
  const VALID_HASH = 'a3f5c8d1b2e4f6a8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

  const ack = (
    id = 'ack-1',
    submittedIso = '2026-06-17T15:29:54.531Z',
    hash: string = VALID_HASH,
  ): SubmissionAck => new SubmissionAck(id, hash, new Date(submittedIso));

  let fixture: ComponentFixture<SubmissionReceiptModalComponent>;
  let component: SubmissionReceiptModalComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SubmissionReceiptModalComponent],
    }).compileComponents();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('helper exportado `formatHashBlock`', () => {
    // Scenario "Hash de 64 chars produce 4 líneas" del spec exam-marking.
    it('64 hex chars → 4 líneas, cada una con 4 grupos de 4 chars separados por espacio', () => {
      const lines = formatHashBlock(VALID_HASH);
      expect(lines).toEqual([
        'a3f5 c8d1 b2e4 f6a8',
        'c9d0 e1f2 a3b4 c5d6',
        'e7f8 a9b0 c1d2 e3f4',
        'a5b6 c7d8 e9f0 a1b2',
      ]);
    });

    // Scenario "Hash de longitud inválida no crashea" del spec exam-marking.
    it('hash de longitud distinta a 64 → loguea warning y renderiza fallback (una línea con el hash crudo)', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const lines = formatHashBlock('abcdef');

      expect(warnSpy).toHaveBeenCalled();
      // Fallback de una sola línea (string crudo).
      expect(lines).toEqual(['abcdef']);
    });

    it('hash vacío → fallback retorna [] sin crashear (warning logueado)', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const lines = formatHashBlock('');
      expect(warnSpy).toHaveBeenCalled();
      expect(lines).toEqual([]);
    });

    it('hash uppercase no es válido (contrato es lowercase hex)', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const uppercase = 'A3F5C8D1B2E4F6A8C9D0E1F2A3B4C5D6E7F8A9B0C1D2E3F4A5B6C7D8E9F0A1B2';
      const lines = formatHashBlock(uppercase);
      expect(warnSpy).toHaveBeenCalled();
      // Fallback es una línea con el string crudo.
      expect(lines).toEqual([uppercase]);
    });
  });

  describe('render — datos del ack', () => {
    beforeEach(() => {
      fixture = TestBed.createComponent(SubmissionReceiptModalComponent);
      component = fixture.componentInstance;
      component.ack = ack();
      fixture.detectChanges();
    });

    // Scenario "Modal renderiza datos del ack" del spec exam-marking.
    it('renderiza título "Envío exitoso" en el dialog', () => {
      const title = fixture.nativeElement.querySelector('#receipt-modal-title') as HTMLElement;
      expect(title).not.toBeNull();
      expect(title.textContent).toContain('Envío exitoso');
    });

    it('renderiza subtítulo que contiene "Pendiente de calificación"', () => {
      const subtitle = fixture.nativeElement.querySelector(
        '#receipt-modal-subtitle',
      ) as HTMLElement;
      expect(subtitle).not.toBeNull();
      expect(subtitle.textContent).toContain('Pendiente de calificación');
    });

    it('renderiza la hora del servidor — método `formattedSubmittedAt` produce "HH:MM — DD mmm YYYY"', () => {
      // El método aplica timezone local del navegador; verificamos shape, no
      // valor literal (jsdom timezone puede variar entre máquinas).
      const formatted = component.formattedSubmittedAt();
      // "HH:MM — DD mmm YYYY" — mes en español abreviado.
      expect(formatted).toMatch(/^\d{2}:\d{2} — \d{2} [a-z]{3} \d{4}$/);
    });

    it('renderiza el hash en 4 líneas de 4 grupos de 4 chars', () => {
      const lines = fixture.nativeElement.querySelectorAll('.hash-block__line');
      expect(lines.length).toBe(4);
      const texts = Array.from(lines).map((el) => (el as HTMLElement).textContent?.trim());
      expect(texts).toEqual([
        'a3f5 c8d1 b2e4 f6a8',
        'c9d0 e1f2 a3b4 c5d6',
        'e7f8 a9b0 c1d2 e3f4',
        'a5b6 c7d8 e9f0 a1b2',
      ]);
    });

    it('renderiza un único botón "Volver al inicio"', () => {
      const button = fixture.nativeElement.querySelector(
        'button.modal__btn-primary',
      ) as HTMLButtonElement;
      expect(button).not.toBeNull();
      expect(button.textContent).toContain('Volver al inicio');
    });
  });

  describe('output `closed` — emite al tocar el botón', () => {
    beforeEach(() => {
      fixture = TestBed.createComponent(SubmissionReceiptModalComponent);
      component = fixture.componentInstance;
      component.ack = ack();
      fixture.detectChanges();
    });

    // Scenario "Modal emite close al tocar el botón" del spec exam-marking.
    // NOTAR: el output se llama `closed` (no `close`) por la regla ESLint
    // `no-output-native` que prohíbe nombres colisionando con eventos DOM.
    it('al click en "Volver al inicio" emite `closed` (sin payload)', () => {
      const emissions: void[] = [];
      component.closed.subscribe(() => emissions.push(undefined));

      const button = fixture.nativeElement.querySelector(
        'button.modal__btn-primary',
      ) as HTMLButtonElement;
      button.click();

      expect(emissions.length).toBe(1);
    });
  });

  describe('defensa contra ack con hash de longitud inválida', () => {
    // El VO valida shape al construir, pero el helper del componente
    // tiene defensa en profundidad: si por algún motivo llegara un ack
    // con shape "raro" (no debería, pero el componente debe renderizar
    // algo en vez de crashear).
    it('renderiza fallback de 1 línea cuando hashLines() recibe hash inválido', () => {
      // Construimos el componente sin pasar por el VO: simulamos shape
      // corrupta inyectando un objeto con campos compatibles.
      fixture = TestBed.createComponent(SubmissionReceiptModalComponent);
      component = fixture.componentInstance;
      // Bypass del VO — escenario defensivo.
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      component.ack = {
        id: 'ack-bad',
        submissionHash: 'abcdef',
        submittedAt: new Date('2026-06-17T15:00:00.000Z'),
      } as unknown as SubmissionAck;
      fixture.detectChanges();

      const lines = fixture.nativeElement.querySelectorAll('.hash-block__line');
      // Una sola línea con el hash crudo + warning logueado.
      expect(lines.length).toBe(1);
      expect((lines[0] as HTMLElement).textContent?.trim()).toBe('abcdef');
      expect(warnSpy).toHaveBeenCalled();
    });
  });
});
