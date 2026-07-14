import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { Component } from '@angular/core';
import { LoginPage } from '../../../../../src/LR_render/pages/login/login.page';
import { LoginUseCase } from '../../../../../src/L2_application/use-cases/login.use-case';
import { ListSsoProvidersUseCase } from '../../../../../src/L2_application/use-cases/list-sso-providers.use-case';
import { Identity } from '../../../../../src/L1_domain/entities/identity';
import { SelectionChallenge } from '../../../../../src/L1_domain/value-objects/selection-challenge';
import { SsoProvider } from '../../../../../src/L1_domain/value-objects/sso-provider';
import { InvalidCredentialsError } from '../../../../../src/L1_domain/errors/invalid-credentials.error';
import { NetworkError } from '../../../../../src/L1_domain/errors/network.error';
import { RateLimitError } from '../../../../../src/L1_domain/errors/rate-limit.error';
import { environment } from '../../../../../src/environments/environment';

@Component({ template: '' })
class StudentHomeStub {}

@Component({ template: '' })
class TutorHomeStub {}

@Component({ template: '' })
class SelectTenantStub {}

function buildIdentity(role: 'student' | 'tutor' = 'student'): Identity {
  const email = role === 'student' ? '79507732@vonex.edu.pe' : 'tutor1@vonex.pe';
  const codigo = role === 'student' ? '79507732' : null;
  return new Identity(
    'user-id',
    'tenant-id',
    'vonex',
    email,
    codigo,
    [role],
    [],
    Date.now() + 900_000,
  );
}

class FakeLoginUseCase {
  private nextOutcome:
    | { kind: 'identity'; role: 'student' | 'tutor' }
    | { kind: 'selection'; challenge: SelectionChallenge }
    | { kind: 'reject'; error: Error } = { kind: 'identity', role: 'student' };
  public calls: { email: string; password: string }[] = [];

  willResolveAs(role: 'student' | 'tutor') {
    this.nextOutcome = { kind: 'identity', role };
  }
  willResolveSelection(challenge: SelectionChallenge) {
    this.nextOutcome = { kind: 'selection', challenge };
  }
  willRejectInvalid() {
    this.nextOutcome = { kind: 'reject', error: new InvalidCredentialsError() };
  }
  willRejectNetwork() {
    this.nextOutcome = { kind: 'reject', error: new NetworkError() };
  }
  willRejectRateLimit() {
    this.nextOutcome = { kind: 'reject', error: new RateLimitError() };
  }

  async execute(credentials: {
    email: string;
    password: string;
  }): Promise<Identity | SelectionChallenge> {
    this.calls.push(credentials);
    if (this.nextOutcome.kind === 'reject') throw this.nextOutcome.error;
    if (this.nextOutcome.kind === 'selection') return this.nextOutcome.challenge;
    return buildIdentity(this.nextOutcome.role);
  }
}

class FakeListSsoProvidersUseCase {
  private providers: SsoProvider[] = [{ provider: 'google', displayName: 'Google' }];

  willResolveWith(providers: SsoProvider[]) {
    this.providers = providers;
  }

  async execute(): Promise<SsoProvider[]> {
    return this.providers;
  }
}

const validCredentials = { email: 'fulano@panda.test', password: '12345678' };

const setEmailAndPasswordViaDOM = (
  fixture: { nativeElement: HTMLElement },
  c: { email: string; password: string },
) => {
  const el = fixture.nativeElement;
  const email = el.querySelector('input[formcontrolname="email"]') as HTMLInputElement;
  const pwd = el.querySelector('input[formcontrolname="password"]') as HTMLInputElement;
  email.value = c.email;
  email.dispatchEvent(new Event('input'));
  pwd.value = c.password;
  pwd.dispatchEvent(new Event('input'));
};

describe('LoginPage', () => {
  let fakeUseCase: FakeLoginUseCase;
  let fakeSsoProviders: FakeListSsoProvidersUseCase;

  beforeEach(async () => {
    fakeUseCase = new FakeLoginUseCase();
    fakeSsoProviders = new FakeListSsoProvidersUseCase();
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        provideRouter([
          { path: 'login', component: LoginPage },
          { path: 'login/select-tenant', component: SelectTenantStub },
          { path: 'student/home', component: StudentHomeStub },
          { path: 'tutor/home', component: TutorHomeStub },
        ]),
        { provide: LoginUseCase, useValue: fakeUseCase },
        { provide: ListSsoProvidersUseCase, useValue: fakeSsoProviders },
      ],
    }).compileComponents();
  });

  it('renderiza inputs de email y password y botón submit', () => {
    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('input[formcontrolname="email"]')).not.toBeNull();
    expect(el.querySelector('input[formcontrolname="password"]')).not.toBeNull();
    expect(el.querySelector('button[type="submit"]')).not.toBeNull();
  });

  it('botón submit deshabilitado cuando el form está inválido', () => {
    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('botón submit habilitado cuando el form es válido', () => {
    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    setEmailAndPasswordViaDOM(fixture, validCredentials);
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('submit exitoso con identity student navega a /student/home', async () => {
    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    setEmailAndPasswordViaDOM(fixture, validCredentials);
    fixture.detectChanges();
    fakeUseCase.willResolveAs('student');

    const router = TestBed.inject(Router);
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit'));
    await fixture.whenStable();

    expect(fakeUseCase.calls).toEqual([validCredentials]);
    expect(router.url).toBe('/student/home');
  });

  it('submit exitoso con identity tutor navega a /tutor/home', async () => {
    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    setEmailAndPasswordViaDOM(fixture, validCredentials);
    fixture.detectChanges();
    fakeUseCase.willResolveAs('tutor');

    const router = TestBed.inject(Router);
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit'));
    await fixture.whenStable();

    expect(router.url).toBe('/tutor/home');
  });

  it('submit con selectionChallenge (N tenants) navega a /login/select-tenant', async () => {
    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    setEmailAndPasswordViaDOM(fixture, validCredentials);
    fixture.detectChanges();
    fakeUseCase.willResolveSelection({
      selectionToken: 'tkn',
      selectionExpiresAt: Date.now() + 5 * 60 * 1000,
      tenants: [
        { slug: 'vonex', name: 'Vonex' },
        { slug: 'pitagoras', name: 'Pitágoras' },
      ],
    });

    const router = TestBed.inject(Router);
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit'));
    await fixture.whenStable();

    expect(router.url).toBe('/login/select-tenant');
  });

  it('credenciales inválidas muestran mensaje y limpian password pero conservan email', async () => {
    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    setEmailAndPasswordViaDOM(fixture, validCredentials);
    fixture.detectChanges();
    fakeUseCase.willRejectInvalid();

    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.error')?.textContent).toContain('Credenciales inválidas');
    expect((el.querySelector('input[formcontrolname="email"]') as HTMLInputElement).value).toBe(
      validCredentials.email,
    );
    expect((el.querySelector('input[formcontrolname="password"]') as HTMLInputElement).value).toBe(
      '',
    );
  });

  it('error de red muestra mensaje y conserva ambos campos', async () => {
    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    setEmailAndPasswordViaDOM(fixture, validCredentials);
    fixture.detectChanges();
    fakeUseCase.willRejectNetwork();

    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.error')?.textContent).toContain('No se pudo conectar al servidor');
    expect((el.querySelector('input[formcontrolname="email"]') as HTMLInputElement).value).toBe(
      validCredentials.email,
    );
    expect((el.querySelector('input[formcontrolname="password"]') as HTMLInputElement).value).toBe(
      validCredentials.password,
    );
  });

  it('rate limit muestra mensaje "Demasiados intentos…" y conserva el email', async () => {
    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    setEmailAndPasswordViaDOM(fixture, validCredentials);
    fixture.detectChanges();
    fakeUseCase.willRejectRateLimit();

    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.error')?.textContent).toContain('Demasiados intentos');
    expect((el.querySelector('input[formcontrolname="email"]') as HTMLInputElement).value).toBe(
      validCredentials.email,
    );
  });

  describe('version footer', () => {
    it('renderiza el footer de versión con copy literal en initial render', () => {
      const fixture = TestBed.createComponent(LoginPage);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      const footer = el.querySelector('.version-footer');
      expect(footer).not.toBeNull();
      expect(footer?.textContent?.trim()).toBe(`Fiovi · versión ${environment.appVersion}`);
    });

    it('el footer sigue visible cuando hay errorMessage por RateLimitError', async () => {
      const fixture = TestBed.createComponent(LoginPage);
      fixture.detectChanges();
      setEmailAndPasswordViaDOM(fixture, validCredentials);
      fixture.detectChanges();
      fakeUseCase.willRejectRateLimit();

      const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
      form.dispatchEvent(new Event('submit'));
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.error')).not.toBeNull();
      const footer = el.querySelector('.version-footer');
      expect(footer).not.toBeNull();
      expect(footer?.textContent?.trim()).toBe(`Fiovi · versión ${environment.appVersion}`);
    });
  });

  // ─── SSO ────────────────────────────────────────────────────────────────
  // Los botones ahora se renderizan dinámicamente por provider desde
  // GET /auth/sso/providers (via ListSsoProvidersUseCase).

  describe('SSO providers dinámicos', () => {
    it('renderiza el botón Google cuando el backend lo devuelve en providers', async () => {
      fakeSsoProviders.willResolveWith([{ provider: 'google', displayName: 'Google' }]);
      const fixture = TestBed.createComponent(LoginPage);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const btn = el.querySelector('[data-testid="btn-sso-google"]');
      expect(btn).not.toBeNull();
      expect(btn?.textContent).toContain('Continuar con Google');
    });

    it('NO renderiza botones SSO si el backend devuelve lista vacía', async () => {
      fakeSsoProviders.willResolveWith([]);
      const fixture = TestBed.createComponent(LoginPage);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('[data-testid^="btn-sso-"]')).toBeNull();
      expect(el.querySelector('.login__divider')).toBeNull();
    });

    it('click en el botón dispara window.location.assign con la URL SSO del backend (sin slug)', async () => {
      fakeSsoProviders.willResolveWith([{ provider: 'google', displayName: 'Google' }]);
      const assignSpy = vi.fn();
      const originalLocation = window.location;
      Object.defineProperty(window, 'location', {
        writable: true,
        value: { ...originalLocation, assign: assignSpy },
      });

      try {
        const fixture = TestBed.createComponent(LoginPage);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        const btn = fixture.nativeElement.querySelector(
          '[data-testid="btn-sso-google"]',
        ) as HTMLButtonElement;
        btn.click();

        const expected = `${environment.apiBaseUrl}/auth/sso/google/start?app=pwa&returnTo=%2F`;
        expect(assignSpy).toHaveBeenCalledTimes(1);
        expect(assignSpy).toHaveBeenCalledWith(expected);
      } finally {
        Object.defineProperty(window, 'location', {
          writable: true,
          value: originalLocation,
        });
      }
    });

    // Mapping de códigos del backend post-cambio + fallback unknown.
    const errorMappings: readonly [string, string][] = [
      ['sso_disabled', 'El login con Google no está disponible en este momento.'],
      ['sso_disabled_for_tenant', 'Tu academia no permite iniciar sesión con Google.'],
      ['sso_provider_unsupported', 'Ese proveedor de login no está soportado.'],
      ['sso_no_matching_tenant', 'Ese correo no está registrado en ninguna academia.'],
      ['sso_email_not_verified', 'Verificá tu correo con Google antes de iniciar sesión.'],
      ['sso_hosted_domain_mismatch', 'Tu cuenta de Google no pertenece al dominio autorizado.'],
      ['sso_user_inactive', 'Tu cuenta está desactivada. Contactá a tu academia.'],
      ['sso_multiple_tenants', 'Iniciá sesión con tu contraseña por ahora.'],
      ['google_error', 'Google no autorizó tu ingreso. Intentá de nuevo.'],
      ['missing_params', 'Hubo un problema con Google. Intentá de nuevo.'],
      ['state_invalid', 'El intento de login expiró. Intentá de nuevo.'],
      ['weird_new_code', 'No se pudo iniciar sesión con Google. Intentá de nuevo.'],
    ];

    for (const [code, expectedMessage] of errorMappings) {
      it(`ssoError=${code} renderiza el mensaje "${expectedMessage.slice(0, 40)}…"`, async () => {
        TestBed.resetTestingModule();
        await TestBed.configureTestingModule({
          imports: [LoginPage],
          providers: [
            provideRouter([
              { path: 'login', component: LoginPage },
              { path: 'login/select-tenant', component: SelectTenantStub },
              { path: 'student/home', component: StudentHomeStub },
              { path: 'tutor/home', component: TutorHomeStub },
            ]),
            { provide: LoginUseCase, useValue: fakeUseCase },
            { provide: ListSsoProvidersUseCase, useValue: fakeSsoProviders },
            {
              provide: ActivatedRoute,
              useValue: { snapshot: { queryParams: { ssoError: code } } },
            },
          ],
        }).compileComponents();

        const fixture = TestBed.createComponent(LoginPage);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const el = fixture.nativeElement as HTMLElement;
        const errorEl = el.querySelector('.error');
        expect(errorEl).not.toBeNull();
        expect(errorEl?.textContent).toContain(expectedMessage);
      });
    }

    it('sin ssoError en la ruta, el slot .error no aparece', async () => {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [LoginPage],
        providers: [
          provideRouter([{ path: 'login', component: LoginPage }]),
          { provide: LoginUseCase, useValue: fakeUseCase },
          { provide: ListSsoProvidersUseCase, useValue: fakeSsoProviders },
          {
            provide: ActivatedRoute,
            useValue: { snapshot: { queryParams: {} } },
          },
        ],
      }).compileComponents();

      const fixture = TestBed.createComponent(LoginPage);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.error')).toBeNull();
    });
  });
});
