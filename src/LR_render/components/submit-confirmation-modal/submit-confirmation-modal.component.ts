import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  computed,
  signal,
} from '@angular/core';
import { AlternativaValue, AnswersMap } from '../../../L1_domain/ports/markings-storage';
import { AdmissionArea } from '../../../L1_domain/value-objects/admission-area';

// Modal de confirmación previo al envío. Espejo visual del recibo
// (`SubmissionReceiptModalComponent`) — mismo overlay/blur/pop-in — pero acá
// el usuario puede cancelar. El body es una mini-cartilla read-only: cada
// fila muestra número de pregunta + burbujas A–E con la marcada resaltada.
// Si la pregunta no fue marcada, la fila entera queda apagada y aparece un
// hint "sin marcar" al costado.
//
// El componente NO conoce el submit real: emite `cancelar` (cerrar sin enviar)
// y `confirmar` (el usuario decidió mandar). La página traduce esos eventos a
// llamadas al view-model.
@Component({
  selector: 'app-submit-confirmation-modal',
  standalone: true,
  templateUrl: './submit-confirmation-modal.component.html',
  styleUrl: './submit-confirmation-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SubmitConfirmationModalComponent implements AfterViewInit {
  // Setter → signal para poder derivar `marcadasCount` etc. sin depender de
  // que Angular invalide el CD manualmente. Espejo del patrón del picker.
  private readonly _preguntas = signal<readonly number[]>([]);
  @Input({ required: true })
  set preguntas(value: readonly number[]) {
    this._preguntas.set(value);
  }

  private readonly _marcaciones = signal<AnswersMap>({});
  @Input({ required: true })
  set marcaciones(value: AnswersMap) {
    this._marcaciones.set(value);
  }

  // Área de POSTULACIÓN elegida para este examen. Se muestra destacada
  // arriba del resumen. `null` = no elegida (edge case: solo pasa cuando
  // el modal se abre con el gate activo, situación que en el flujo real
  // no debería ocurrir porque needsAreaSelection bloquea el botón Enviar).
  private readonly _admissionArea = signal<AdmissionArea | null>(null);
  @Input()
  set admissionArea(value: AdmissionArea | null | undefined) {
    this._admissionArea.set(value ?? null);
  }

  @Output() readonly cancelar = new EventEmitter<void>();
  @Output() readonly confirmar = new EventEmitter<void>();

  @ViewChild('cancelButton') private readonly cancelButton?: ElementRef<HTMLButtonElement>;

  protected readonly admissionAreaSig = computed(() => this._admissionArea());

  // Total marcadas: preguntas con letra distinta de null. Barato — se recalcula
  // solo cuando `marcaciones` cambia (input estable durante la vida del modal
  // en la práctica; el user no puede editar mientras el modal está abierto).
  protected readonly marcadasCount = computed(() => {
    const map = this._marcaciones();
    let n = 0;
    for (const letra of Object.values(map)) {
      if (letra !== null) n++;
    }
    return n;
  });

  protected readonly totalCount = computed(() => this._preguntas().length);

  protected readonly sinMarcarCount = computed(() => this.totalCount() - this.marcadasCount());

  // Warning fuerte cuando el alumno intenta enviar cartilla vacía. Cambia el
  // copy del subtítulo y el label del botón primario. Sigue permitido enviar
  // (el alumno puede tener razones), pero el UI comunica el peso de la acción.
  protected readonly cartillaVacia = computed(() => this.marcadasCount() === 0);

  // Getter reactivo del template. Nombre distinto del setter `preguntas` para
  // evitar colisión de identificador con `@Input() set preguntas(...)`.
  protected readonly preguntasList = computed(() => this._preguntas());

  ngAfterViewInit(): void {
    // Foco por defecto en "Volver a la cartilla" — la acción reversible es
    // la que gana el enter/space accidental. El primario (Enviar) requiere
    // click deliberado.
    queueMicrotask(() => this.cancelButton?.nativeElement.focus());
  }

  // Letra marcada para una pregunta, o null si no hay marca. Con `null` el
  // chip renderiza "—" en tono de warning para que salte visualmente.
  protected letraDe(pregunta: number): AlternativaValue {
    return this._marcaciones()[String(pregunta)] ?? null;
  }

  protected isSinMarcar(pregunta: number): boolean {
    return this.letraDe(pregunta) === null;
  }

  // Handler wrappers para no pasar el event object directamente a los
  // outputs. También sirven de anchor si en el futuro sumamos telemetría.
  protected onCancelarClick(): void {
    this.cancelar.emit();
  }

  protected onConfirmarClick(): void {
    this.confirmar.emit();
  }

  // Nº formateado con leading zero para alinear vertical: "01", "02", ..., "99".
  protected preguntaLabel(pregunta: number): string {
    return pregunta.toString().padStart(2, '0');
  }
}
