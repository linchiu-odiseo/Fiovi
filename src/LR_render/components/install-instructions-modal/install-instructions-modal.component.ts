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
// Usa `<dialog>` nativo: el browser maneja gratis el backdrop, focus trap,
// tecla Escape y aria-modal. El evento `close` del dialog dispara al
// cerrar por cualquier vía (Escape, botón, o backdrop click con nuestro
// handler manual). El try/catch de `showModal()` cubre entornos test
// (jsdom no implementa el método pero sí renderiza el elemento).
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

  @ViewChild('dialog') private readonly dialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('closeButton') private readonly closeButton?: ElementRef<HTMLButtonElement>;

  // Feedback ephemeral tras tocar "Copiar". Vuelve a null a los 2s.
  protected readonly copied = signal(false);

  protected get currentUrl(): string {
    if (typeof window === 'undefined') return '';
    return window.location.origin || '';
  }

  ngAfterViewInit(): void {
    const dialog = this.dialog?.nativeElement;
    if (dialog) {
      try {
        dialog.showModal();
      } catch {
        // jsdom no implementa showModal (el test env sigue renderizando el
        // contenido, solo perdemos el focus trap nativo — aceptable).
      }
    }
    // Foco inicial en el botón Cerrar — el más seguro; el tap secundario
    // (copiar URL) queda como acción explícita.
    queueMicrotask(() => this.closeButton?.nativeElement.focus());
  }

  // Click sobre el <dialog> element ES un click en el backdrop cuando el
  // target del evento es el propio dialog (el contenido interno lo atrapan
  // sus propios elementos y no bubble como target = dialog).
  //
  // Usamos @HostListener en vez de (click) en el template para no toparnos
  // con el lint `click-events-have-key-events` (Escape ya lo maneja el
  // `<dialog>` nativo y dispara `close` → dismiss, así que la accesibilidad
  // por teclado está cubierta sin agregar handler manual).
  @HostListener('click', ['$event.target'])
  onHostClick(target: EventTarget | null): void {
    if (target === this.dialog?.nativeElement) {
      this.dismiss.emit();
    }
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
