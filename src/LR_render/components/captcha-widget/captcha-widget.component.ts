import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Output,
  ViewChild,
  inject,
} from '@angular/core';
import { CaptchaWidgetId } from '../../../L1_domain/ports/captcha-provider';
import { CAPTCHA_PROVIDER } from '../../../L3_periphery/tokens';

// Wrapper Angular sobre el port `CaptchaProvider`.
//
// - Al montarse, si el provider está enabled, renderiza el widget dentro del
//   `<div #container>`. En modo invisible (Turnstile) no hay UI visible; el
//   contenedor queda vacío hasta que el proveedor inyecta su iframe.
// - Emite `tokenChange` con `string | null`:
//     - string  → token válido, el LoginPage puede habilitar el submit.
//     - null    → token expirado / error / reset — el LoginPage debe volver a
//                 deshabilitar el submit hasta el próximo token.
// - `reset()` es el hook que el LoginPage llama tras un login rechazado. Los
//   tokens de Turnstile son de un solo uso; sin reset, el próximo intento
//   viajaría con un token inválido y el server volvería a rechazar.
@Component({
  selector: 'app-captcha-widget',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div
    #container
    class="captcha-widget"
    data-testid="captcha-widget-container"
    aria-hidden="true"
  ></div>`,
  styles: [
    `
      :host {
        display: block;
      }
      .captcha-widget {
        display: flex;
        justify-content: center;
      }
    `,
  ],
})
export class CaptchaWidgetComponent implements AfterViewInit {
  private readonly provider = inject(CAPTCHA_PROVIDER);
  @ViewChild('container', { static: true })
  private readonly container!: ElementRef<HTMLElement>;
  @Output() readonly tokenChange = new EventEmitter<string | null>();

  private widgetId: CaptchaWidgetId | null = null;

  async ngAfterViewInit(): Promise<void> {
    if (!this.provider.isEnabled()) return;
    try {
      this.widgetId = await this.provider.render(this.container.nativeElement, {
        onToken: (token) => this.tokenChange.emit(token),
        onExpired: () => this.tokenChange.emit(null),
        onError: () => this.tokenChange.emit(null),
      });
    } catch (err) {
      console.warn('captcha widget render failed', err);
      this.tokenChange.emit(null);
    }
  }

  reset(): void {
    if (this.widgetId === null) return;
    this.provider.reset(this.widgetId);
    this.tokenChange.emit(null);
  }
}
