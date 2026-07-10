import { Component, DestroyRef, inject } from '@angular/core';
import { AlternativaValue } from '../../../L1_domain/ports/markings-storage';
import { AdmissionArea } from '../../../L1_domain/value-objects/admission-area';
import { DemoSheetViewModel } from '../../view-models/demo-sheet.view-model';
import { AdmissionAreaPickerComponent } from '../../components/admission-area-picker/admission-area-picker.component';
import { SubmissionReceiptModalComponent } from '../../components/submission-receipt-modal/submission-receipt-modal.component';

const ALTERNATIVAS: readonly AlternativaValue[] = ['A', 'B', 'C', 'D', 'E'];

// Ver simulacro.page.ts para el racional de estos números; acá los duplicamos
// para no acoplar la demo a constantes internas del real.
const LONG_PRESS_DURATION_MS = 500;
const LONG_PRESS_MOVE_THRESHOLD_PX = 10;

// Página dev-only /demo-sheet. Espejo visual y de comportamiento de la
// cartilla real, pero contra un view-model en memoria (sin back, sin IDB).
// El submit produce un SubmissionAck falso que renderiza el mismo componente
// de recibo que usa la cartilla real — así la demo cubre el flujo entero.
@Component({
  selector: 'app-demo-sheet-page',
  templateUrl: './demo-sheet.page.html',
  styleUrl: './demo-sheet.page.scss',
  imports: [SubmissionReceiptModalComponent, AdmissionAreaPickerComponent],
  providers: [DemoSheetViewModel],
})
export class DemoSheetPage {
  private readonly destroyRef = inject(DestroyRef);
  protected readonly vm = inject(DemoSheetViewModel);

  protected readonly alternativas = ALTERNATIVAS;

  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressActivePregunta: number | null = null;
  private longPressStartX = 0;
  private longPressStartY = 0;
  private suppressNextClick = false;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.cancelLongPress();
      this.vm.stop();
    });
  }

  protected onBubbleClick(pregunta: number, letra: AlternativaValue): void {
    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      return;
    }
    this.vm.marcar(pregunta, letra);
  }

  protected isMarked(pregunta: number, letra: AlternativaValue): boolean {
    return this.vm.marcaciones()[String(pregunta)] === letra;
  }

  protected onRowPointerDown(pregunta: number, ev: PointerEvent): void {
    this.suppressNextClick = false;
    if (this.vm.rowState(pregunta) !== 'locked') return;
    this.cancelLongPress();
    this.longPressActivePregunta = pregunta;
    this.longPressStartX = ev.clientX;
    this.longPressStartY = ev.clientY;
    this.longPressTimer = setTimeout(() => {
      this.longPressTimer = null;
      if (this.longPressActivePregunta !== pregunta) return;
      if (this.vm.rowState(pregunta) !== 'locked') return;
      this.vm.enterEditing(pregunta);
      this.suppressNextClick = true;
    }, LONG_PRESS_DURATION_MS);
  }

  protected onRowPointerMove(ev: PointerEvent): void {
    if (this.longPressTimer === null) return;
    const dx = Math.abs(ev.clientX - this.longPressStartX);
    const dy = Math.abs(ev.clientY - this.longPressStartY);
    if (dx > LONG_PRESS_MOVE_THRESHOLD_PX || dy > LONG_PRESS_MOVE_THRESHOLD_PX) {
      this.cancelLongPress();
    }
  }

  protected onRowPointerUpOrCancel(): void {
    this.cancelLongPress();
  }

  private cancelLongPress(): void {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    this.longPressActivePregunta = null;
  }

  protected onVolverClick(): void {
    this.vm.volver();
  }

  protected onEnviarClick(): void {
    void this.vm.submit();
  }

  protected onDadoClick(): void {
    this.vm.marcarAleatorio();
  }

  protected onAdmissionAreaSeleccion(area: AdmissionArea): void {
    this.vm.seleccionarArea(area);
  }
}
