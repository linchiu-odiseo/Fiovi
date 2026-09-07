import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output,
  ViewChild,
} from '@angular/core';

export type SupportModalState = 'confirm' | 'sending' | 'ok' | 'empty' | 'error';

// Confirmación para enviar el registro de actividad a soporte, y resultado
// del envío.
//
// Es una acción del alumno sobre sus propios datos, así que se pide
// confirmación explícita en vez de mandarlo con un solo toque.
@Component({
  selector: 'app-support-logs-modal',
  standalone: true,
  templateUrl: './support-logs-modal.component.html',
  styleUrl: './support-logs-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SupportLogsModalComponent implements AfterViewInit {
  // Minutos que faltan para poder volver a enviar. 0 = se puede enviar ahora.
  @Input() cooldownMinutes = 0;

  // El modal no se cierra al enviar: se queda mostrando el resultado. El
  // alumno vino acá porque algo no le funcionaba — cerrarle la ventana sin
  // decirle si llegó o no sería dejarlo igual de a ciegas que antes.
  @Input() state: SupportModalState = 'confirm';

  @Output() readonly dismiss = new EventEmitter<void>();
  @Output() readonly accept = new EventEmitter<void>();

  @ViewChild('primaryButton') private readonly primaryButton?: ElementRef<HTMLButtonElement>;

  ngAfterViewInit(): void {
    queueMicrotask(() => this.primaryButton?.nativeElement.focus());
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.dismiss.emit();
  }
}
