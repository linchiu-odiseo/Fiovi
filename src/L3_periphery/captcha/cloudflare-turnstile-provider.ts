import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import {
  CaptchaCallbacks,
  CaptchaContainer,
  CaptchaProvider,
  CaptchaWidgetId,
} from '../../L1_domain/ports/captcha-provider';

const TURNSTILE_SCRIPT_URL =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

// Adapter L3 del port `CaptchaProvider` para Cloudflare Turnstile.
//
// - `isEnabled()` es `false` cuando el provider no es `'turnstile'` o la site key
//   está vacía → el LoginPage skipea el widget completo y el login viaja sin
//   `captchaToken` (dev sin fricción; alineado con el server que, con
//   `CAPTCHA_SECRET` vacío, acepta requests sin captcha).
//
// - `render()` carga el script de Turnstile bajo demanda (una sola vez por
//   sesión) y llama `window.turnstile.render()` con `sitekey` + callbacks
//   solamente. **NO pasamos `size`/`theme`/`appearance`** — la modalidad la
//   configura el panel de Cloudflare por widget/site key (ver memoria
//   `turnstile-size-panel-managed`). Forzar `size: 'invisible'` desde el
//   cliente cuando el panel está en `managed` deja el widget sin emitir
//   token y bloquea el login.
//
// - `reset()` invalida el token previo. Los tokens de Turnstile son de un solo
//   uso y expiran a los 2 minutos; el consumer debe llamar `reset()` cada vez
//   que el servidor rechaza la request para permitir un nuevo intento.
@Injectable({ providedIn: 'root' })
export class CloudflareTurnstileProvider implements CaptchaProvider {
  private readonly siteKey = environment.captchaSiteKey ?? '';
  private readonly provider = environment.captchaProvider ?? '';
  private scriptPromise: Promise<void> | null = null;

  isEnabled(): boolean {
    return this.provider === 'turnstile' && this.siteKey.length > 0;
  }

  async render(container: CaptchaContainer, callbacks: CaptchaCallbacks): Promise<CaptchaWidgetId> {
    if (!this.isEnabled()) {
      throw new Error('CaptchaProvider.render() called while disabled');
    }
    await this.ensureScriptLoaded();
    const api = window.turnstile;
    if (!api) {
      throw new Error('Turnstile script loaded but window.turnstile is undefined');
    }
    const el = container as HTMLElement;
    return api.render(el, {
      sitekey: this.siteKey,
      callback: (token) => callbacks.onToken(token),
      'expired-callback': () => callbacks.onExpired(),
      'error-callback': () => callbacks.onError(),
    });
  }

  reset(widgetId: CaptchaWidgetId): void {
    const api = window.turnstile;
    if (!api) return;
    api.reset(widgetId);
  }

  private ensureScriptLoaded(): Promise<void> {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return Promise.reject(new Error('captcha not available in non-browser context'));
    }
    if (window.turnstile) {
      return Promise.resolve();
    }
    if (this.scriptPromise) {
      return this.scriptPromise;
    }
    this.scriptPromise = new Promise((resolve, reject) => {
      // Reutiliza el tag si otra instancia ya lo insertó (p. ej. hot reload).
      const existing = document.querySelector<HTMLScriptElement>(
        `script[src^="${TURNSTILE_SCRIPT_URL.split('?')[0]}"]`,
      );
      const script = existing ?? document.createElement('script');
      const attach = !existing;
      script.addEventListener(
        'load',
        () => {
          if (window.turnstile) {
            resolve();
          } else {
            this.scriptPromise = null;
            reject(new Error('turnstile script loaded but window.turnstile is undefined'));
          }
        },
        { once: true },
      );
      script.addEventListener(
        'error',
        () => {
          this.scriptPromise = null;
          reject(new Error('failed to load turnstile script'));
        },
        { once: true },
      );
      if (attach) {
        script.src = TURNSTILE_SCRIPT_URL;
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
    });
    return this.scriptPromise;
  }
}
