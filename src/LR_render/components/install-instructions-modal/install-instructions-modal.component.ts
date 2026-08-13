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
  signal,
} from '@angular/core';

// Modo del modal — matchea 1:1 los kinds no-nativos de `InstallCardState`.
// `nativePrompt` no usa este modal (dispara el diálogo del browser).
// `hidden` tampoco (el modal no se abre).
export type InstallInstructionsMode = 'iosInstructions' | 'iosOtherBrowser' | 'webviewFallback';

// Modal con instrucciones para instalar Fiovi cuando el flow 1-tap nativo
// no está disponible: iOS Safari (Compartir → Añadir a pantalla), iOS
// no-Safari (redirigir a Safari), o browser embebido en apps (redirigir
// al navegador principal).
//
// Sigue el patrón visual del `UpdateConfirmModalComponent`: overlay
// oscurecido + card centrada. La `X` cierra sin persistir estado — el
// card en /home sigue tentando en la próxima visita.
@Component({
  selector: 'app-install-instructions-modal',
  standalone: true,
  templateUrl: './install-instructions-modal.component.html',
  styleUrl: './install-instructions-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InstallInstructionsModalComponent implements AfterViewInit {
  @Input({ required: true }) mode!: InstallInstructionsMode;

  @Output() readonly dismiss = new EventEmitter<void>();

  @ViewChild('closeButton') private readonly closeButton?: ElementRef<HTMLButtonElement>;

  // Feedback ephemeral tras tocar "Copiar". Vuelve a null a los 2s.
  protected readonly copied = signal(false);

  protected get currentUrl(): string {
    if (typeof window === 'undefined') return '';
    return window.location.origin || '';
  }

  ngAfterViewInit(): void {
    // Foco inicial en el botón Cerrar — el más seguro; el tap secundario
    // (copiar URL) queda como acción explícita.
    queueMicrotask(() => this.closeButton?.nativeElement.focus());
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.dismiss.emit();
  }

  async onCopyUrl(): Promise<void> {
    const url = this.currentUrl;
    if (url.length === 0) return;
    try {
      await navigator.clipboard.writeText(url);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      // Clipboard API bloqueada (permissions, http, browser viejo). Sin
      // fallback UI-heavy — el user puede seleccionar el texto manual.
    }
  }
}
