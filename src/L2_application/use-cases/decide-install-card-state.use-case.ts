import { InstallEnvironmentProbe } from '../../L1_domain/ports/install-environment-probe';
import { NativeInstallPrompt } from '../../L1_domain/ports/native-install-prompt';

// Estado del card "Instala Fiovi como app" que se muestra en /home. Es una
// discriminated union para que el view-model LR haga switch exhaustivo y
// el compilador nos avise si agregamos un caso nuevo y olvidamos la rama.
//
//   - `hidden`: el card no aparece en absoluto.
//   - `nativePrompt`: tap → dispara el diálogo de instalación de Chromium.
//     El único flow "1-tap real". Chrome Android/Edge/Samsung Internet.
//   - `iosInstructions`: tap → modal con los 3 pasos de Safari/Chrome/Edge
//     en iOS (Compartir → Añadir a pantalla de inicio → Añadir).
//   - `androidInstructions`: Android Chromium sin `beforeinstallprompt`
//     capturado todavía. Tap → modal con los pasos manuales (menú ⋮ →
//     Instalar aplicación).
//   - `webviewFallback`: navegador embebido (Instagram, TikTok, Gmail) o
//     Firefox Android. Tap → modal "Abrí en tu navegador principal".
export type InstallCardState =
  | { kind: 'hidden' }
  | { kind: 'nativePrompt' }
  | { kind: 'iosInstructions' }
  | { kind: 'androidInstructions' }
  | { kind: 'webviewFallback' };

// Decide si el card se muestra en /home y en qué modalidad, combinando
// estado del entorno + evento nativo de Chromium.
//
// Filosofía "tentando siempre": el card queda visible en todo browser
// mobile, sin importar si el user ya instaló Fiovi antes — no existe
// persistencia de "ya instalado" (ver pwa-install-prompt spec). NO hay
// snooze temporal, NO hay grace period en primera visita. Los únicos
// oculta-para-siempre son: standalone (ya la abrió instalada) o desktop
// (Fiovi es mobile-only por diseño).
//
// El use case NO tiene side-effects: es puro read → decisión.
export class DecideInstallCardStateUseCase {
  constructor(
    private readonly probe: InstallEnvironmentProbe,
    private readonly native: NativeInstallPrompt,
  ) {}

  execute(): InstallCardState {
    // Ya instalada corriendo standalone: cero razón para tentar.
    if (this.probe.isStandalone()) return { kind: 'hidden' };

    // PC: Fiovi es una PWA mobile por diseño (cartilla de simulacros para
    // rendir en el celu). Instalarla en desktop no le aporta al alumno.
    if (!this.probe.isMobileFormFactor()) return { kind: 'hidden' };

    // Elegir modalidad según plataforma.
    switch (this.probe.getPlatform()) {
      case 'androidChromium':
        // Con el evento nativo capturado, tap dispara el diálogo real.
        // Sin él, el card sigue visible pero abre instrucciones manuales
        // (menú ⋮ → Instalar aplicación) en vez de esconderse.
        return this.native.isAvailable() ? { kind: 'nativePrompt' } : { kind: 'androidInstructions' };
      case 'iosSafari':
      case 'iosOther':
        return { kind: 'iosInstructions' };
      case 'androidOther':
      case 'webview':
        return { kind: 'webviewFallback' };
      case 'desktop':
      case 'unknown':
        return { kind: 'hidden' };
    }
  }
}
