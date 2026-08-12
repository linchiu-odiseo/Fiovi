import { Component, DestroyRef, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AlternativaValue } from '../../../L1_domain/ports/markings-storage';
import { AdmissionArea } from '../../../L1_domain/value-objects/admission-area';
import { environment } from '../../../environments/environment';
import { SimulacroPageViewModel } from '../../view-models/simulacro.view-model';
import { SubmissionReceiptModalComponent } from '../../components/submission-receipt-modal/submission-receipt-modal.component';
import { AdmissionAreaPickerComponent } from '../../components/admission-area-picker/admission-area-picker.component';

const ALTERNATIVAS: readonly AlternativaValue[] = ['A', 'B', 'C', 'D', 'E'];

// Duración mínima del press para que cuente como long-press. Estándar en
// gestos táctiles (Material, iOS): 500ms es lo que se siente "deliberado"
// sin sentirse "lento". Por debajo da falsos positivos con scroll/tap rápido.
const LONG_PRESS_DURATION_MS = 500;

// Si el dedo se mueve más que esto antes de cumplirse el long-press, lo
// cancelamos: era scroll, no presión intencional. 10px en CSS pixels es
// suficiente para distinguir movimiento real de jitter del touchscreen.
const LONG_PRESS_MOVE_THRESHOLD_PX = 10;

@Component({
  selector: 'app-simulacro-page',
  templateUrl: './simulacro.page.html',
  styleUrl: './simulacro.page.scss',
  imports: [SubmissionReceiptModalComponent, AdmissionAreaPickerComponent],
  providers: [SimulacroPageViewModel],
})
export class SimulacroPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly vm = inject(SimulacroPageViewModel);

  protected readonly alternativas = ALTERNATIVAS;
  // Gate del botón dado (y otros atajos dev). Se lee de `environment.devTools`,
  // que `scripts/build-env.mjs` genera a partir de `DEV_TOOLS` en `.env`. El
  // flag NO depende de `production` porque el proyecto no configura
  // `fileReplacements` en angular.json — la única forma confiable de apagar
  // dev-tools en un build de release es setear `DEV_TOOLS=false` en `.env`
  // antes de correr `npm run build`.
  protected readonly isDev = environment.devTools;

  // Estado del long-press en curso. Vivimos en page (no en view-model)
  // porque depende de eventos puramente DOM (PointerEvent.clientX/Y); el
  // view-model no debería conocer coordenadas táctiles.
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressActivePregunta: number | null = null;
  private longPressStartX = 0;
  private longPressStartY = 0;

  // Suprime el `click` inmediatamente posterior a un long-press exitoso.
  // Si el dedo cayó sobre una burbuja durante el long-press y se levanta,
  // el navegador dispara `click` en esa burbuja. Sin esta supresión,
  // long-press en una burbuja entraría a edición Y aplicaría la marca en
  // el mismo gesto — confuso. Con el flag, el primer click post-long-press
  // se descarta y el alumno debe tocar deliberadamente para aplicar.
  private suppressNextClick = false;

  constructor() {
    // URL param sigue siendo `:id` (la ruta `/simulacro/:id` queda en español
    // según política de UI). Internamente lo llamamos `examId` para alinear
    // con el dominio post-learnex.
    const examId = this.route.snapshot.paramMap.get('id');
    if (examId === null || examId.trim().length === 0) {
      void this.router.navigate(['/home']);
      return;
    }
    void this.vm.start(examId);
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
    void this.vm.marcar(pregunta, letra);
  }

  protected isMarked(pregunta: number, letra: AlternativaValue): boolean {
    return this.vm.marcaciones()[String(pregunta)] === letra;
  }

  // Long-press handlers en la fila. Solo arman el timer si la fila está
  // `locked` — en `unmarked` el primer tap ya marca (no hay nada que
  // proteger) y en `editing` ya estamos en modo edición (long-press de
  // nuevo no hace nada útil).
  protected onRowPointerDown(pregunta: number, ev: PointerEvent): void {
    // Reset siempre: cada nueva presión arranca limpia. Si el alumno empezó
    // un long-press en otra fila y antes de cumplirse interrumpió tocando
    // acá, el flag de la anterior queda anulado.
    this.suppressNextClick = false;
    if (this.vm.rowState(pregunta) !== 'locked') return;

    this.cancelLongPress();
    this.longPressActivePregunta = pregunta;
    this.longPressStartX = ev.clientX;
    this.longPressStartY = ev.clientY;
    this.longPressTimer = setTimeout(() => {
      this.longPressTimer = null;
      if (this.longPressActivePregunta !== pregunta) return;
      // Confirmamos que la fila siga siendo `locked` en el momento de
      // dispararse — defensa contra cambios concurrentes (poco probables
      // pero el costo del chequeo es nulo).
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

  protected onIniciarTareaClick(): void {
    void this.vm.confirmHomeworkStart();
  }

  protected onEnviarClick(): void {
    void this.vm.submit();
  }

  protected onAdmissionAreaSeleccion(area: AdmissionArea): void {
    void this.vm.seleccionarArea(area);
  }

  protected onDadoClick(): void {
    void this.vm.marcarAleatorio();
  }
}
