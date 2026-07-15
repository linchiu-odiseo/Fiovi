// Puerto del dominio para el widget de captcha anti-bot que protege el login.
//
// El backend learnex (`POST /auth/login`) acepta un `captchaToken` opcional
// que valida contra el proveedor (hoy Cloudflare Turnstile). Este port abstrae
// el ciclo de vida del widget para que L2/LR puedan pedir un token y limpiar
// el estado tras un intento fallido, sin acoplarse al SDK del proveedor.
//
// Implementación concreta vive en L3 (`CloudflareTurnstileProvider`).
//
// Ciclo de vida esperado por el consumer (LR_render):
//   1. Si `isEnabled()` es `false`, el widget no se renderiza y el login envía
//      la request sin `captchaToken` (dev sin fricción cuando la site key está
//      vacía).
//   2. Si `isEnabled()` es `true`, el consumer llama `render(container, callbacks)`
//      al montar el LoginPage. El adapter carga el script del proveedor si aún
//      no está cargado y renderiza el widget en `container`.
//   3. `callbacks.onToken(token)` se invoca cuando el proveedor emite un token
//      válido (una sola vez por widget, hasta reset o expiración).
//   4. `callbacks.onExpired()` / `callbacks.onError()` invalidan el token —
//      el consumer debe deshabilitar el submit hasta un `onToken` nuevo.
//   5. Tras un login rechazado, el consumer llama `reset(widgetId)` para
//      pedir un token fresco al proveedor (los tokens son de un solo uso).

// Handle opaco devuelto por `render()`. El consumer lo guarda y lo pasa a
// `reset()`. El shape interno lo decide el adapter L3 (Turnstile devuelve un
// string; otros proveedores podrían usar otro formato — todos serializan a
// string aquí).
export type CaptchaWidgetId = string;

// Contenedor DOM donde renderizar el widget. Se tipa como `unknown` para
// mantener L1 agnóstico del DOM; el adapter L3 lo castea a `HTMLElement`.
export type CaptchaContainer = unknown;

export interface CaptchaCallbacks {
  onToken(token: string): void;
  onExpired(): void;
  onError(): void;
}

export interface CaptchaProvider {
  isEnabled(): boolean;
  render(container: CaptchaContainer, callbacks: CaptchaCallbacks): Promise<CaptchaWidgetId>;
  reset(widgetId: CaptchaWidgetId): void;
}
