// Tipado global de la API JS de Cloudflare Turnstile
// (https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/).
// El SDK se carga dinámicamente desde `challenges.cloudflare.com` en el adapter
// L3 y publica `window.turnstile`. Este archivo declara el shape mínimo que
// usamos, no cubre la API completa.

interface TurnstileRenderParams {
  sitekey: string;
  callback?: (token: string) => void;
  'expired-callback'?: () => void;
  'error-callback'?: () => void;
  'timeout-callback'?: () => void;
  size?: 'normal' | 'compact' | 'flexible' | 'invisible';
  theme?: 'light' | 'dark' | 'auto';
  appearance?: 'always' | 'execute' | 'interaction-only';
  action?: string;
  cData?: string;
  language?: string;
}

interface TurnstileApi {
  render(container: HTMLElement | string, params: TurnstileRenderParams): string;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
  getResponse(widgetId?: string): string | undefined;
  isExpired(widgetId?: string): boolean;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

// Sin `export {}`, TS trataría el `.d.ts` como script global y el `declare
// global` sería redundante. Con `export {}` lo convierte en módulo y el
// `declare global` sí extiende el scope global.
export {};
