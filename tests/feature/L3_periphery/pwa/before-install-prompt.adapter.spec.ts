import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { BeforeInstallPromptAdapter } from '../../../../src/L3_periphery/pwa/before-install-prompt.adapter';
import { INSTALL_PROMPT_STORE } from '../../../../src/L3_periphery/tokens';
import { FakeInstallPromptStore } from '../../../unit/fixtures/install-prompt-store.fake';

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
  let store: FakeInstallPromptStore;

  beforeEach(() => {
    store = new FakeInstallPromptStore();
    TestBed.configureTestingModule({
      providers: [BeforeInstallPromptAdapter, { provide: INSTALL_PROMPT_STORE, useValue: store }],
    });
    adapter = TestBed.inject(BeforeInstallPromptAdapter);
  });

  afterEach(() => {
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

  it('evento `appinstalled` marca el flag permanent en el store', () => {
    adapter.start();
    // Primero captamos un beforeinstallprompt para tener el latch.
    window.dispatchEvent(makeBeforeInstallEvent('accepted'));
    expect(adapter.available()).toBe(true);
    // Ahora disparamos appinstalled — flag permanente + limpieza del latch.
    window.dispatchEvent(new Event('appinstalled'));
    expect(store.isMarkedInstalled()).toBe(true);
    expect(adapter.available()).toBe(false);
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
