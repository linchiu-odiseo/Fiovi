import { PwaCookieModeStore } from '../../../src/L1_domain/ports/pwa-cookie-mode-store';

// Fake in-memory del `PwaCookieModeStore` para tests L2. Comienza deshabilitado
// (matchea la instalación fresh y las sesiones pre-migración). Los tests que
// quieren simular "usuario ya migró" llaman `.enable()` en el `beforeEach`.
export class FakePwaCookieModeStore implements PwaCookieModeStore {
  private enabled = false;
  public enableCalls = 0;

  isEnabled(): boolean {
    return this.enabled;
  }

  enable(): void {
    this.enabled = true;
    this.enableCalls++;
  }
}
