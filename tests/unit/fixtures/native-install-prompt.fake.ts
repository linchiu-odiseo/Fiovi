import {
  NativeInstallOutcome,
  NativeInstallPrompt,
} from '../../../src/L1_domain/ports/native-install-prompt';

// Fake in-memory del `NativeInstallPrompt`. Empieza `unavailable` para
// matchar la realidad de Chromium: el evento `beforeinstallprompt` requiere
// engagement — al arrancar aún no llegó.
export class FakeNativeInstallPrompt implements NativeInstallPrompt {
  private available = false;
  private nextOutcome: NativeInstallOutcome = 'unavailable';

  public triggerCalls = 0;

  isAvailable(): boolean {
    return this.available;
  }

  async trigger(): Promise<NativeInstallOutcome> {
    this.triggerCalls++;
    return this.nextOutcome;
  }

  setAvailable(value: boolean): void {
    this.available = value;
  }

  setNextOutcome(outcome: NativeInstallOutcome): void {
    this.nextOutcome = outcome;
  }
}
