import { describe, it, expect, beforeEach } from 'vitest';
import { InitializeSessionUseCase } from '../../../../src/L2_application/use-cases/initialize-session.use-case';
import { Identity } from '../../../../src/L1_domain/entities/identity';
import { ServerTime } from '../../../../src/L1_domain/value-objects/server-time';
import { SessionExpiredError } from '../../../../src/L1_domain/errors/session-expired.error';
import { NetworkError } from '../../../../src/L1_domain/errors/network.error';
import { UnsupportedRoleError } from '../../../../src/L1_domain/errors/unsupported-role.error';
import { FakeAuthRepository, authSession } from '../../fixtures/auth-repository.fake';
import { FakeIdentityStorage } from '../../fixtures/identity-storage.fake';
import { FakeProfileStorage } from '../../fixtures/profile-storage.fake';
import { FakeSessionRefreshScheduler } from '../../fixtures/session-refresh-scheduler.fake';
import { FakeTenantSlugCache } from '../../fixtures/tenant-slug-cache.fake';
import { GetProfileUseCase } from '../../../../src/L2_application/use-cases/get-profile.use-case';
import { FakeClock } from '../fakes';

const NOW = 1_700_000_000_000;

const makeStudentIdentity = () =>
  new Identity(
    'uid',
    'tid',
    'vonex',
    'alumno@vonex.edu.pe',
    '79507732',
    ['student'],
    'student',
    NOW + 900_000,
  );

const makeTutorIdentity = () =>
  new Identity('uid2', 'tid', 'vonex', 'tutor@vonex.pe', null, ['tutor'], 'tutor', NOW + 900_000);

describe('InitializeSessionUseCase', () => {
  let repo: FakeAuthRepository;
  let identityStorage: FakeIdentityStorage;
  let profileStorage: FakeProfileStorage;
  let slugCache: FakeTenantSlugCache;
  let refreshScheduler: FakeSessionRefreshScheduler;
  let getProfile: GetProfileUseCase;
  let clock: FakeClock;
  let useCase: InitializeSessionUseCase;

  beforeEach(() => {
    repo = new FakeAuthRepository();
    identityStorage = new FakeIdentityStorage();
    profileStorage = new FakeProfileStorage();
    slugCache = new FakeTenantSlugCache();
    refreshScheduler = new FakeSessionRefreshScheduler();
    getProfile = new GetProfileUseCase(profileStorage, repo);
    clock = new FakeClock();
    useCase = new InitializeSessionUseCase(
      repo,
      identityStorage,
      slugCache,
      getProfile,
      refreshScheduler,
      clock,
    );
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
      repo.willResolveMe(authSession(identity));
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
      repo.willResolveMe(authSession(fresh));
      repo.willRejectProfile(new Error('no profile needed'));
      const result = await useCase.execute();
      expect(result).toBe(fresh);
      expect(slugCache.current()).toBe('vonex');
    });

    it('happy path tutor', async () => {
      const stored = makeTutorIdentity();
      await identityStorage.write(stored);
      const fresh = makeTutorIdentity();
      repo.willResolveMe(authSession(fresh));
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
      repo.willResolveMe(authSession(identity));
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

  describe('proactive refresh scheduler', () => {
    it('me() exitoso agenda el scheduler con el expiresAt de la identity fresh', async () => {
      slugCache.set('vonex');
      const identity = makeStudentIdentity();
      repo.willResolveMe(authSession(identity));
      repo.willRejectProfile(new Error('no profile'));
      await useCase.execute();
      expect(refreshScheduler.scheduleCalls).toEqual([identity.expiresAt]);
    });

    it('me() con SessionExpiredError NO agenda scheduler (no hay identity valida)', async () => {
      slugCache.set('vonex');
      repo.willRejectMe(new SessionExpiredError());
      await useCase.execute();
      expect(refreshScheduler.scheduleCalls).toEqual([]);
    });

    it('sin slug ni identity previa NO agenda scheduler (no autenticado)', async () => {
      await useCase.execute();
      expect(refreshScheduler.scheduleCalls).toEqual([]);
    });

    it('me() con NetworkError NO agenda scheduler; UI muestra offline', async () => {
      slugCache.set('vonex');
      repo.willRejectMe(new NetworkError());
      await expect(useCase.execute()).rejects.toBeInstanceOf(NetworkError);
      expect(refreshScheduler.scheduleCalls).toEqual([]);
    });
  });

  describe('calibración del Clock', () => {
    it('me() exitoso con serverTime calibra el Clock antes de agendar el refresh', async () => {
      slugCache.set('vonex');
      const identity = makeStudentIdentity();
      const serverTime = new ServerTime('2026-09-14T15:07:11.123Z');
      repo.willResolveMe(authSession(identity, serverTime));
      repo.willRejectProfile(new Error('no profile'));

      const order: string[] = [];
      const originalSetServerTime = clock.setServerTime.bind(clock);
      clock.setServerTime = (st) => {
        order.push('calibrate');
        originalSetServerTime(st);
      };
      const originalSchedule = refreshScheduler.schedule.bind(refreshScheduler);
      refreshScheduler.schedule = (expiresAt) => {
        order.push('schedule');
        originalSchedule(expiresAt);
      };

      await useCase.execute();

      expect(clock.getSetServerTimeCalls()).toEqual([serverTime]);
      expect(order).toEqual(['calibrate', 'schedule']);
    });

    it('me() exitoso sin serverTime NO calibra el Clock', async () => {
      slugCache.set('vonex');
      const identity = makeStudentIdentity();
      repo.willResolveMe(authSession(identity));
      repo.willRejectProfile(new Error('no profile'));

      await useCase.execute();

      expect(clock.getSetServerTimeCalls()).toEqual([]);
    });

    it('me() con SessionExpiredError/UnsupportedRoleError/NetworkError NO calibra el Clock', async () => {
      slugCache.set('vonex');
      repo.willRejectMe(new SessionExpiredError());
      await useCase.execute();
      expect(clock.getSetServerTimeCalls()).toEqual([]);
    });
  });
});
