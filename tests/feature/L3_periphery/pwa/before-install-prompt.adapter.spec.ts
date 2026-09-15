import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { BeforeInstallPromptAdapter } from '../../../../src/L3_periphery/pwa/before-install-prompt.adapter';
import { GoogleAnalyticsService } from '../../../../src/L3_periphery/analytics/google-analytics.service';

// Helper para simular el evento `beforeinstallprompt` con el shape que
// espera el adapter (prompt() + userChoice).
function makeBeforeInstallEvent(outcome: 'accepted' | 'dismissed'): Event {
  const event = new Event('beforeinstallprompt') as Event & {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  };
  event.prompt = async () => undefined;
  event.userChoice = Promise.resolve({ outcome, platform: 'web' });
  return event;
}

describe('BeforeInstallPromptAdapter', () => {
  let adapter: BeforeInstallPromptAdapter;
  let trackPwaInstall: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [BeforeInstallPromptAdapter],
    });
    // `GoogleAnalyticsService` se resuelve solo (providedIn: 'root') — por eso
    // el adapter inyecta la clase concreta y no un token: este spec no tiene
    // por qué saber de analytics para seguir pasando.
    trackPwaInstall = vi.spyOn(TestBed.inject(GoogleAnalyticsService), 'trackPwaInstall');
    adapter = TestBed.inject(BeforeInstallPromptAdapter);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('isAvailable() = false antes de que llegue el evento', () => {
    expect(adapter.isAvailable()).toBe(false);
    expect(adapter.available()).toBe(false);
  });

  it('trigger() antes de captar el evento devuelve unavailable', async () => {
    const outcome = await adapter.trigger();
    expect(outcome).toBe('unavailable');
  });

  it('capta `beforeinstallprompt` tras start() y flip a available=true', () => {
    adapter.start();
    const event = makeBeforeInstallEvent('accepted');
    window.dispatchEvent(event);
    expect(adapter.isAvailable()).toBe(true);
    expect(adapter.available()).toBe(true);
  });

  it('start() es idempotente — llamar dos veces no duplica listeners', () => {
    adapter.start();
    adapter.start();
    window.dispatchEvent(makeBeforeInstallEvent('accepted'));
    expect(adapter.isAvailable()).toBe(true);
  });

  it('trigger() tras captar evento con userChoice=accepted → outcome accepted', async () => {
    adapter.start();
    window.dispatchEvent(makeBeforeInstallEvent('accepted'));
    const outcome = await adapter.trigger();
    expect(outcome).toBe('accepted');
    // Tras trigger el latch se limpia: available vuelve a false.
    expect(adapter.available()).toBe(false);
  });

  it('trigger() tras captar evento con userChoice=dismissed → outcome dismissed', async () => {
    adapter.start();
    window.dispatchEvent(makeBeforeInstallEvent('dismissed'));
    const outcome = await adapter.trigger();
    expect(outcome).toBe('dismissed');
    expect(adapter.available()).toBe(false);
  });

  it('evento `appinstalled` limpia el latch: available flippa a false y trigger() queda unavailable', async () => {
    adapter.start();
    // Primero captamos un beforeinstallprompt para tener el latch.
    window.dispatchEvent(makeBeforeInstallEvent('accepted'));
    expect(adapter.available()).toBe(true);
    // El evento `appinstalled` puede llegar sin que el user haya usado
    // nuestro botón (instaló desde el menú del browser) — el evento
    // `beforeinstallprompt` ya es stale de cualquier forma.
    window.dispatchEvent(new Event('appinstalled'));
    expect(adapter.available()).toBe(false);
    // Prueba de que `deferredPrompt` quedó en null: un trigger() posterior
    // no puede lanzar el diálogo sobre un evento consumido.
    const outcome = await adapter.trigger();
    expect(outcome).toBe('unavailable');
  });

  it('evento `appinstalled` reporta la instalación a analytics una sola vez', () => {
    adapter.start();
    window.dispatchEvent(new Event('appinstalled'));
    // `appinstalled` es el único punto donde la instalación está CONFIRMADA,
    // sin importar si vino de nuestro card o del menú del browser.
    expect(trackPwaInstall).toHaveBeenCalledTimes(1);
  });

  it('trigger() con outcome accepted NO reporta instalación — accepted no es instalado', async () => {
    adapter.start();
    window.dispatchEvent(makeBeforeInstallEvent('accepted'));
    await adapter.trigger();
    expect(trackPwaInstall).not.toHaveBeenCalled();
  });

  it('trigger() maneja rejection de prompt() sin propagar y devuelve unavailable', async () => {
    adapter.start();
    const badEvent = new Event('beforeinstallprompt') as Event & {
      prompt(): Promise<void>;
      userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
    };
    badEvent.prompt = async () => {
      throw new Error('user closed tab');
    };
    badEvent.userChoice = Promise.resolve({ outcome: 'dismissed', platform: 'web' });
    window.dispatchEvent(badEvent);
    const outcome = await adapter.trigger();
    expect(outcome).toBe('unavailable');
    expect(adapter.available()).toBe(false);
  });
});
