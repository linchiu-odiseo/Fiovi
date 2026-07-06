import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Component } from '@angular/core';
import { LoginPage } from '../../../../../src/LR_render/pages/login/login.page';
import { LoginUseCase } from '../../../../../src/L2_application/use-cases/login.use-case';
import { Identity } from '../../../../../src/L1_domain/entities/identity';
import { InvalidCredentialsError } from '../../../../../src/L1_domain/errors/invalid-credentials.error';
import { NetworkError } from '../../../../../src/L1_domain/errors/network.error';
import { RateLimitError } from '../../../../../src/L1_domain/errors/rate-limit.error';
import { environment } from '../../../../../src/environments/environment';

@Component({ template: '' })
class StudentHomeStub {}

@Component({ template: '' })
class TutorHomeStub {}

function buildIdentity(role: 'student' | 'tutor' = 'student'): Identity {
  const email = role === 'student' ? '79507732@vonex.edu.pe' : 'tutor1@vonex.pe';
  const codigo = role === 'student' ? '79507732' : null;
  return new Identity('user-id', 'tenant-id', email, codigo, [role], [], Date.now() + 900_000);
}

class FakeLoginUseCase {
  private nextOutcome:
    | { kind: 'ok'; role: 'student' | 'tutor' }
    | { kind: 'reject'; error: Error } = { kind: 'ok', role: 'student' };
  public calls: { email: string; password: string }[] = [];

  willResolveAs(role: 'student' | 'tutor') {
    this.nextOutcome = { kind: 'ok', role };
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

  async execute(credentials: { email: string; password: string }): Promise<Identity> {
    this.calls.push(credentials);
    if (this.nextOutcome.kind === 'reject') throw this.nextOutcome.error;
    return buildIdentity(this.nextOutcome.role);
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

  beforeEach(async () => {
    fakeUseCase = new FakeLoginUseCase();
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        provideRouter([
          { path: 'login', component: LoginPage },
          { path: 'student/home', component: StudentHomeStub },
          { path: 'tutor/home', component: TutorHomeStub },
        ]),
        { provide: LoginUseCase, useValue: fakeUseCase },
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

  it('submit exitoso con identity student invoca LoginUseCase con las credenciales y navega a /student/home', async () => {
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
    // 15.1 — Render inicial: el footer aparece con el copy literal y la
    // versión leída desde environment.appVersion (no acoplamos a un string
    // hardcoded: leemos lo que el build generó).
    it('renderiza el footer de versión con copy literal en initial render', () => {
      const fixture = TestBed.createComponent(LoginPage);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      const footer = el.querySelector('.version-footer');
      expect(footer).not.toBeNull();
      expect(footer?.textContent?.trim()).toBe(`Fiovi · versión ${environment.appVersion}`);
    });

    // 15.2 — El footer sigue visible aún con un error de form activo
    // (ej. RateLimitError): el copy no se pierde por el banner de error.
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
      // Confirmamos que el error sí está renderizado (precondición del test).
      expect(el.querySelector('.error')).not.toBeNull();
      // Y que el footer no fue desplazado/ocultado por el banner.
      const footer = el.querySelector('.version-footer');
      expect(footer).not.toBeNull();
      expect(footer?.textContent?.trim()).toBe(`Fiovi · versión ${environment.appVersion}`);
    });
  });
});
