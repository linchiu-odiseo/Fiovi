// Tests del adapter L3 `CloudflareTurnstileProvider`.
//
// El adapter consume dos APIs de browser:
//   - `document.head.appendChild(script)` para cargar el SDK de Cloudflare.
//   - `window.turnstile.{render,reset}` para interactuar con el widget.
//
// En jsdom no podemos cargar el script real; pre-poblamos `window.turnstile`
// con un mock antes de llamar `render()`, así `ensureScriptLoaded()` detecta
// que la API ya está y resuelve sin insertar el `<script>`. Los tests que
// verifican el path de carga dinámica simulan el `load` event manualmente.
//
// El `environment` se stubea con `vi.mock` para poder alternar entre
// `isEnabled()` true/false sin tocar `.env`.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CloudflareTurnstileProvider } from '../../../../src/L3_periphery/captcha/cloudflare-turnstile-provider';
import { environment } from '../../../../src/environments/environment';

// El adapter lee `environment.captcha*` en el field initializer del constructor.
// Mutamos el objeto en beforeEach + reconstruimos el provider en cada test que
// necesita una config distinta. `vi.mock` no funciona en el Angular unit-test
// system para imports relativos, así que la mutación directa es la única vía.
interface MutableEnv {
  captchaProvider: string;
  captchaSiteKey: string;
}
const originalEnv = {
  captchaProvider: environment.captchaProvider,
  captchaSiteKey: environment.captchaSiteKey,
};

// Restaura `window.turnstile` y quita cualquier <script> insertado entre tests.
function cleanupDom(): void {
  const w = window as unknown as { turnstile?: unknown };
  delete w.turnstile;
  document
    .querySelectorAll('script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]')
    .forEach((el) => el.remove());
}

// Setea `window.turnstile` con un mock parcial. El tipado de `TurnstileApi`
// requiere `remove/getResponse/isExpired`; el adapter solo usa `render/reset`,
// así que en tests casteamos por unknown para evitar completar métodos no usados.
function stubTurnstile(stub: { render: unknown; reset: unknown }): void {
  (window as unknown as { turnstile: unknown }).turnstile = stub;
}

describe('CloudflareTurnstileProvider', () => {
  let provider: CloudflareTurnstileProvider;

  beforeEach(() => {
    (environment as MutableEnv).captchaProvider = 'turnstile';
    (environment as MutableEnv).captchaSiteKey = 'test-site-key';
    cleanupDom();
    provider = new CloudflareTurnstileProvider();
  });

  afterEach(() => {
    cleanupDom();
    (environment as MutableEnv).captchaProvider = originalEnv.captchaProvider;
    (environment as MutableEnv).captchaSiteKey = originalEnv.captchaSiteKey;
  });

  describe('isEnabled', () => {
    it('devuelve true cuando provider="turnstile" y siteKey tiene valor', () => {
      expect(provider.isEnabled()).toBe(true);
    });

    it('devuelve false cuando siteKey está vacío (dev sin fricción)', () => {
      (environment as MutableEnv).captchaSiteKey = '';
      const p = new CloudflareTurnstileProvider();
      expect(p.isEnabled()).toBe(false);
    });

    it('devuelve false cuando provider != "turnstile"', () => {
      (environment as MutableEnv).captchaProvider = '';
      const p = new CloudflareTurnstileProvider();
      expect(p.isEnabled()).toBe(false);
    });
  });

  describe('render', () => {
    it('lanza si se llama con el provider deshabilitado', async () => {
      (environment as MutableEnv).captchaSiteKey = '';
      const p = new CloudflareTurnstileProvider();
      const container = document.createElement('div');
      await expect(
        p.render(container, {
          onToken: vi.fn(),
          onExpired: vi.fn(),
          onError: vi.fn(),
        }),
      ).rejects.toThrow(/disabled/);
    });

    it('llama a window.turnstile.render con siteKey del environment y sin overrides visuales', async () => {
      const renderSpy = vi.fn().mockReturnValue('widget-1');
      stubTurnstile({ render: renderSpy, reset: vi.fn() });
      const container = document.createElement('div');
      const callbacks = {
        onToken: vi.fn(),
        onExpired: vi.fn(),
        onError: vi.fn(),
      };

      const widgetId = await provider.render(container, callbacks);

      expect(widgetId).toBe('widget-1');
      expect(renderSpy).toHaveBeenCalledTimes(1);
      const [el, params] = renderSpy.mock.calls[0];
      expect(el).toBe(container);
      expect(params.sitekey).toBe('test-site-key');
      // La modalidad la decide el panel de Cloudflare — el cliente NO debe
      // pasar `size`/`theme`/`appearance`. Forzar `size: 'invisible'` cuando
      // el panel está en `managed` deja el widget sin emitir token.
      expect(params.size).toBeUndefined();
      expect(params.theme).toBeUndefined();
      expect(params.appearance).toBeUndefined();
    });

    it('propaga token de Turnstile a onToken', async () => {
      const renderSpy = vi.fn().mockImplementation((_el, params) => {
        params.callback('token-abc');
        return 'widget-1';
      });
      stubTurnstile({ render: renderSpy, reset: vi.fn() });
      const onToken = vi.fn();
      await provider.render(document.createElement('div'), {
        onToken,
        onExpired: vi.fn(),
        onError: vi.fn(),
      });
      expect(onToken).toHaveBeenCalledWith('token-abc');
    });

    it('mapea expired-callback y error-callback a onExpired/onError', async () => {
      let capturedParams: {
        'expired-callback': () => void;
        'error-callback': () => void;
      } | null = null;
      const renderSpy = vi.fn().mockImplementation((_el, params) => {
        capturedParams = params;
        return 'widget-1';
      });
      stubTurnstile({ render: renderSpy, reset: vi.fn() });
      const onExpired = vi.fn();
      const onError = vi.fn();
      await provider.render(document.createElement('div'), {
        onToken: vi.fn(),
        onExpired,
        onError,
      });

      capturedParams!['expired-callback']();
      capturedParams!['error-callback']();
      expect(onExpired).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledTimes(1);
    });
  });

  describe('reset', () => {
    it('llama window.turnstile.reset con el widgetId', async () => {
      const resetSpy = vi.fn();
      stubTurnstile({ render: vi.fn().mockReturnValue('widget-abc'), reset: resetSpy });
      const widgetId = await provider.render(document.createElement('div'), {
        onToken: vi.fn(),
        onExpired: vi.fn(),
        onError: vi.fn(),
      });
      provider.reset(widgetId);
      expect(resetSpy).toHaveBeenCalledWith('widget-abc');
    });

    it('es no-op si window.turnstile no está disponible (script no cargó)', () => {
      // Sin turnstile en window, reset no debería tirar — el widget nunca se
      // renderizó, y limpiar un id fantasma no es un error.
      expect(() => provider.reset('never-rendered')).not.toThrow();
    });
  });

  describe('ensureScriptLoaded (lazy script load)', () => {
    it('resuelve inmediatamente si window.turnstile ya existe', async () => {
      stubTurnstile({ render: vi.fn().mockReturnValue('w1'), reset: vi.fn() });
      await provider.render(document.createElement('div'), {
        onToken: vi.fn(),
        onExpired: vi.fn(),
        onError: vi.fn(),
      });
      // Si el script se hubiera insertado, habría un <script> tag. Verificamos
      // que NO se insertó porque window.turnstile ya estaba.
      const scripts = document.querySelectorAll(
        'script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]',
      );
      expect(scripts.length).toBe(0);
    });

    it('inserta <script> exactamente una vez aunque render() se llame en paralelo', async () => {
      // Sin window.turnstile pre-poblado, el adapter debe insertar el script.
      // Disparamos load event manualmente después de poblar window.turnstile.
      const renderCall = provider
        .render(document.createElement('div'), {
          onToken: vi.fn(),
          onExpired: vi.fn(),
          onError: vi.fn(),
        })
        .catch(() => {
          /* podría rechazar por window.turnstile faltante — no importa acá */
        });
      const renderCall2 = provider
        .render(document.createElement('div'), {
          onToken: vi.fn(),
          onExpired: vi.fn(),
          onError: vi.fn(),
        })
        .catch(() => {
          /* idem */
        });

      // Esperar un microtask para que el script se agregue al DOM.
      await Promise.resolve();

      const scripts = document.querySelectorAll(
        'script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]',
      );
      expect(scripts.length).toBe(1);

      // Rechazar limpiamente para no dejar promesas colgando.
      delete (window as unknown as { turnstile?: unknown }).turnstile;
      scripts[0].dispatchEvent(new Event('error'));
      await Promise.allSettled([renderCall, renderCall2]);
    });
  });
});
