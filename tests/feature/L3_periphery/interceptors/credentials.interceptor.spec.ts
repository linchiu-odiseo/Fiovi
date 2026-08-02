// Tests del interceptor `credentialsInterceptor` — pieza central del nuevo
// auth contra learnex. Cubre los scenarios del spec `http-client`:
// `withCredentials: true` para `apiBaseUrl`, skip externos, refresh+retry
// reactivo ante 401, lock `shareReplay(1)` con N=3 paralelos, skip para
// URLs `/auth/*`, RefreshFailedError → LogoutUseCase fire-and-forget.
//
// El interceptor cachea el lock en una variable módulo-level
// (`refreshInFlight$`). Para evitar contaminación entre tests, cada `it`
// que ejercita refresh espera al `finalize` antes de salir.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
  HttpClient,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { credentialsInterceptor } from '../../../../src/L3_periphery/interceptors/credentials.interceptor';
import { RefreshIdentityUseCase } from '../../../../src/L2_application/use-cases/refresh-identity.use-case';
import { LogoutUseCase } from '../../../../src/L2_application/use-cases/logout.use-case';
import { RefreshFailedError } from '../../../../src/L1_domain/errors/refresh-failed.error';
import { Identity } from '../../../../src/L1_domain/entities/identity';
import { environment } from '../../../../src/environments/environment';

// Fakes de los use cases que el interceptor inyecta. NO usamos vi.fn() para
// que el contrato del use case quede explícito en cada doble.
class FakeRefreshIdentityUseCase {
  public executeCalls = 0;
  private outcome:
    | { kind: 'resolve'; identity: Identity }
    | { kind: 'reject'; error: Error }
    | { kind: 'pending' }
    | null = null;
  private pendingResolver: ((identity: Identity) => void) | null = null;
  private pendingRejecter: ((err: Error) => void) | null = null;

  willResolve(identity: Identity): void {
    this.outcome = { kind: 'resolve', identity };
  }

  willReject(error: Error): void {
    this.outcome = { kind: 'reject', error };
  }

  // Para tests de race condition: queda colgado hasta que llamemos a
  // `resolvePending()`. Permite verificar que múltiples llamadas concurrentes
  // sólo disparen 1 ejecución real.
  willStayPending(): void {
    this.outcome = { kind: 'pending' };
  }

  resolvePending(identity: Identity): void {
    this.pendingResolver?.(identity);
  }

  async execute(): Promise<Identity> {
    this.executeCalls++;
    if (!this.outcome) throw new Error('FakeRefreshIdentityUseCase: outcome no configurado');
    if (this.outcome.kind === 'reject') throw this.outcome.error;
    if (this.outcome.kind === 'resolve') return this.outcome.identity;
    // pending
    return new Promise<Identity>((resolve, reject) => {
      this.pendingResolver = resolve;
      this.pendingRejecter = reject;
    });
  }
}

class FakeLogoutUseCase {
  public executeCalls = 0;
  async execute(): Promise<void> {
    this.executeCalls++;
  }
}

const TEST_SLUG = 'vonex';

function makeIdentity(): Identity {
  return new Identity(
    'user-id',
    'tenant-id',
    TEST_SLUG,
    'alumno@vonex.edu.pe',
    '79507732',
    ['student'],
    'student',
    Date.now() + 900_000,
  );
}

describe('credentialsInterceptor', () => {
  let httpMock: HttpTestingController;
  let http: HttpClient;
  let refreshUseCase: FakeRefreshIdentityUseCase;
  let logoutUseCase: FakeLogoutUseCase;

  beforeEach(() => {
    refreshUseCase = new FakeRefreshIdentityUseCase();
    logoutUseCase = new FakeLogoutUseCase();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([credentialsInterceptor])),
        provideHttpClientTesting(),
        { provide: RefreshIdentityUseCase, useValue: refreshUseCase },
        { provide: LogoutUseCase, useValue: logoutUseCase },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    http = TestBed.inject(HttpClient);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('routing del interceptor (qué requests intercepta)', () => {
    it('request fuera de apiBaseUrl pasa sin tocar (sin withCredentials)', async () => {
      const externalUrl = 'https://otro-host.example.com/data';
      const pending = firstValueFrom(http.get(externalUrl));
      const req = httpMock.expectOne(externalUrl);
      // El interceptor no clonó la request — withCredentials sigue siendo el default (false).
      expect(req.request.withCredentials).toBe(false);
      req.flush({ ok: true });
      await pending;
    });

    it('request a apiBaseUrl recibe withCredentials: true', async () => {
      const url = `${environment.apiBaseUrl}/some/protected/resource`;
      const pending = firstValueFrom(http.get(url));
      const req = httpMock.expectOne(url);
      expect(req.request.withCredentials).toBe(true);
      req.flush({ ok: true });
      await pending;
    });
  });

  describe('skip refresh para URLs /auth/*', () => {
    it('401 en /auth/login propaga el error sin llamar refresh', async () => {
      const url = `${environment.apiBaseUrl}/t/${TEST_SLUG}/auth/login`;
      const pending = firstValueFrom(http.post(url, { email: 'x', password: 'y' }));
      const req = httpMock.expectOne(url);
      req.flush(
        { code: 'TENANT_AUTH_INVALID_CREDENTIALS' },
        { status: 401, statusText: 'Unauthorized' },
      );
      await expect(pending).rejects.toBeInstanceOf(HttpErrorResponse);
      expect(refreshUseCase.executeCalls).toBe(0);
      expect(logoutUseCase.executeCalls).toBe(0);
    });

    it('401 en /auth/refresh propaga el error sin re-llamar refresh (loop guard)', async () => {
      const url = `${environment.apiBaseUrl}/t/${TEST_SLUG}/auth/refresh`;
      const pending = firstValueFrom(http.post(url, {}));
      const req = httpMock.expectOne(url);
      req.flush(
        { code: 'TENANT_AUTH_REFRESH_TOKEN_INVALID' },
        { status: 401, statusText: 'Unauthorized' },
      );
      await expect(pending).rejects.toBeInstanceOf(HttpErrorResponse);
      expect(refreshUseCase.executeCalls).toBe(0);
    });

    it('401 en /auth/logout propaga el error sin refresh', async () => {
      const url = `${environment.apiBaseUrl}/t/${TEST_SLUG}/auth/logout`;
      const pending = firstValueFrom(http.post(url, {}));
      const req = httpMock.expectOne(url);
      req.flush(null, { status: 401, statusText: 'Unauthorized' });
      await expect(pending).rejects.toBeInstanceOf(HttpErrorResponse);
      expect(refreshUseCase.executeCalls).toBe(0);
    });

    it('401 en /auth/me propaga el error sin refresh', async () => {
      const url = `${environment.apiBaseUrl}/t/${TEST_SLUG}/auth/me`;
      const pending = firstValueFrom(http.get(url));
      const req = httpMock.expectOne(url);
      req.flush(null, { status: 401, statusText: 'Unauthorized' });
      await expect(pending).rejects.toBeInstanceOf(HttpErrorResponse);
      expect(refreshUseCase.executeCalls).toBe(0);
    });
  });

  describe('refresh + retry en endpoints protegidos', () => {
    it('401 en /student/me dispara refresh → retry exitoso devuelve el body del retry', async () => {
      refreshUseCase.willResolve(makeIdentity());
      const url = `${environment.apiBaseUrl}/t/${TEST_SLUG}/student/me`;
      const pending = firstValueFrom(http.get<{ code: string }>(url));

      // Primera request: 401.
      const first = httpMock.expectOne(url);
      expect(first.request.withCredentials).toBe(true);
      first.flush(null, { status: 401, statusText: 'Unauthorized' });

      // Tras el refresh, el interceptor reintenta la request original.
      // Necesita ciclo de microtasks para que el switchMap dispare el retry.
      await Promise.resolve();
      await Promise.resolve();

      const retry = httpMock.expectOne(url);
      expect(retry.request.withCredentials).toBe(true);
      retry.flush({ code: '79507732' });

      const result = await pending;
      expect(result).toEqual({ code: '79507732' });
      expect(refreshUseCase.executeCalls).toBe(1);
      expect(logoutUseCase.executeCalls).toBe(0);
    });

    it('500 en /student/me propaga sin tocar refresh', async () => {
      const url = `${environment.apiBaseUrl}/t/${TEST_SLUG}/student/me`;
      const pending = firstValueFrom(http.get(url));
      const req = httpMock.expectOne(url);
      req.flush('boom', { status: 500, statusText: 'Server Error' });
      await expect(pending).rejects.toBeInstanceOf(HttpErrorResponse);
      expect(refreshUseCase.executeCalls).toBe(0);
    });

    it('401 en /student/me + refresh falla con RefreshFailedError → logout fire-and-forget + propaga', async () => {
      refreshUseCase.willReject(new RefreshFailedError());
      const url = `${environment.apiBaseUrl}/t/${TEST_SLUG}/student/me`;
      const pending = firstValueFrom(http.get(url));

      const first = httpMock.expectOne(url);
      first.flush(null, { status: 401, statusText: 'Unauthorized' });

      await expect(pending).rejects.toBeInstanceOf(RefreshFailedError);
      expect(refreshUseCase.executeCalls).toBe(1);
      // LogoutUseCase es fire-and-forget — la promesa devuelta del catch ya
      // se resolvió porque execute() retornó undefined sync. Permitimos un
      // tick de microtasks por las dudas.
      await Promise.resolve();
      expect(logoutUseCase.executeCalls).toBe(1);
    });
  });

  describe('race condition — lock shareReplay(1)', () => {
    it('3 requests paralelos con 401 sólo disparan 1 refresh; los 3 reintentan con sus responses', async () => {
      refreshUseCase.willStayPending();
      const urlA = `${environment.apiBaseUrl}/t/${TEST_SLUG}/student/me`;
      const urlB = `${environment.apiBaseUrl}/t/${TEST_SLUG}/student/dashboard`;
      const urlC = `${environment.apiBaseUrl}/t/${TEST_SLUG}/student/exams`;

      // Disparamos las 3 requests en paralelo.
      const pendingA = firstValueFrom(http.get<{ name: string }>(urlA));
      const pendingB = firstValueFrom(http.get<{ name: string }>(urlB));
      const pendingC = firstValueFrom(http.get<{ name: string }>(urlC));

      // Cada uno recibe 401.
      httpMock.expectOne(urlA).flush(null, { status: 401, statusText: 'Unauthorized' });
      httpMock.expectOne(urlB).flush(null, { status: 401, statusText: 'Unauthorized' });
      httpMock.expectOne(urlC).flush(null, { status: 401, statusText: 'Unauthorized' });

      // Esperamos un ciclo de microtasks para que los 3 caigan en ensureRefreshed.
      await Promise.resolve();
      await Promise.resolve();

      // SOLO 1 refresh en vuelo aunque haya 3 caller esperando.
      expect(refreshUseCase.executeCalls).toBe(1);

      // Ahora resolvemos el refresh — los 3 reintentos deberían dispararse.
      refreshUseCase.resolvePending(makeIdentity());

      // Ciclos para que switchMap dispare los retries.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      httpMock.expectOne(urlA).flush({ name: 'A' });
      httpMock.expectOne(urlB).flush({ name: 'B' });
      httpMock.expectOne(urlC).flush({ name: 'C' });

      const [a, b, c] = await Promise.all([pendingA, pendingB, pendingC]);
      expect(a).toEqual({ name: 'A' });
      expect(b).toEqual({ name: 'B' });
      expect(c).toEqual({ name: 'C' });

      // Lock no se reusa: una sola ejecución total.
      expect(refreshUseCase.executeCalls).toBe(1);
    });

    it('lock se libera tras finalize → un 401 posterior dispara OTRO refresh', async () => {
      // Primer ciclo: refresh exitoso.
      refreshUseCase.willResolve(makeIdentity());
      const url1 = `${environment.apiBaseUrl}/t/${TEST_SLUG}/student/me`;
      const p1 = firstValueFrom(http.get(url1));
      httpMock.expectOne(url1).flush(null, { status: 401, statusText: 'Unauthorized' });
      await Promise.resolve();
      await Promise.resolve();
      httpMock.expectOne(url1).flush({ ok: 1 });
      await p1;
      expect(refreshUseCase.executeCalls).toBe(1);

      // Esperamos a que el `finalize` libere el lock.
      // El finalize se ejecuta tras el último `next` del shareReplay,
      // así que un microtask debería bastar.
      await Promise.resolve();
      await Promise.resolve();

      // Segundo ciclo: otra 401 dispara OTRO refresh (lock liberado).
      refreshUseCase.willResolve(makeIdentity());
      const url2 = `${environment.apiBaseUrl}/t/${TEST_SLUG}/student/dashboard`;
      const p2 = firstValueFrom(http.get(url2));
      httpMock.expectOne(url2).flush(null, { status: 401, statusText: 'Unauthorized' });
      await Promise.resolve();
      await Promise.resolve();
      httpMock.expectOne(url2).flush({ ok: 2 });
      await p2;
      expect(refreshUseCase.executeCalls).toBe(2);
    });
  });
});
