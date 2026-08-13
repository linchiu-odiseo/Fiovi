// Probe read-only del entorno de ejecución para decidir si el card "Instala
// Fiovi como app" tiene sentido de aparecer y en qué modalidad.
//
// Todos los métodos son SYNC porque los consulta el use case en cada tick
// del view-model; el adapter L3 lee `matchMedia` / `navigator` / userAgent,
// que son sync sin costo.
//
// `getPlatform()` colapsa los casos que necesitamos distinguir para decidir
// el flow de instalación:
//   - `androidChromium`: soporta `beforeinstallprompt`. Instalación 1-tap
//     si el evento está capturado.
//   - `androidOther`: Firefox Android u otro browser sin ese evento. Cae
//     a instrucciones manuales o mensaje "Abrí en Chrome".
//   - `iosSafari`: instalable vía "Compartir → Añadir a pantalla de inicio".
//     Único que puede agregar a home screen en iOS.
//   - `iosOther`: Chrome/Firefox/Edge en iOS (todos WebKit). NO pueden
//     agregar a home; hay que redirigir al Safari.
//   - `desktop`: PC/Mac/Linux. Fiovi es mobile-first — el card no aparece.
//   - `webview`: browser embebido (Instagram, TikTok, Facebook, Gmail).
//     Tampoco puede instalar; muestra mensaje de "abrir en navegador".
//   - `unknown`: fallback conservador; el use case oculta el card.
export type InstallPlatform =
  | 'androidChromium'
  | 'androidOther'
  | 'iosSafari'
  | 'iosOther'
  | 'desktop'
  | 'webview'
  | 'unknown';

export interface InstallEnvironmentProbe {
  // `true` si la app corre en display-mode standalone (agregada a home) o si
  // iOS Safari reporta `navigator.standalone`. Cuando esto es `true`, el card
  // NUNCA aparece: ya está instalada y abierta como tal.
  isStandalone(): boolean;

  // Factor de forma. Si es `false` (PC), el card no aplica — Fiovi es una
  // PWA mobile por producto (cartilla de simulacros que el alumno usa en el
  // celu). Chequeamos coarse pointer + no-hover como señales reales de touch.
  isMobileFormFactor(): boolean;

  // Plataforma agregada — ver comentario del type arriba.
  getPlatform(): InstallPlatform;
}
