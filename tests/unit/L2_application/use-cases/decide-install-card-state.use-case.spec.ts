import { beforeEach, describe, expect, it } from 'vitest';
import { DecideInstallCardStateUseCase } from '../../../../src/L2_application/use-cases/decide-install-card-state.use-case';
import { FakeInstallEnvironmentProbe } from '../../fixtures/install-environment-probe.fake';
import { FakeNativeInstallPrompt } from '../../fixtures/native-install-prompt.fake';

describe('DecideInstallCardStateUseCase', () => {
  let probe: FakeInstallEnvironmentProbe;
  let native: FakeNativeInstallPrompt;
  let useCase: DecideInstallCardStateUseCase;

  beforeEach(() => {
    probe = new FakeInstallEnvironmentProbe();
    native = new FakeNativeInstallPrompt();
    useCase = new DecideInstallCardStateUseCase(probe, native);
  });

  // Guardas early-return: cada una debe ocultar el card independientemente
  // del resto de las condiciones.

  it('hidden cuando corre standalone (ya instalada)', () => {
    probe.configure({ standalone: true });
    native.setAvailable(true);
    expect(useCase.execute()).toEqual({ kind: 'hidden' });
  });

  it('hidden cuando NO es mobile (desktop)', () => {
    probe.configure({ mobile: false, platform: 'desktop' });
    native.setAvailable(true);
    expect(useCase.execute()).toEqual({ kind: 'hidden' });
  });

  // Ramas por plataforma cuando las guardas pasan. Sin gates de visita ni
  // dismissal: el card tienta siempre desde el primer render.

  describe('con guardas satisfechas (mobile, no instalada)', () => {
    it('androidChromium + prompt disponible → nativePrompt', () => {
      probe.configure({ platform: 'androidChromium' });
      native.setAvailable(true);
      expect(useCase.execute()).toEqual({ kind: 'nativePrompt' });
    });

    it('androidChromium + prompt NO disponible → androidInstructions (antes hidden, ahora tentativo)', () => {
      probe.configure({ platform: 'androidChromium' });
      native.setAvailable(false);
      expect(useCase.execute()).toEqual({ kind: 'androidInstructions' });
    });

    it('iosSafari → iosInstructions', () => {
      probe.configure({ platform: 'iosSafari' });
      expect(useCase.execute()).toEqual({ kind: 'iosInstructions' });
    });

    it('iosOther (Chrome/Firefox iOS) → iosInstructions', () => {
      probe.configure({ platform: 'iosOther' });
      expect(useCase.execute()).toEqual({ kind: 'iosInstructions' });
    });

    it('androidOther (Firefox Android) → webviewFallback', () => {
      probe.configure({ platform: 'androidOther' });
      expect(useCase.execute()).toEqual({ kind: 'webviewFallback' });
    });

    it('webview (Instagram/TikTok/Gmail) → webviewFallback', () => {
      probe.configure({ platform: 'webview' });
      expect(useCase.execute()).toEqual({ kind: 'webviewFallback' });
    });

    it('desktop (nunca debería llegar acá por isMobile=false, safety) → hidden', () => {
      probe.configure({ platform: 'desktop' });
      expect(useCase.execute()).toEqual({ kind: 'hidden' });
    });

    it('unknown → hidden (conservador)', () => {
      probe.configure({ platform: 'unknown' });
      expect(useCase.execute()).toEqual({ kind: 'hidden' });
    });
  });

  it('el use case NO tiene side-effects: llamar execute() no dispara el prompt nativo', () => {
    probe.configure({ platform: 'iosSafari' });
    useCase.execute();
    expect(native.triggerCalls).toBe(0);
  });
});
