import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  signal,
} from '@angular/core';
import { ADMISSION_AREAS, AdmissionArea } from '../../../L1_domain/value-objects/admission-area';

// Duración mínima del press para que cuente como long-press. Estándar en
// gestos táctiles (Material, iOS): 500ms es lo que se siente "deliberado"
// sin sentirse "lento". Por debajo da falsos positivos con scroll/tap rápido.
//
// MANTENER SINCRONIZADO CON simulacro.page.ts:12 — si el proyecto extrae
// un LongPressDirective en el futuro, ambos lugares migran juntos.
// Ver design.md D5 de add-admission-area.
const LONG_PRESS_DURATION_MS = 500;

// Si el dedo se mueve más que esto antes de cumplirse el long-press, lo
// cancelamos: era scroll, no presión intencional. 10px en CSS pixels es
// suficiente para distinguir movimiento real de jitter del touchscreen.
//
// MANTENER SINCRONIZADO CON simulacro.page.ts:17.
const LONG_PRESS_MOVE_THRESHOLD_PX = 10;

// Picker del área de POSTULACIÓN del alumno. Dos estados mutuamente
// exclusivos:
//   - Colapsado (default): pill con el valor actual + long-press para
//     expandir. Es la vista "steady state" arriba de la grilla.
//   - Expandido: grid 3×6 de chips (16 opciones). GENERAL ocupa span-3 en
//     la fila 3 para cerrar la retícula. Tap en un chip emite `seleccion`
//     y colapsa.
//
// El componente NO persiste ni normaliza el input — solo refleja lo que
// recibe del view-model. La persistencia vive en
// `SeleccionarAdmissionAreaUseCase` (L2) invocado por el view-model.
@Component({
  selector: 'app-admission-area-picker',
  standalone: true,
  templateUrl: './admission-area-picker.component.html',
  styleUrl: './admission-area-picker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdmissionAreaPickerComponent {
  @Input({ required: true }) admissionArea!: AdmissionArea;

  @Output() readonly seleccion = new EventEmitter<AdmissionArea>();

  // false = colapsado (pill), true = expandido (grid 3×6).
  readonly expanded = signal(false);

  // Lista estable para el @for del grid. Orden de renderizado definido
  // por el VO (fila 1: A A1 B C D E; fila 2: I II III IV V G; fila 3:
  // APT CIE MAT GENERAL[span-3]).
  protected readonly areas: readonly AdmissionArea[] = ADMISSION_AREAS;

  // Estado del long-press en curso. Vivimos acá (no en signals) porque son
  // coordenadas puramente DOM y un timer imperativo — no hay razón para
  // exponerlas al template.
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressStartX = 0;
  private longPressStartY = 0;

  protected onPillPointerDown(ev: PointerEvent): void {
    this.cancelLongPress();
    this.longPressStartX = ev.clientX;
    this.longPressStartY = ev.clientY;
    this.longPressTimer = setTimeout(() => {
      this.longPressTimer = null;
      this.expanded.set(true);
    }, LONG_PRESS_DURATION_MS);
  }

  protected onPillPointerMove(ev: PointerEvent): void {
    if (this.longPressTimer === null) return;
    const dx = Math.abs(ev.clientX - this.longPressStartX);
    const dy = Math.abs(ev.clientY - this.longPressStartY);
    if (dx > LONG_PRESS_MOVE_THRESHOLD_PX || dy > LONG_PRESS_MOVE_THRESHOLD_PX) {
      this.cancelLongPress();
    }
  }

  protected onPillPointerUpOrCancel(): void {
    this.cancelLongPress();
  }

  private cancelLongPress(): void {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  protected onChipClick(area: AdmissionArea): void {
    this.seleccion.emit(area);
    this.expanded.set(false);
  }
}
