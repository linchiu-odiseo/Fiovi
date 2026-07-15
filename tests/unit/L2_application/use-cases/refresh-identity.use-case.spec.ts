import { describe, it, expect, beforeEach } from 'vitest';
import { RefreshIdentityUseCase } from '../../../../src/L2_application/use-cases/refresh-identity.use-case';
import { Identity } from '../../../../src/L1_domain/entities/identity';
import { RefreshFailedError } from '../../../../src/L1_domain/errors/refresh-failed.error';
import { NetworkError } from '../../../../src/L1_domain/errors/network.error';
import { FakeAuthRepository } from '../../fixtures/auth-repository.fake';
import { FakeIdentityStorage } from '../../fixtures/identity-storage.fake';
import { FakeProfileStorage } from '../../fixtures/profile-storage.fake';
import { FakeTenantSlugCache } from '../../fixtures/tenant-slug-cache.fake';
import { LogoutUseCase } from '../../../../src/L2_application/use-cases/logout.use-case';
import { RouterPort } from '../../../../src/L1_domain/ports/router-port';
import { OutboxStoragePort } from '../../../../src/L1_domain/ports/outbox-storage.port';
import { MarkingsStorage } from '../../../../src/L1_domain/ports/markings-storage';
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
    NOW + 900_000,
  );

class FakeRouter implements RouterPort {
  navigate(_commands: unknown[]): void {
    return;
  }
}

class FakeOutbox implements OutboxStoragePort {
  async clear(): Promise<void> {
    return Promise.resolve();
  }
}

class FakeMarkings implements MarkingsStorage {
  async setMarcacion(): Promise<void> {
    return Promise.resolve();
  }
  async getMarcaciones(): Promise<Record<string, null>> {
    return {};
  }
  async clearMarcaciones(): Promise<void> {
    return Promise.resolve();
  }
  async enqueueEnvio(): Promise<void> {
    return Promise.resolve();
  }
  async getEnviosPendientes(): Promise<never[]> {
    return [];
  }
  async dequeueEnvio(): Promise<void> {
    return Promise.resolve();
  }
  async getSubmissionAck(): Promise<null> {
    return null;
  }
  async setSubmissionAck(): Promise<void> {
    return Promise.resolve();
  }
  async getAdmissionArea(): Promise<null> {
    return null;
  }
  async setAdmissionArea(): Promise<void> {
    return Promise.resolve();
  }
  async wipeUserScope(): Promise<void> {
    return Promise.resolve();
  }
}

describe('RefreshIdentityUseCase', () => {
  let repo: FakeAuthRepository;
  let identityStorage: FakeIdentityStorage;
  let profileStorage: FakeProfileStorage;
  let slugCache: FakeTenantSlugCache;
  let logout: LogoutUseCase;
  let logoutExecuteCalls: number;
  let useCase: RefreshIdentityUseCase;

  beforeEach(() => {
    repo = new FakeAuthRepository();
    identityStorage = new FakeIdentityStorage();
    profileStorage = new FakeProfileStorage();
    slugCache = new FakeTenantSlugCache();
    const _getProfile = new GetProfileUseCase(profileStorage, repo);
    logout = new LogoutUseCase(
      repo,
      identityStorage,
      slugCache,
      profileStorage,
      new FakeMarkings(),
      new FakeOutbox(),
      new FakeRouter(),
    );
    logoutExecuteCalls = 0;
    const originalLogoutExecute = logout.execute.bind(logout);
    logout.execute = async () => {
      logoutExecuteCalls++;
      return originalLogoutExecute();
    };
    useCase = new RefreshIdentityUseCase(repo, identityStorage, slugCache, logout);
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
});
