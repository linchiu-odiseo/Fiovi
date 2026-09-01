import { describe, it, expect, beforeEach } from 'vitest';
import { LoginUseCase } from '../../../../src/L2_application/use-cases/login.use-case';
import { Identity } from '../../../../src/L1_domain/entities/identity';
import { SelectionChallenge } from '../../../../src/L1_domain/value-objects/selection-challenge';
import { InvalidCredentialsError } from '../../../../src/L1_domain/errors/invalid-credentials.error';
import { RateLimitError } from '../../../../src/L1_domain/errors/rate-limit.error';
import { NetworkError } from '../../../../src/L1_domain/errors/network.error';
import { FakeAuthRepository } from '../../fixtures/auth-repository.fake';
import { FakeIdentityStorage } from '../../fixtures/identity-storage.fake';
import { FakeProfileStorage } from '../../fixtures/profile-storage.fake';
import { FakePwaCookieModeStore } from '../../fixtures/pwa-cookie-mode-store.fake';
import { FakeSessionRefreshScheduler } from '../../fixtures/session-refresh-scheduler.fake';
import { FakeTenantSlugCache } from '../../fixtures/tenant-slug-cache.fake';
import { GetProfileUseCase } from '../../../../src/L2_application/use-cases/get-profile.use-case';

const NOW = 1_700_000_000_000;

const makeStudentIdentity = () =>
  new Identity(
    '766aac21-71f9-4f48-a14a-5c2bcebc7d0b',
    '5fff5eec-34dc-40a2-b15e-10e503e7c2dc',
    'vonex',
    '79507732@vonex.edu.pe',
    '79507732',
    ['student'],
    'student',
    NOW + 900_000,
  );

const makeTutorIdentity = () =>
  new Identity(
    '7526d026-7de5-4b99-bd2f-cc95b560f630',
    '5fff5eec-34dc-40a2-b15e-10e503e7c2dc',
    'vonex',
    'tutor1@vonex.pe',
    null,
    ['tutor'],
    'tutor',
    NOW + 900_000,
  );

const makeChallenge = (): SelectionChallenge => ({
  selectionToken: 'jwt-token',
  selectionExpiresAt: NOW + 5 * 60 * 1000,
  tenants: [
    { slug: 'vonex', name: 'Vonex' },
    { slug: 'pitagoras', name: 'Pitágoras' },
  ],
});

// Helper para narrowing en aserciones — LoginOutcome es Identity | SelectionChallenge.
function asIdentity(outcome: Identity | SelectionChallenge): Identity {
  if ('selectionToken' in outcome) {
    throw new Error('expected Identity, got SelectionChallenge');
  }
  return outcome;
}

describe('LoginUseCase', () => {
  let repo: FakeAuthRepository;
  let identityStorage: FakeIdentityStorage;
  let profileStorage: FakeProfileStorage;
  let slugCache: FakeTenantSlugCache;
  let pwaCookieMode: FakePwaCookieModeStore;
  let refreshScheduler: FakeSessionRefreshScheduler;
  let getProfile: GetProfileUseCase;
  let useCase: LoginUseCase;

  const credentials = { email: '79507732@vonex.edu.pe', password: '79507732' };

  beforeEach(() => {
    repo = new FakeAuthRepository();
    identityStorage = new FakeIdentityStorage();
    profileStorage = new FakeProfileStorage();
    slugCache = new FakeTenantSlugCache();
    pwaCookieMode = new FakePwaCookieModeStore();
    refreshScheduler = new FakeSessionRefreshScheduler();
    getProfile = new GetProfileUseCase(profileStorage, repo);
    useCase = new LoginUseCase(
      repo,
      identityStorage,
      slugCache,
      getProfile,
      pwaCookieMode,
      refreshScheduler,
    );
  });

  it('login de alumno exitoso devuelve Identity con role student', async () => {
    const identity = makeStudentIdentity();
    repo.willResolveLogin(identity);
    repo.willRejectProfile(new Error('no profile needed in this test'));
    const result = await useCase.execute(credentials);
    expect(result).toBe(identity);
    expect(asIdentity(result).role()).toBe('student');
  });

  it('login exitoso persiste la Identity en storage', async () => {
    const identity = makeStudentIdentity();
    repo.willResolveLogin(identity);
    repo.willRejectProfile(new Error('no profile'));
    await useCase.execute(credentials);
    expect(await identityStorage.read()).toBe(identity);
  });

  it('login exitoso hidrata el SlugStore con el tenantSlug del Identity', async () => {
    const identity = makeStudentIdentity();
    repo.willResolveLogin(identity);
    repo.willRejectProfile(new Error('no profile'));
    expect(slugCache.current()).toBeNull();
    await useCase.execute(credentials);
    expect(slugCache.current()).toBe('vonex');
  });

  it('login con SelectionChallenge NO persiste identity ni toca SlugCache', async () => {
    const challenge = makeChallenge();
    repo.willResolveLogin(challenge);
    const result = await useCase.execute(credentials);
    expect(result).toBe(challenge);
    expect(await identityStorage.read()).toBeNull();
    expect(slugCache.current()).toBeNull();
  });

  it('login de tutor exitoso devuelve Identity con role tutor y codigo null', async () => {
    const identity = makeTutorIdentity();
    repo.willResolveLogin(identity);
    repo.willRejectProfile(new Error('no profile'));
    const result = await useCase.execute({ email: 'tutor1@vonex.pe', password: 'tutor123' });
    expect(asIdentity(result).role()).toBe('tutor');
    expect(asIdentity(result).codigo).toBeNull();
  });

  it('InvalidCredentialsError se propaga sin escribir en storage', async () => {
    repo.willRejectLogin(new InvalidCredentialsError());
    await expect(useCase.execute(credentials)).rejects.toThrow(InvalidCredentialsError);
    expect(await identityStorage.read()).toBeNull();
    expect(slugCache.current()).toBeNull();
  });

  it('RateLimitError se propaga', async () => {
    repo.willRejectLogin(new RateLimitError());
    await expect(useCase.execute(credentials)).rejects.toThrow(RateLimitError);
  });

  it('NetworkError se propaga sin tocar storage', async () => {
    repo.willRejectLogin(new NetworkError());
    await expect(useCase.execute(credentials)).rejects.toThrow(NetworkError);
    expect(await identityStorage.read()).toBeNull();
  });

  it('profile fetch falla silenciosamente (fire-and-forget no bloquea)', async () => {
    const identity = makeStudentIdentity();
    repo.willResolveLogin(identity);
    repo.willRejectProfile(new NetworkError('profile fetch failed'));
    const result = await useCase.execute(credentials);
    expect(result).toBe(identity);
  });

  it('identity se escribe en storage antes de retornar', async () => {
    const written: Identity[] = [];
    const identity = makeStudentIdentity();
    repo.willResolveLogin(identity);
    repo.willRejectProfile(new Error('no profile'));
    const originalWrite = identityStorage.write.bind(identityStorage);
    identityStorage.write = async (_id: Identity) => {
      written.push(_id);
      return originalWrite(_id);
    };
    await useCase.execute(credentials);
    expect(written).toHaveLength(1);
    expect(written[0]).toBe(identity);
  });

  it('propaga captchaToken al repositorio cuando viene en las credenciales', async () => {
    const identity = makeStudentIdentity();
    repo.willResolveLogin(identity);
    repo.willRejectProfile(new Error('no profile'));
    await useCase.execute({ ...credentials, captchaToken: 'turnstile-token-xyz' });
    expect(repo.getLoginCalls()).toEqual([{ ...credentials, captchaToken: 'turnstile-token-xyz' }]);
  });

  it('omite captchaToken cuando no viene (dev con captcha deshabilitado)', async () => {
    const identity = makeStudentIdentity();
    repo.willResolveLogin(identity);
    repo.willRejectProfile(new Error('no profile'));
    await useCase.execute(credentials);
    const [call] = repo.getLoginCalls();
    expect(call).toEqual(credentials);
    expect(call.captchaToken).toBeUndefined();
  });

  it('fire-and-forget: execute devuelve identity sin esperar al profile fetch', async () => {
    const identity = makeStudentIdentity();
    repo.willResolveLogin(identity);
    repo.willResolveProfile({
      id: 'p1',
      code: '79507732',
      firstName: 'Gabriel',
      lastName: 'Acuña',
      area: null,
    });
    const result = await useCase.execute(credentials);
    expect(result).toBe(identity);
    expect(await identityStorage.read()).toBe(identity);
    await new Promise((r) => setTimeout(r, 0));
  });

  describe('proactive refresh scheduler', () => {
    it('login exitoso (Identity) agenda el scheduler con el expiresAt de la identity', async () => {
      const identity = makeStudentIdentity();
      repo.willResolveLogin(identity);
      repo.willRejectProfile(new Error('no profile'));
      await useCase.execute(credentials);
      expect(refreshScheduler.scheduleCalls).toEqual([identity.expiresAt]);
      expect(refreshScheduler.cancelCalls).toBe(0);
    });

    it('login con SelectionChallenge NO agenda el scheduler (auth incompleta)', async () => {
      repo.willResolveLogin(makeChallenge());
      await useCase.execute(credentials);
      // El schedule ocurrira en SelectTenantUseCase cuando el user elija tenant.
      expect(refreshScheduler.scheduleCalls).toEqual([]);
    });

    it('login fallido (InvalidCredentialsError) NO agenda el scheduler', async () => {
      repo.willRejectLogin(new InvalidCredentialsError());
      await expect(useCase.execute(credentials)).rejects.toThrow(InvalidCredentialsError);
      expect(refreshScheduler.scheduleCalls).toEqual([]);
    });
  });

  describe('PWA cookie mode flag', () => {
    it('login exitoso (Identity) enciende el flag', async () => {
      const identity = makeStudentIdentity();
      repo.willResolveLogin(identity);
      repo.willRejectProfile(new Error('no profile'));
      expect(pwaCookieMode.isEnabled()).toBe(false);
      await useCase.execute(credentials);
      expect(pwaCookieMode.isEnabled()).toBe(true);
      expect(pwaCookieMode.enableCalls).toBe(1);
    });

    it('login con SelectionChallenge NO enciende el flag (auth incompleta)', async () => {
      repo.willResolveLogin(makeChallenge());
      await useCase.execute(credentials);
      // El flag se prenderá cuando SelectTenantUseCase complete la auth
      // — no acá. Sesiones pre-migración que caen a selector no deben
      // migrarse hasta terminar el flow.
      expect(pwaCookieMode.isEnabled()).toBe(false);
      expect(pwaCookieMode.enableCalls).toBe(0);
    });

    it('login fallido (InvalidCredentialsError) NO enciende el flag', async () => {
      repo.willRejectLogin(new InvalidCredentialsError());
      await expect(useCase.execute(credentials)).rejects.toThrow(InvalidCredentialsError);
      // CRÍTICO: usuarios pre-migración que se equivocan la clave no
      // deben quedarse en modo pwa sin cookies pwa — eso los desloguearía
      // en el próximo request. El flag solo se prende con backend confirmando.
      expect(pwaCookieMode.isEnabled()).toBe(false);
    });

    it('login fallido (RateLimitError) NO enciende el flag', async () => {
      repo.willRejectLogin(new RateLimitError());
      await expect(useCase.execute(credentials)).rejects.toThrow(RateLimitError);
      expect(pwaCookieMode.isEnabled()).toBe(false);
    });

    it('login fallido (NetworkError) NO enciende el flag', async () => {
      repo.willRejectLogin(new NetworkError());
      await expect(useCase.execute(credentials)).rejects.toThrow(NetworkError);
      expect(pwaCookieMode.isEnabled()).toBe(false);
    });
  });
});
