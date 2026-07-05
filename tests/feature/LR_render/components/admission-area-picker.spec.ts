import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { AdmissionAreaPickerComponent } from '../../../../src/LR_render/components/admission-area-picker/admission-area-picker.component';
import {
  ADMISSION_AREAS,
  AdmissionArea,
} from '../../../../src/L1_domain/value-objects/admission-area';

// Cubre `<app-admission-area-picker>` (LR) según los scenarios del spec
// `admission-area` Requirement "AdmissionAreaPickerComponent con dos estados":
// - Estado colapsado por defecto renderiza pill con el valor actual.
// - Long-press ≥500ms sobre el pill sin movimiento expande el grid.
// - Movimiento >10px durante el long-press cancela.
// - Tap sobre un chip emite `seleccion` y colapsa.
// - Chip actual tiene `--selected`; `GENERAL` tiene `--wide-3`.
// - Los 16 chips renderizan en orden.
describe('AdmissionAreaPickerComponent', () => {
  let fixture: ComponentFixture<AdmissionAreaPickerComponent>;
  let component: AdmissionAreaPickerComponent;

  // jsdom no expone `PointerEvent` en algunas versiones (Vitest+jsdom).
  // Usamos MouseEvent con clientX/clientY — Angular no distingue en el
  // handler porque solo lee esas dos props del evento. bubbles=true para
  // que llegue al binding del template si hiciera falta.
  const pointer = (type: string, x: number, y: number): Event =>
    new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });

  const mount = (area: AdmissionArea): void => {
    fixture = TestBed.createComponent(AdmissionAreaPickerComponent);
    component = fixture.componentInstance;
    component.admissionArea = area;
    fixture.detectChanges();
  };

  const getPill = (): HTMLButtonElement =>
    fixture.nativeElement.querySelector('.area-summary__pill') as HTMLButtonElement;

  const getGrid = (): HTMLElement | null =>
    fixture.nativeElement.querySelector('.area-picker__grid') as HTMLElement | null;

  const getChips = (): HTMLButtonElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('.area-chip')) as HTMLButtonElement[];

  // Dispara el long-press completo: pointerdown en (0,0), avanza los 500ms,
  // procesa el timer, aplica detectChanges para que el @if(expanded()) se
  // re-renderice.
  const doLongPress = (): void => {
    const pill = getPill();
    pill.dispatchEvent(pointer('pointerdown', 0, 0));
    vi.advanceTimersByTime(500);
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdmissionAreaPickerComponent],
    }).compileComponents();
  });

  afterEach(() => {
    // Siempre restaurar timers reales para no contaminar siguientes tests.
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('estado colapsado por defecto', () => {
    // Scenario "Estado colapsado renderiza pill con valor actual".
    it('con admissionArea="MAT" renderiza el pill con "MAT" y sin grid', () => {
      mount('MAT');

      const pill = getPill();
      expect(pill).not.toBeNull();
      expect(pill.textContent?.trim()).toBe('MAT');
      expect(getGrid()).toBeNull();
      // La sección editing tampoco debe estar montada.
      expect(fixture.nativeElement.querySelector('.area-picker--editing')).toBeNull();
    });

    it('con admissionArea="GENERAL" el pill muestra "GENERAL" (sin shortcuts)', () => {
      mount('GENERAL');

      const pill = getPill();
      // El texto se renderiza tal cual, no como "G" ni "Gen".
      expect(pill.textContent?.trim()).toBe('GENERAL');
    });
  });

  describe('long-press sobre el pill', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      mount('MAT');
    });

    // Scenario "Long-press sobre pill expande a grid".
    it('500ms sin movimiento expande el grid con 16 chips', () => {
      expect(getGrid()).toBeNull();

      doLongPress();

      const grid = getGrid();
      expect(grid).not.toBeNull();
      expect(getChips()).toHaveLength(16);
    });

    // Scenario "Movimiento >10px durante long-press cancela".
    it('movimiento >10px antes de los 500ms cancela — grid NO aparece', () => {
      const pill = getPill();
      pill.dispatchEvent(pointer('pointerdown', 0, 0));
      // Movimiento de +11px en X (excede el threshold de 10).
      pill.dispatchEvent(pointer('pointermove', 11, 0));
      vi.advanceTimersByTime(500);
      fixture.detectChanges();

      expect(getGrid()).toBeNull();
    });

    it('movimiento ≤10px durante long-press NO cancela — grid SÍ aparece', () => {
      const pill = getPill();
      pill.dispatchEvent(pointer('pointerdown', 0, 0));
      // Movimiento de +9px en X (dentro del threshold).
      pill.dispatchEvent(pointer('pointermove', 9, 0));
      vi.advanceTimersByTime(500);
      fixture.detectChanges();

      expect(getGrid()).not.toBeNull();
    });

    it('pointer up antes del threshold cancela — grid NO aparece', () => {
      const pill = getPill();
      pill.dispatchEvent(pointer('pointerdown', 0, 0));
      // A los 300ms el alumno suelta.
      vi.advanceTimersByTime(300);
      pill.dispatchEvent(pointer('pointerup', 0, 0));
      // Aún si dejamos correr los 200ms restantes, el timer ya se canceló.
      vi.advanceTimersByTime(200);
      fixture.detectChanges();

      expect(getGrid()).toBeNull();
    });
  });

  describe('grid expandido — chips', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    // Scenario "Tap sobre chip emite `seleccion` y colapsa".
    it('tap sobre chip "A" emite `seleccion("A")` una vez y colapsa el grid', () => {
      mount('GENERAL');
      doLongPress();

      const emissions: AdmissionArea[] = [];
      component.seleccion.subscribe((area) => emissions.push(area));

      // Buscamos el chip por su texto exacto para no depender del orden.
      const chipA = getChips().find((c) => c.textContent?.trim() === 'A');
      expect(chipA).toBeDefined();
      chipA!.click();
      fixture.detectChanges();

      expect(emissions).toEqual(['A']);
      // Post-click el grid debe estar desmontado.
      expect(getGrid()).toBeNull();
    });

    // Scenario "Estado colapsado renderiza pill con valor actual" (parte visual
    // del expandido) — chip actual tiene `--selected`.
    it('el chip cuyo valor coincide con admissionArea tiene la clase --selected (y ningún otro)', () => {
      mount('MAT');
      doLongPress();

      const chips = getChips();
      const selected = chips.filter((c) => c.classList.contains('area-chip--selected'));
      expect(selected).toHaveLength(1);
      expect(selected[0].textContent?.trim()).toBe('MAT');
    });

    // Scenario "`GENERAL` ocupa 3 columnas en el grid".
    it('el chip GENERAL tiene la clase --wide-3 (y ningún otro)', () => {
      mount('MAT');
      doLongPress();

      const chips = getChips();
      const wide = chips.filter((c) => c.classList.contains('area-chip--wide-3'));
      expect(wide).toHaveLength(1);
      expect(wide[0].textContent?.trim()).toBe('GENERAL');
    });

    it('renderiza los 16 chips en el orden de ADMISSION_AREAS', () => {
      mount('MAT');
      doLongPress();

      const chips = getChips();
      expect(chips).toHaveLength(16);
      const labels = chips.map((c) => c.textContent?.trim());
      expect(labels).toEqual([...ADMISSION_AREAS]);
    });

    it('aria-checked es "true" en el chip actual y "false" en el resto', () => {
      mount('MAT');
      doLongPress();

      const chips = getChips();
      for (const chip of chips) {
        const isCurrent = chip.textContent?.trim() === 'MAT';
        expect(chip.getAttribute('aria-checked')).toBe(isCurrent ? 'true' : 'false');
      }
    });
  });
});
