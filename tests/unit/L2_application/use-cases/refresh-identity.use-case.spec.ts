import { describe, it, expect, beforeEach } from 'vitest';
import { RefreshIdentityUseCase } from '../../../../src/L2_application/use-cases/refresh-identity.use-case';
import { Identity } from '../../../../src/L1_domain/entities/identity';
import { RefreshFailedError } from '../../../../src/L1_domain/errors/refresh-failed.error';
import { NetworkError } from '../../../../src/L1_domain/errors/network.error';
import { FakeAuthRepository } from '../../fixtures/auth-repository.fake';
import { FakeIdentityStorage } from '../../fixtures/identity-storage.fake';
import { FakeProfileStorage } from '../../fixtures/profile-storage.fake';
import { FakeSessionRefreshScheduler } from '../../fixtures/session-refresh-scheduler.fake';
import { FakeTenantSlugCache } from '../../fixtures/tenant-slug-cache.fake';
import { LogoutUseCase } from '../../../../src/L2_application/use-cases/logout.use-case';
import { RouterPort } from '../../../../src/L1_domain/ports/router-port';
import { DraftDispatcher } from '../../../../src/L1_domain/ports/draft-dispatcher';
import { GetProfileUseCase } from '../../../../src/L2_application/use-cases/get-profile.use-case';

const NOW = 1_700_000_000_000;

const makeIdentity = () =>
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

class FakeRouter implements RouterPort {
  navigate(_commands: unknown[]): void {
    return;
  }
}

class FakeDraftDispatcher implements DraftDispatcher {
  wipeAll(): void {
    /* no-op */
  }
}

describe('RefreshIdentityUseCase', () => {
  let repo: FakeAuthRepository;
  let identityStorage: FakeIdentityStorage;
  let profileStorage: FakeProfileStorage;
  let slugCache: FakeTenantSlugCache;
  let refreshScheduler: FakeSessionRefreshScheduler;
  let logout: LogoutUseCase;
  let logoutExecuteCalls: number;
  let useCase: RefreshIdentityUseCase;

  beforeEach(() => {
    repo = new FakeAuthRepository();
    identityStorage = new FakeIdentityStorage();
    profileStorage = new FakeProfileStorage();
    slugCache = new FakeTenantSlugCache();
    refreshScheduler = new FakeSessionRefreshScheduler();
    const _getProfile = new GetProfileUseCase(profileStorage, repo);
    logout = new LogoutUseCase(
      repo,
      identityStorage,
      slugCache,
      profileStorage,
      new FakeDraftDispatcher(),
      new FakeRouter(),
      refreshScheduler,
    );
    logoutExecuteCalls = 0;
    const originalLogoutExecute = logout.execute.bind(logout);
    logout.execute = async () => {
      logoutExecuteCalls++;
      return originalLogoutExecute();
    };
    useCase = new RefreshIdentityUseCase(
      repo,
      identityStorage,
      slugCache,
      logout,
      refreshScheduler,
    );
  });

  it('refresh exitoso actualiza el storage con la nueva identity', async () => {
    const newIdentity = makeIdentity();
    repo.willResolveRefresh(newIdentity);
    const result = await useCase.execute();
    expect(result).toBe(newIdentity);
    expect(await identityStorage.read()).toBe(newIdentity);
  });

  it('RefreshFailedError invoca logout.execute()', async () => {
    repo.willRejectRefresh(new RefreshFailedError());
    await expect(useCase.execute()).rejects.toThrow(RefreshFailedError);
    expect(logoutExecuteCalls).toBe(1);
  });

  it('RefreshFailedError re-propaga el error después de logout', async () => {
    repo.willRejectRefresh(new RefreshFailedError('Token inválido'));
    const err = await useCase.execute().catch((e) => e);
    expect(err).toBeInstanceOf(RefreshFailedError);
  });

  it('error genérico (NetworkError) propaga sin invocar logout', async () => {
    repo.willRejectRefresh(new NetworkError());
    await expect(useCase.execute()).rejects.toThrow(NetworkError);
    expect(logoutExecuteCalls).toBe(0);
  });

  it('refresh exitoso re-agenda el scheduler con el nuevo expiresAt', async () => {
    const newIdentity = makeIdentity();
    repo.willResolveRefresh(newIdentity);
    await useCase.execute();
    expect(refreshScheduler.scheduleCalls).toEqual([newIdentity.expiresAt]);
  });

  it('refresh fallido (RefreshFailedError) NO re-agenda scheduler; logout se encarga de cancel', async () => {
    repo.willRejectRefresh(new RefreshFailedError());
    await expect(useCase.execute()).rejects.toThrow(RefreshFailedError);
    // El use case no llama schedule() en el path de error — el logout que se
    // dispara adentro llama cancel(), que se testea en logout.use-case.spec.
    expect(refreshScheduler.scheduleCalls).toEqual([]);
  });

  it('refresh fallido (NetworkError) NO re-agenda scheduler', async () => {
    repo.willRejectRefresh(new NetworkError());
    await expect(useCase.execute()).rejects.toThrow(NetworkError);
    expect(refreshScheduler.scheduleCalls).toEqual([]);
  });
});
