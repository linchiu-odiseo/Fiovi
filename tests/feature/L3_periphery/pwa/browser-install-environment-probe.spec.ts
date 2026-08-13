import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserInstallEnvironmentProbe } from '../../../../src/L3_periphery/pwa/browser-install-environment-probe';

// Helper para stub el userAgent — jsdom permite reasignar `navigator.userAgent`
// via `Object.defineProperty` con configurable:true.
function setUserAgent(ua: string): void {
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    get: () => ua,
  });
}

// Helper para stub matchMedia — jsdom NO expone `window.matchMedia`, así que
// asignamos directo con `defineProperty` (spyOn falla sobre undefined).
function stubMatchMedia(matches: Partial<Record<string, boolean>>): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) =>
      ({
        matches: matches[query] ?? false,
        media: query,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
        onchange: null,
      }) as unknown as MediaQueryList,
  });
}

// Helper para forzar que matchMedia lance — para cubrir el catch defensivo
// del probe cuando el browser no soporta la API.
function stubMatchMediaThrowing(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () => {
      throw new Error('unsupported');
    },
  });
}

describe('BrowserInstallEnvironmentProbe', () => {
  let probe: BrowserInstallEnvironmentProbe;

  beforeEach(() => {
    probe = new BrowserInstallEnvironmentProbe();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Restaurar `navigator.standalone` si algún test lo seteó.
    delete (window.navigator as unknown as { standalone?: boolean }).standalone;
    // Limpiar matchMedia stub para no contaminar otros archivos de test.
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  });

  describe('isStandalone()', () => {
    it('false por default en jsdom (sin display-mode standalone)', () => {
      stubMatchMedia({});
      expect(probe.isStandalone()).toBe(false);
    });

    it('true si display-mode: standalone matchea', () => {
      stubMatchMedia({ '(display-mode: standalone)': true });
      expect(probe.isStandalone()).toBe(true);
    });

    it('true si iOS Safari reporta navigator.standalone = true', () => {
      stubMatchMedia({});
      (window.navigator as unknown as { standalone: boolean }).standalone = true;
      expect(probe.isStandalone()).toBe(true);
    });

    it('no crash si matchMedia lanza (entornos exóticos)', () => {
      stubMatchMediaThrowing();
      expect(() => probe.isStandalone()).not.toThrow();
      expect(probe.isStandalone()).toBe(false);
    });
  });

  describe('isMobileFormFactor()', () => {
    it('true cuando coarse pointer + no hover', () => {
      stubMatchMedia({ '(pointer: coarse)': true, '(hover: none)': true });
      expect(probe.isMobileFormFactor()).toBe(true);
    });

    it('false cuando fine pointer (PC con mouse)', () => {
      stubMatchMedia({ '(pointer: coarse)': false, '(hover: none)': false });
      expect(probe.isMobileFormFactor()).toBe(false);
    });

    it('false cuando coarse pointer PERO hover disponible (Surface con touch)', () => {
      stubMatchMedia({ '(pointer: coarse)': true, '(hover: none)': false });
      expect(probe.isMobileFormFactor()).toBe(false);
    });
  });

  describe('getPlatform()', () => {
    it('webview: userAgent con marker de Instagram', () => {
      setUserAgent(
        'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Instagram 253.0.0.16.115 Android',
      );
      expect(probe.getPlatform()).toBe('webview');
    });

    it('webview: userAgent con marker de Facebook (FBAV)', () => {
      setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) FBAN/FBIOS;FBAV/400');
      expect(probe.getPlatform()).toBe('webview');
    });

    it('iosSafari: iPhone Safari genuino', () => {
      setUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Version/16.0 Mobile/15E148 Safari/604.1',
      );
      expect(probe.getPlatform()).toBe('iosSafari');
    });

    it('iosOther: Chrome iOS (CriOS)', () => {
      setUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/108.0 Mobile/15E148 Safari/604.1',
      );
      expect(probe.getPlatform()).toBe('iosOther');
    });

    it('iosOther: Firefox iOS (FxiOS)', () => {
      setUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 FxiOS/108.0 Mobile/15E148 Safari/604.1',
      );
      expect(probe.getPlatform()).toBe('iosOther');
    });

    it('androidChromium: Chrome Android', () => {
      setUserAgent(
        'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 Chrome/108.0.0.0 Mobile Safari/537.36',
      );
      expect(probe.getPlatform()).toBe('androidChromium');
    });

    it('androidChromium: Samsung Internet', () => {
      setUserAgent(
        'Mozilla/5.0 (Linux; Android 12; SM-G950F) AppleWebKit/537.36 SamsungBrowser/18.0 Chrome/106.0.0.0 Mobile Safari/537.36',
      );
      expect(probe.getPlatform()).toBe('androidChromium');
    });

    it('androidOther: Firefox Android', () => {
      setUserAgent('Mozilla/5.0 (Android 12; Mobile; rv:108.0) Gecko/108.0 Firefox/108.0');
      expect(probe.getPlatform()).toBe('androidOther');
    });

    it('desktop: userAgent sin marker mobile', () => {
      setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/108.0.0.0 Safari/537.36',
      );
      expect(probe.getPlatform()).toBe('desktop');
    });

    it('unknown: userAgent vacío', () => {
      setUserAgent('');
      expect(probe.getPlatform()).toBe('unknown');
    });
  });
});
