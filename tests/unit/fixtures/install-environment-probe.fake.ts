import {
  InstallEnvironmentProbe,
  InstallPlatform,
} from '../../../src/L1_domain/ports/install-environment-probe';

// Fake in-memory del `InstallEnvironmentProbe` para tests. Defaults matchean
// un móvil Android Chromium desconocido para maximizar el "path feliz" (el
// card puede mostrarse). Los tests que exercitan otros casos setean los
// campos vía `configure()`.
export class FakeInstallEnvironmentProbe implements InstallEnvironmentProbe {
  private standalone = false;
  private mobile = true;
  private platform: InstallPlatform = 'androidChromium';

  isStandalone(): boolean {
    return this.standalone;
  }

  isMobileFormFactor(): boolean {
    return this.mobile;
  }

  getPlatform(): InstallPlatform {
    return this.platform;
  }

  configure(config: { standalone?: boolean; mobile?: boolean; platform?: InstallPlatform }): void {
    if (config.standalone !== undefined) this.standalone = config.standalone;
    if (config.mobile !== undefined) this.mobile = config.mobile;
    if (config.platform !== undefined) this.platform = config.platform;
  }
}
