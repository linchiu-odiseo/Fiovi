import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Component } from '@angular/core';
import { LoginViewModel } from '../../../../src/LR_render/view-models/login.view-model';
import { LoginUseCase } from '../../../../src/L2_application/use-cases/login.use-case';
import { ListSsoProvidersUseCase } from '../../../../src/L2_application/use-cases/list-sso-providers.use-case';
import { Identity } from '../../../../src/L1_domain/entities/identity';
import { SelectionChallenge } from '../../../../src/L1_domain/value-objects/selection-challenge';
import { SsoProvider } from '../../../../src/L1_domain/value-objects/sso-provider';
import { AccountNotActiveError } from '../../../../src/L1_domain/errors/account-not-active.error';
import { InvalidCredentialsError } from '../../../../src/L1_domain/errors/invalid-credentials.error';
import { NetworkError } from '../../../../src/L1_domain/errors/network.error';
import { RateLimitError } from '../../../../src/L1_domain/errors/rate-limit.error';
import { UnsupportedRoleError } from '../../../../src/L1_domain/errors/unsupported-role.error';

// Stubs de ruta para que provideRouter pueda navegar realmente y no quejarse.
@Component({ template: '' })
class StudentHomeStub {}

@Component({ template: '' })
class TutorHomeStub {}

@Component({ template: '' })
class SelectTenantStub {}

class FakeListSsoProvidersUseCase {
  async execute(): Promise<SsoProvider[]> {
    return [];
  }
}

// Fake del LoginUseCase. Lo controlamos por `willResolveAs` / `willRejectWith`.
// Devuelve una Identity instanciada de verdad (no un stub) para que `identity.role()`
// funcione sin mocks adicionales.
class FakeLoginUseCase {
  private next:
    | { kind: 'resolve'; outcome: Identity | SelectionChallenge }
    | { kind: 'reject'; error: Error } = {
    kind: 'resolve',
    outcome: buildIdentity('student'),
  };
  public calls: { email: string; password: string }[] = [];
  // Permite suspender la promesa para verificar isSubmitting=true durante el await.
  private pending: Promise<unknown> | null = null;
  private resolvePending: ((v: Identity | SelectionChallenge) => void) | null = null;
  private rejectPending: ((err: Error) => void) | null = null;

  willResolveAs(role: 'student' | 'tutor') {
    this.next = { kind: 'resolve', outcome: buildIdentity(role) };
  }

  willResolveSelection(challenge: SelectionChallenge) {
    this.next = { kind: 'resolve', outcome: challenge };
  }

  willRejectWith(error: Error) {
    this.next = { kind: 'reject', error };
  }

  /** Modo manual: el caller controla la resolución/rechazo vía resolveNow/rejectNow. */
  willSuspend() {
    this.next = { kind: 'resolve', outcome: buildIdentity('student') };
    this.pending = new Promise<Identity | SelectionChallenge>((resolve, reject) => {
      this.resolvePending = resolve;
      this.rejectPending = reject;
    });
  }
  resolveNow(role: 'student' | 'tutor' = 'student') {
    this.resolvePending?.(buildIdentity(role));
    this.pending = null;
    this.resolvePending = null;
    this.rejectPending = null;
  }
  rejectNow(err: Error) {
    this.rejectPending?.(err);
    this.pending = null;
    this.resolvePending = null;
    this.rejectPending = null;
  }

  async execute(credentials: {
    email: string;
    password: string;
  }): Promise<Identity | SelectionChallenge> {
    this.calls.push(credentials);
    if (this.pending) {
      const outcome = (await this.pending) as Identity | SelectionChallenge;
      return outcome;
    }
    if (this.next.kind === 'reject') throw this.next.error;
    return this.next.outcome;
  }
}

function buildIdentity(role: 'student' | 'tutor'): Identity {
  // Email coherente con el rol — no es load-bearing, pero mantiene el realismo.
  const email = role === 'student' ? '79507732@vonex.edu.pe' : 'tutor1@vonex.pe';
  const codigo = role === 'student' ? '79507732' : null;
  return new Identity(
    'user-id',
    'tenant-id',
    'vonex',
    email,
    codigo,
    [role],
    role,
    Date.now() + 900_000,
  );
}

const validCredentials = { email: 'fulano@panda.test', password: '12345678' };

describe('LoginViewModel', () => {
  let fakeUseCase: FakeLoginUseCase;

  // Instanciamos el VM dentro del contexto de inyección para que inject()
  // resuelva contra los providers del TestBed.
  const createVm = (): LoginViewModel => TestBed.runInInjectionContext(() => new LoginViewModel());

  beforeEach(async () => {
    fakeUseCase = new FakeLoginUseCase();
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'student/home', component: StudentHomeStub },
          { path: 'tutor/home', component: TutorHomeStub },
          { path: 'login/select-tenant', component: SelectTenantStub },
        ]),
        { provide: LoginUseCase, useValue: fakeUseCase },
        { provide: ListSsoProvidersUseCase, useValue: new FakeListSsoProvidersUseCase() },
      ],
    }).compileComponents();
  });

  describe('submit() — outcomes', () => {
    it('login student exitoso navega a /student/home y devuelve "ok"', async () => {
      fakeUseCase.willResolveAs('student');
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate');

      const vm = createVm();
      const outcome = await vm.submit(validCredentials);

      expect(outcome).toBe('ok');
      expect(fakeUseCase.calls).toEqual([validCredentials]);
      expect(navigateSpy).toHaveBeenCalledWith(['/student/home']);
      expect(vm.errorMessage()).toBeNull();
    });

    it('login tutor exitoso navega a /tutor/home y devuelve "ok"', async () => {
      fakeUseCase.willResolveAs('tutor');
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate');

      const vm = createVm();
      const outcome = await vm.submit(validCredentials);

      expect(outcome).toBe('ok');
      expect(navigateSpy).toHaveBeenCalledWith(['/tutor/home']);
      expect(vm.errorMessage()).toBeNull();
    });

    it('InvalidCredentialsError → errorMessage="Credenciales inválidas" y devuelve "invalid"', async () => {
      fakeUseCase.willRejectWith(new InvalidCredentialsError());
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate');

      const vm = createVm();
      const outcome = await vm.submit(validCredentials);

      expect(outcome).toBe('invalid');
      expect(vm.errorMessage()).toBe('Credenciales inválidas');
      expect(navigateSpy).not.toHaveBeenCalled();
    });

    it('AccountNotActiveError → errorMessage con copy accionable y devuelve "account-not-active"', async () => {
      fakeUseCase.willRejectWith(new AccountNotActiveError());
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate');

      const vm = createVm();
      const outcome = await vm.submit(validCredentials);

      expect(outcome).toBe('account-not-active');
      expect(vm.errorMessage()).toBe(
        'Tu cuenta no está activa. Contacta a tu institución para reactivarla.',
      );
      expect(navigateSpy).not.toHaveBeenCalled();
    });

    it('RateLimitError → errorMessage con el copy es-PE y devuelve "rate-limit"', async () => {
      fakeUseCase.willRejectWith(new RateLimitError());
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate');

      const vm = createVm();
      const outcome = await vm.submit(validCredentials);

      expect(outcome).toBe('rate-limit');
      expect(vm.errorMessage()).toBe('Demasiados intentos, esperá un minuto.');
      expect(navigateSpy).not.toHaveBeenCalled();
    });

    it('NetworkError → errorMessage con el copy es-PE y devuelve "network"', async () => {
      fakeUseCase.willRejectWith(new NetworkError());
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate');

      const vm = createVm();
      const outcome = await vm.submit(validCredentials);

      expect(outcome).toBe('network');
      expect(vm.errorMessage()).toBe('No se pudo conectar al servidor. Inténtalo de nuevo.');
      expect(navigateSpy).not.toHaveBeenCalled();
    });

    it('UnsupportedRoleError → errorMessage con el copy es-PE y devuelve "unsupported-role"', async () => {
      fakeUseCase.willRejectWith(new UnsupportedRoleError('admin'));
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate');

      const vm = createVm();
      const outcome = await vm.submit(validCredentials);

      expect(outcome).toBe('unsupported-role');
      expect(vm.errorMessage()).toBe(
        'Esta aplicación está disponible solo para alumnos y tutores. Contactá a tu administrador.',
      );
      expect(navigateSpy).not.toHaveBeenCalled();
    });

    it('error genérico no modelado se re-lanza para no silenciar bugs', async () => {
      fakeUseCase.willRejectWith(new Error('boom — bug del programador'));
      const vm = createVm();
      await expect(vm.submit(validCredentials)).rejects.toThrow('boom — bug del programador');
    });
  });

  describe('isSubmitting() — toggle durante el await', () => {
    it('queda en true durante el await y vuelve a false al resolverse OK', async () => {
      fakeUseCase.willSuspend();
      const vm = createVm();
      expect(vm.isSubmitting()).toBe(false);

      const pending = vm.submit(validCredentials);
      // Cedemos microtasks para que la promesa interna avance hasta el await del use case.
      await Promise.resolve();
      expect(vm.isSubmitting()).toBe(true);

      fakeUseCase.resolveNow('student');
      await pending;
      expect(vm.isSubmitting()).toBe(false);
    });

    it('queda en true durante el await y vuelve a false al rechazar', async () => {
      fakeUseCase.willSuspend();
      const vm = createVm();

      const pending = vm.submit(validCredentials);
      await Promise.resolve();
      expect(vm.isSubmitting()).toBe(true);

      fakeUseCase.rejectNow(new InvalidCredentialsError());
      await pending;
      expect(vm.isSubmitting()).toBe(false);
    });
  });

  describe('errorMessage() — reset al inicio de cada submit', () => {
    it('un submit nuevo limpia el errorMessage del submit anterior', async () => {
      fakeUseCase.willRejectWith(new InvalidCredentialsError());
      const vm = createVm();
      await vm.submit(validCredentials);
      expect(vm.errorMessage()).toBe('Credenciales inválidas');

      // Segundo submit: éxito. El errorMessage debe quedar null antes y después.
      fakeUseCase.willResolveAs('student');
      await vm.submit(validCredentials);
      expect(vm.errorMessage()).toBeNull();
    });

    it('durante el await del segundo submit, errorMessage ya es null (reseteo eager)', async () => {
      fakeUseCase.willRejectWith(new InvalidCredentialsError());
      const vm = createVm();
      await vm.submit(validCredentials);
      expect(vm.errorMessage()).toBe('Credenciales inválidas');

      fakeUseCase.willSuspend();
      const pending = vm.submit(validCredentials);
      await Promise.resolve();
      // El reset ocurre antes del primer await — durante el use case errorMessage es null.
      expect(vm.errorMessage()).toBeNull();

      fakeUseCase.resolveNow('student');
      await pending;
    });
  });
});
