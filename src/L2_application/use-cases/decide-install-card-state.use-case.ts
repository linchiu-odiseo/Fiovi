import { InstallEnvironmentProbe } from '../../L1_domain/ports/install-environment-probe';
import { InstallPromptStore } from '../../L1_domain/ports/install-prompt-store';
import { NativeInstallPrompt } from '../../L1_domain/ports/native-install-prompt';

// Estado del card "Instala Fiovi como app" que se muestra en /home. Es una
// discriminated union para que el view-model LR haga switch exhaustivo y
// el compilador nos avise si agregamos un caso nuevo y olvidamos la rama.
//
//   - `hidden`: el card no aparece en absoluto.
//   - `nativePrompt`: tap → dispara el diálogo de instalación de Chromium.
//     El único flow "1-tap real". Chrome Android/Edge/Samsung Internet.
//   - `iosInstructions`: tap → modal con los 3 pasos de Safari
//     (Compartir → Añadir a pantalla de inicio → Añadir).
//   - `iosOtherBrowser`: iOS con Chrome/Firefox/Edge (todos WebKit, no
//     pueden agregar a home). Tap → modal "Abrí en Safari" con botón de
//     copiar URL.
//   - `webviewFallback`: navegador embebido (Instagram, TikTok, Gmail) o
//     Firefox Android. Tap → modal "Abrí en tu navegador principal".
export type InstallCardState =
  | { kind: 'hidden' }
  | { kind: 'nativePrompt' }
  | { kind: 'iosInstructions' }
  | { kind: 'iosOtherBrowser' }
  | { kind: 'webviewFallback' };

// Decide si el card se muestra en /home y en qué modalidad, combinando
// estado del entorno + persistencia + evento nativo de Chromium.
//
// Filosofía "tentando siempre": el card queda visible mientras el user
// no lo haya instalado (o el browser no soporte la instalación). NO hay
// snooze temporal, NO hay grace period en primera visita — el card está
// ahí para que el user desee instalarlo. Los únicos oculta-para-siempre
// son: standalone (ya la abrió instalada), installed (el flag persistente
// se prendió alguna vez), o desktop (Fiovi es mobile-only por diseño).
//
// El use case NO tiene side-effects: es puro read → decisión. Los
// side-effects (marcar installed) los dispara el adapter que escucha el
// evento `appinstalled`.
export class DecideInstallCardStateUseCase {
  constructor(
    private readonly probe: InstallEnvironmentProbe,
    private readonly store: InstallPromptStore,
    private readonly native: NativeInstallPrompt,
  ) {}

  execute(): InstallCardState {
    // Ya instalada corriendo standalone: cero razón para tentar.
    if (this.probe.isStandalone()) return { kind: 'hidden' };

    // Instaló alguna vez en este browser (vía nuestro botón o menú del
    // navegador): respetamos la decisión y no volvemos a mostrar.
    if (this.store.isMarkedInstalled()) return { kind: 'hidden' };

    // PC: Fiovi es una PWA mobile por diseño (cartilla de simulacros para
    // rendir en el celu). Instalarla en desktop no le aporta al alumno.
    if (!this.probe.isMobileFormFactor()) return { kind: 'hidden' };

    // Elegir modalidad según plataforma.
    switch (this.probe.getPlatform()) {
      case 'androidChromium':
        // Solo tiene sentido mostrar el card si el evento nativo ya fue
        // capturado. Sin evento, el tap del user no puede lanzar el diálogo
        // — mejor no ofrecer una acción que fallaría silenciosa.
        return this.native.isAvailable() ? { kind: 'nativePrompt' } : { kind: 'hidden' };
      case 'iosSafari':
        return { kind: 'iosInstructions' };
      case 'iosOther':
        return { kind: 'iosOtherBrowser' };
      case 'androidOther':
      case 'webview':
        return { kind: 'webviewFallback' };
      case 'desktop':
      case 'unknown':
        return { kind: 'hidden' };
    }
  }
}
