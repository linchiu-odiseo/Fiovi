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

// Confirmación para enviar el registro de actividad a soporte.
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
