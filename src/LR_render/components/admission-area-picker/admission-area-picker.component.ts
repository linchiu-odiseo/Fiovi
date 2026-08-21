import {
  ChangeDetectionStrategy,
  Component,
  computed,
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
  // `null` cuando el alumno todavía no eligió (EXAMEN con subset restrictivo
  // gateado por el page). El pill nunca se muestra en ese caso porque el page
  // pasa `forceOpen=true` — el fallback del template ("Selecciona tu área") es
  // defensa por si algún caller olvidara el gate.
  @Input({ required: true }) admissionArea!: AdmissionArea | null;

  // Subset opcional del back (snapshot al CREATE del examen desde learnex).
  // `null`/`undefined` (FICHAS y legacy) → picker renderiza las 16 conocidas
  // por default. Array → picker renderiza EXACTAMENTE esos strings en ese
  // orden (learnex ordena por `ExamStructureArea.order asc`). Los strings
  // pueden estar fuera del set `KnownAdmissionArea` — el back es autoridad.
  // Se usa setter para poder disparar el computed sin depender de signals
  // en el input (mantiene contrato del componente).
  private readonly _allowedAreas = signal<readonly string[] | null>(null);
  @Input()
  set allowedAreas(value: readonly string[] | null | undefined) {
    this._allowedAreas.set(value ?? null);
  }

  // Modo "gate": cuando true, el pill queda oculto y el grid se muestra
  // siempre expandido sin posibilidad de colapsar hasta que el caller apague
  // el flag. El page lo prende cuando el alumno debe elegir su área antes de
  // ver la cartilla (EXAMEN con subset restrictivo y sin selección válida).
  protected readonly forceOpenSig = signal(false);
  @Input()
  set forceOpen(value: boolean) {
    this.forceOpenSig.set(value);
  }

  @Output() readonly seleccion = new EventEmitter<AdmissionArea>();

  // false = colapsado (pill), true = expandido (grid 3×6).
  readonly expanded = signal(false);

  // Vista efectiva: forceOpen gana sobre el estado local. Cuando el gate se
  // apaga (alumno eligió → view-model actualiza needsAreaSelection → page
  // apaga forceOpen), el picker vuelve al valor local de `expanded`, que en
  // ese momento es false por el `onChipClick`.
  protected readonly displayExpanded = computed(() => this.forceOpenSig() || this.expanded());

  // Lista efectiva para el @for del grid:
  //   - Sin restricción del back → `ADMISSION_AREAS` (16 conocidas, orden VO,
  //     GENERAL con span-3). Comportamiento heredado.
  //   - Con restricción → el array del back tal cual (orden respetado). Si
  //     `GENERAL` no está en el subset, ningún chip aplica span-3 y el grid
  //     se adapta natural.
  protected readonly visibleAreas = computed<readonly string[]>(() => {
    const allowed = this._allowedAreas();
    return allowed === null ? ADMISSION_AREAS : allowed;
  });

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

  protected onChipClick(area: string): void {
    this.seleccion.emit(area);
    // Colapsa el estado local siempre. Si el gate `forceOpen` sigue prendido
    // (edge case donde el caller no lo apaga en el mismo ciclo), `displayExpanded`
    // se mantiene true por el OR y el grid sigue visible — comportamiento correcto.
    this.expanded.set(false);
  }
}
