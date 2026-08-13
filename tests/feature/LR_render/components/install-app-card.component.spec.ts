import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Signal, signal } from '@angular/core';
import { InstallAppCardComponent } from '../../../../src/LR_render/components/install-app-card/install-app-card.component';
import { DecideInstallCardStateUseCase } from '../../../../src/L2_application/use-cases/decide-install-card-state.use-case';
import { BeforeInstallPromptAdapter } from '../../../../src/L3_periphery/pwa/before-install-prompt.adapter';
import {
  NativeInstallOutcome,
  NativeInstallPrompt,
} from '../../../../src/L1_domain/ports/native-install-prompt';
import { FakeInstallEnvironmentProbe } from '../../../unit/fixtures/install-environment-probe.fake';
import { FakeInstallPromptStore } from '../../../unit/fixtures/install-prompt-store.fake';

// Fake del adapter Chromium con Signal real (imprescindible: el componente
// consume `available` como Signal para reactividad).
class FakeBeforeInstallPromptAdapter implements NativeInstallPrompt {
  private readonly availableSignal = signal(false);
  readonly available: Signal<boolean> = this.availableSignal.asReadonly();

  public triggerCalls = 0;
  public nextOutcome: NativeInstallOutcome = 'accepted';

  isAvailable(): boolean {
    return this.availableSignal();
  }

  async trigger(): Promise<NativeInstallOutcome> {
    this.triggerCalls++;
    return this.nextOutcome;
  }

  start(): void {
    // No-op en tests — no queremos listeners globales.
  }

  setAvailable(value: boolean): void {
    this.availableSignal.set(value);
  }
}

describe('InstallAppCardComponent', () => {
  let fixture: ComponentFixture<InstallAppCardComponent>;
  let probe: FakeInstallEnvironmentProbe;
  let store: FakeInstallPromptStore;
  let native: FakeBeforeInstallPromptAdapter;

  const mount = (): void => {
    fixture = TestBed.createComponent(InstallAppCardComponent);
    fixture.detectChanges();
  };

  beforeEach(() => {
    probe = new FakeInstallEnvironmentProbe();
    store = new FakeInstallPromptStore();
    native = new FakeBeforeInstallPromptAdapter();

    TestBed.configureTestingModule({
      imports: [InstallAppCardComponent],
      providers: [
        { provide: BeforeInstallPromptAdapter, useValue: native },
        {
          provide: DecideInstallCardStateUseCase,
          useValue: new DecideInstallCardStateUseCase(probe, store, native),
        },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renderiza el card por default en un iPhone Safari (tienta desde el primer render)', () => {
    probe.configure({ platform: 'iosSafari' });
    mount();
    const card = fixture.nativeElement.querySelector('[data-testid="install-app-card"]');
    expect(card).not.toBeNull();
    expect(card.textContent).toContain('Instala Fiovi como app');
    // Copy default = variante student.
    expect(card.textContent).toContain('Estarás a un paso de ingresar');
  });

  it('variant="tutor" cambia el hint al copy operativo del tutor', () => {
    probe.configure({ platform: 'iosSafari' });
    fixture = TestBed.createComponent(InstallAppCardComponent);
    fixture.componentRef.setInput('variant', 'tutor');
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector('[data-testid="install-app-card"]');
    expect(card).not.toBeNull();
    // Título es el mismo, hint cambia.
    expect(card.textContent).toContain('Instala Fiovi como app');
    expect(card.textContent).toContain('Ten tus aulas siempre a mano');
    // El hint del alumno NO debe aparecer.
    expect(card.textContent).not.toContain('Estarás a un paso de ingresar');
  });

  it('NO renderiza el card en desktop (Fiovi es mobile-first)', () => {
    probe.configure({ mobile: false, platform: 'desktop' });
    mount();
    expect(fixture.nativeElement.querySelector('[data-testid="install-app-card"]')).toBeNull();
  });

  it('NO renderiza el card si ya está standalone (abierta desde el icono)', () => {
    probe.configure({ standalone: true, platform: 'iosSafari' });
    mount();
    expect(fixture.nativeElement.querySelector('[data-testid="install-app-card"]')).toBeNull();
  });

  it('NO renderiza el card si el store marca installed (flag permanente)', () => {
    probe.configure({ platform: 'iosSafari' });
    store.setInstalled(true);
    mount();
    expect(fixture.nativeElement.querySelector('[data-testid="install-app-card"]')).toBeNull();
  });

  it('el card reacciona cuando native.available flippa de false a true (Signal reactivo)', () => {
    probe.configure({ platform: 'androidChromium' });
    native.setAvailable(false);
    mount();
    expect(fixture.nativeElement.querySelector('[data-testid="install-app-card"]')).toBeNull();
    // El evento nativo finalmente llega — computed re-ejecuta.
    native.setAvailable(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="install-app-card"]')).not.toBeNull();
  });

  it('click en androidChromium dispara native.trigger()', async () => {
    probe.configure({ platform: 'androidChromium' });
    native.setAvailable(true);
    native.nextOutcome = 'accepted';
    mount();
    const card = fixture.nativeElement.querySelector(
      '[data-testid="install-app-card"]',
    ) as HTMLElement;
    card.click();
    await fixture.whenStable();
    expect(native.triggerCalls).toBe(1);
    // Sin snooze: el store NO se marca dismissed nunca.
    expect(store.markInstalledCalls).toBe(0);
  });

  it('click en iosSafari abre el modal con instrucciones', async () => {
    probe.configure({ platform: 'iosSafari' });
    mount();
    const card = fixture.nativeElement.querySelector(
      '[data-testid="install-app-card"]',
    ) as HTMLElement;
    card.click();
    await fixture.whenStable();
    fixture.detectChanges();
    const modalTitle = document.querySelector('.modal__title');
    expect(modalTitle?.textContent).toContain('Instala Fiovi en tu iPhone');
  });

  it('click en webviewFallback abre modal "Abre en tu navegador"', async () => {
    probe.configure({ platform: 'webview' });
    mount();
    const card = fixture.nativeElement.querySelector(
      '[data-testid="install-app-card"]',
    ) as HTMLElement;
    card.click();
    await fixture.whenStable();
    fixture.detectChanges();
    const modalTitle = document.querySelector('.modal__title');
    expect(modalTitle?.textContent).toContain('Abre en tu navegador');
  });
});
