import { InstallPromptStore } from '../../../src/L1_domain/ports/install-prompt-store';

// Fake in-memory del `InstallPromptStore` para tests. Empieza como
// instalación fresh (installed = false).
export class FakeInstallPromptStore implements InstallPromptStore {
  private installed = false;

  public markInstalledCalls = 0;

  isMarkedInstalled(): boolean {
    return this.installed;
  }

  markInstalled(): void {
    this.installed = true;
    this.markInstalledCalls++;
  }

  // Setter directo para tests que quieren establecer un estado inicial
  // sin invocar `markInstalled` (mantiene el contador en 0).
  setInstalled(value: boolean): void {
    this.installed = value;
  }
}
