import { Injectable, Signal, inject, signal } from '@angular/core';

import { InstallPromptStore } from '../../L1_domain/ports/install-prompt-store';
import {
  NativeInstallOutcome,
  NativeInstallPrompt,
} from '../../L1_domain/ports/native-install-prompt';
import { INSTALL_PROMPT_STORE } from '../tokens';

// Shape del evento `beforeinstallprompt` de Chromium. No hay tipo estándar
// en lib.dom.d.ts porque el spec sigue "informal". Declaramos lo mínimo
// que usamos — `prompt()` y `userChoice`.
type BeforeInstallPromptEventLike = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

// Adapter que captura `beforeinstallprompt` y expone la posibilidad de
// disparar el diálogo nativo de instalación de Chromium. Sigue el patrón
// de `PwaUpdateService`: es `@Injectable({ providedIn: 'root' })`, tiene
// un `.start()` idempotente que registra los listeners, y expone un Signal
// (`available`) además de la interface del port (para que el view-model
// LR pueda reaccionar a cambios de disponibilidad sin polling).
//
// El `.start()` se dispara desde `provideAppInitializer` en `app.config.ts`.
// Registrar en el ctor traería el listener antes pero es innecesario porque
// Chrome dispara `beforeinstallprompt` DESPUÉS de que la app haya cargado
// y el user haya interactuado (engagement heuristics).
//
// Sobre `appinstalled`: se dispara UNA vez cuando el user instala por
// cualquier vía (nuestro botón o el menú del navegador). Al recibirlo
// marcamos el flag permanent en el store → el use case cae en el
// early-return `isMarkedInstalled()` y el card no vuelve a aparecer.
@Injectable({ providedIn: 'root' })
export class BeforeInstallPromptAdapter implements NativeInstallPrompt {
  private readonly store = inject<InstallPromptStore>(INSTALL_PROMPT_STORE);

  private readonly availableSignal = signal(false);

  // Signal público read-only para consumidores LR. NO forma parte de la
  // interface `NativeInstallPrompt` (L1 no depende de @angular/core).
  readonly available: Signal<boolean> = this.availableSignal.asReadonly();

  private deferredPrompt: BeforeInstallPromptEventLike | null = null;
  private started = false;

  private readonly onBeforeInstallPrompt = (event: Event): void => {
    event.preventDefault();
    this.deferredPrompt = event as BeforeInstallPromptEventLike;
    this.availableSignal.set(true);
  };

  private readonly onAppInstalled = (): void => {
    this.store.markInstalled();
    this.deferredPrompt = null;
    this.availableSignal.set(false);
  };

  start(): void {
    if (this.started) return;
    this.started = true;
    if (typeof window === 'undefined') return;
    window.addEventListener('beforeinstallprompt', this.onBeforeInstallPrompt);
    window.addEventListener('appinstalled', this.onAppInstalled);
  }

  isAvailable(): boolean {
    return this.availableSignal();
  }

  async trigger(): Promise<NativeInstallOutcome> {
    const prompt = this.deferredPrompt;
    if (prompt === null) return 'unavailable';
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      // El evento es de un solo uso; después de disparar debemos limpiar
      // el latch. Chrome puede volver a emitir `beforeinstallprompt` si el
      // user cambió de opinión y quiere volver a intentarlo — el listener
      // capturará el nuevo evento.
      this.deferredPrompt = null;
      this.availableSignal.set(false);
      return choice.outcome === 'accepted' ? 'accepted' : 'dismissed';
    } catch {
      // Race raro: prompt() rechaza si el user cerró la pestaña, o el
      // browser suprimió el diálogo. Limpiamos igual y devolvemos
      // 'unavailable' para que el view-model NO asuma dismissed (que
      // dispararía markDismissedAt y esconderia el card por 14 días).
      this.deferredPrompt = null;
      this.availableSignal.set(false);
      return 'unavailable';
    }
  }
}
