// Tests del `CaptchaWidgetComponent` (LR).
//
// Verifica el contrato con el port `CaptchaProvider` (L1):
// - Si `isEnabled()` es false → no llama `render()`.
// - Si `isEnabled()` es true → llama `render(container, callbacks)`, guarda
//   el widgetId, y las callbacks del provider se traducen a emisiones
//   `tokenChange` (string cuando onToken, null cuando expiración/error).
// - `reset()` invoca `provider.reset(widgetId)` y emite `tokenChange(null)`.
//
// Usamos un `FakeCaptchaProvider` que captura las callbacks para poder
// dispararlas manualmente en cada test.

import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { CaptchaWidgetComponent } from '../../../../src/LR_render/components/captcha-widget/captcha-widget.component';
import {
  CaptchaCallbacks,
  CaptchaProvider,
  CaptchaWidgetId,
} from '../../../../src/L1_domain/ports/captcha-provider';
import { CAPTCHA_PROVIDER } from '../../../../src/L3_periphery/tokens';

class FakeCaptchaProvider implements CaptchaProvider {
  enabled = true;
  renderedContainer: unknown = null;
  capturedCallbacks: CaptchaCallbacks | null = null;
  nextWidgetId: CaptchaWidgetId = 'widget-1';
  resetCalls: CaptchaWidgetId[] = [];

  isEnabled(): boolean {
    return this.enabled;
  }

  async render(container: unknown, callbacks: CaptchaCallbacks): Promise<CaptchaWidgetId> {
    this.renderedContainer = container;
    this.capturedCallbacks = callbacks;
    return this.nextWidgetId;
  }

  reset(widgetId: CaptchaWidgetId): void {
    this.resetCalls.push(widgetId);
  }
}

// Flush microtasks — el `ngAfterViewInit` es async (`render()` devuelve
// Promise), y las emisiones ocurren después de un tick.
const flush = async (n = 3): Promise<void> => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

describe('CaptchaWidgetComponent', () => {
  let fake: FakeCaptchaProvider;
  let fixture: ComponentFixture<CaptchaWidgetComponent>;
  let component: CaptchaWidgetComponent;

  beforeEach(async () => {
    fake = new FakeCaptchaProvider();
    await TestBed.configureTestingModule({
      imports: [CaptchaWidgetComponent],
      providers: [{ provide: CAPTCHA_PROVIDER, useValue: fake }],
    }).compileComponents();
  });

  const mount = async (): Promise<void> => {
    fixture = TestBed.createComponent(CaptchaWidgetComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await flush();
  };

  it('cuando isEnabled=false NO llama render() del provider', async () => {
    fake.enabled = false;
    await mount();
    expect(fake.renderedContainer).toBeNull();
    expect(fake.capturedCallbacks).toBeNull();
  });

  it('cuando isEnabled=true llama render() con el nativeElement del <div #container>', async () => {
    await mount();
    expect(fake.renderedContainer).not.toBeNull();
    expect((fake.renderedContainer as HTMLElement).getAttribute('data-testid')).toBe(
      'captcha-widget-container',
    );
  });

  it('emite tokenChange(token) cuando el provider dispara onToken', async () => {
    const emissions: (string | null)[] = [];
    await mount();
    component.tokenChange.subscribe((v) => emissions.push(v));

    fake.capturedCallbacks!.onToken('token-xyz');
    expect(emissions).toEqual(['token-xyz']);
  });

  it('emite tokenChange(null) cuando el provider dispara onExpired', async () => {
    const emissions: (string | null)[] = [];
    await mount();
    component.tokenChange.subscribe((v) => emissions.push(v));

    fake.capturedCallbacks!.onExpired();
    expect(emissions).toEqual([null]);
  });

  it('emite tokenChange(null) cuando el provider dispara onError', async () => {
    const emissions: (string | null)[] = [];
    await mount();
    component.tokenChange.subscribe((v) => emissions.push(v));

    fake.capturedCallbacks!.onError();
    expect(emissions).toEqual([null]);
  });

  it('reset() delega al provider con el widgetId capturado y emite tokenChange(null)', async () => {
    fake.nextWidgetId = 'widget-abc';
    const emissions: (string | null)[] = [];
    await mount();
    component.tokenChange.subscribe((v) => emissions.push(v));

    component.reset();

    expect(fake.resetCalls).toEqual(['widget-abc']);
    expect(emissions).toEqual([null]);
  });

  it('reset() es no-op si el widget aún no se renderizó (disabled)', async () => {
    fake.enabled = false;
    const emissions: (string | null)[] = [];
    await mount();
    component.tokenChange.subscribe((v) => emissions.push(v));

    component.reset();

    expect(fake.resetCalls).toEqual([]);
    expect(emissions).toEqual([]);
  });
});
