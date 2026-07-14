import { describe, it, expect, beforeEach } from 'vitest';
import { InitializeSessionUseCase } from '../../../../src/L2_application/use-cases/initialize-session.use-case';
import { Identity } from '../../../../src/L1_domain/entities/identity';
import { SessionExpiredError } from '../../../../src/L1_domain/errors/session-expired.error';
import { NetworkError } from '../../../../src/L1_domain/errors/network.error';
import { UnsupportedRoleError } from '../../../../src/L1_domain/errors/unsupported-role.error';
import { FakeAuthRepository } from '../../fixtures/auth-repository.fake';
import { FakeIdentityStorage } from '../../fixtures/identity-storage.fake';
import { FakeProfileStorage } from '../../fixtures/profile-storage.fake';
import { FakeTenantSlugCache } from '../../fixtures/tenant-slug-cache.fake';
import { GetProfileUseCase } from '../../../../src/L2_application/use-cases/get-profile.use-case';

const NOW = 1_700_000_000_000;

const makeStudentIdentity = () =>
  new Identity(
    'uid',
    'tid',
    'vonex',
    'alumno@vonex.edu.pe',
    '79507732',
    ['student'],
    [],
    NOW + 900_000,
  );

const makeTutorIdentity = () =>
  new Identity('uid2', 'tid', 'vonex', 'tutor@vonex.pe', null, ['tutor'], [], NOW + 900_000);

describe('InitializeSessionUseCase', () => {
  let repo: FakeAuthRepository;
  let identityStorage: FakeIdentityStorage;
  let profileStorage: FakeProfileStorage;
  let slugCache: FakeTenantSlugCache;
  let getProfile: GetProfileUseCase;
  let useCase: InitializeSessionUseCase;

  beforeEach(() => {
    repo = new FakeAuthRepository();
    identityStorage = new FakeIdentityStorage();
    profileStorage = new FakeProfileStorage();
    slugCache = new FakeTenantSlugCache();
    getProfile = new GetProfileUseCase(profileStorage, repo);
    useCase = new InitializeSessionUseCase(repo, identityStorage, slugCache, getProfile);
  });

  describe('sin slug hidratado ni identity previa', () => {
    it('devuelve null sin llamar me() — asumimos no autenticado', async () => {
      const result = await useCase.execute();
      expect(result).toBeNull();
      expect(repo.getMeCalls()).toBe(0);
      expect(slugCache.current()).toBeNull();
    });
  });

  describe('slug hidratado por el SsoCallbackBootstrap (?slug= en URL)', () => {
    it('llama me() con el slug ya seteado, hidrata identity y devuelve Identity', async () => {
      slugCache.set('vonex');
      const identity = makeStudentIdentity();
      repo.willResolveMe(identity);
      repo.willRejectProfile(new Error('no profile needed'));
      const result = await useCase.execute();
      expect(result).toBe(identity);
      expect(await identityStorage.read()).toBe(identity);
      expect(slugCache.current()).toBe('vonex');
    });
  });

  describe('identity previa en storage (sesión previa)', () => {
    it('hidrata slug desde storage, llama me() y devuelve Identity actualizada', async () => {
      const stored = makeStudentIdentity();
      await identityStorage.write(stored);
      const fresh = makeStudentIdentity();
      repo.willResolveMe(fresh);
      repo.willRejectProfile(new Error('no profile needed'));
      const result = await useCase.execute();
      expect(result).toBe(fresh);
      expect(slugCache.current()).toBe('vonex');
    });

    it('happy path tutor', async () => {
      const stored = makeTutorIdentity();
      await identityStorage.write(stored);
      const fresh = makeTutorIdentity();
      repo.willResolveMe(fresh);
      repo.willRejectProfile(new Error('no profile needed'));
      const result = await useCase.execute();
      expect(result?.role()).toBe('tutor');
    });
  });

  describe('SessionExpiredError (401)', () => {
    it('limpia storage + slugCache y devuelve null', async () => {
      const identity = makeStudentIdentity();
      await identityStorage.write(identity);
      repo.willRejectMe(new SessionExpiredError());
      const result = await useCase.execute();
      expect(result).toBeNull();
      expect(await identityStorage.read()).toBeNull();
      expect(slugCache.current()).toBeNull();
    });
  });

  describe('NetworkError', () => {
    it('no toca storage y el error se propaga', async () => {
      const identity = makeStudentIdentity();
      await identityStorage.write(identity);
      repo.willRejectMe(new NetworkError());
      await expect(useCase.execute()).rejects.toThrow(NetworkError);
      expect(await identityStorage.read()).toBe(identity);
    });
  });

  describe('profile fetch fallido', () => {
    it('es silencioso (fire-and-forget)', async () => {
      slugCache.set('vonex');
      const identity = makeStudentIdentity();
      repo.willResolveMe(identity);
      repo.willRejectProfile(new NetworkError('profile 503'));
      const result = await useCase.execute();
      expect(result).toBe(identity);
    });
  });

  describe('UnsupportedRoleError', () => {
    it('invoca logout best-effort + limpia storage + slugCache + devuelve null', async () => {
      const identity = makeStudentIdentity();
      await identityStorage.write(identity);
      repo.willRejectMe(new UnsupportedRoleError('admin'));

      const result = await useCase.execute();

      expect(result).toBeNull();
      expect(await identityStorage.read()).toBeNull();
      expect(slugCache.current()).toBeNull();
      expect(repo.getLogoutCalls()).toBe(1);
    });

    it('si logout best-effort falla, igual limpia local y devuelve null', async () => {
      const identity = makeStudentIdentity();
      await identityStorage.write(identity);
      repo.willRejectMe(new UnsupportedRoleError('teacher'));
      repo.willRejectLogout();

      const result = await useCase.execute();

      expect(result).toBeNull();
      expect(await identityStorage.read()).toBeNull();
    });
  });
});
