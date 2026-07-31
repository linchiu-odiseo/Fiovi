import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
  Input,
  Output,
} from '@angular/core';

@Component({
  selector: 'app-about-modal',
  standalone: true,
  templateUrl: './about-modal.component.html',
  styleUrl: './about-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AboutModalComponent {
  @Input({ required: true }) appVersion = '';

  @Output() readonly dismiss = new EventEmitter<void>();

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.dismiss.emit();
  }
}
