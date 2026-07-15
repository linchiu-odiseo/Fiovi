import { describe, it, expect, beforeEach } from 'vitest';
import { LogoutUseCase } from '../../../../src/L2_application/use-cases/logout.use-case';
import { Identity } from '../../../../src/L1_domain/entities/identity';
import { FakeAuthRepository } from '../../fixtures/auth-repository.fake';
import { FakeIdentityStorage } from '../../fixtures/identity-storage.fake';
import { FakeProfileStorage } from '../../fixtures/profile-storage.fake';
import { FakeTenantSlugCache } from '../../fixtures/tenant-slug-cache.fake';
import { MarkingsStorage } from '../../../../src/L1_domain/ports/markings-storage';
import { OutboxStoragePort } from '../../../../src/L1_domain/ports/outbox-storage.port';
import { RouterPort } from '../../../../src/L1_domain/ports/router-port';
import { SwMessengerPort } from '../../../../src/L1_domain/ports/sw-messenger.port';

const NOW = 1_700_000_000_000;

const makeIdentity = (role: 'student' | 'tutor' = 'student') =>
  new Identity(
    'user-id',
    'tenant-id',
    'vonex',
    'alumno@vonex.edu.pe',
    '79507732',
    [role],
    NOW + 900_000,
  );

// Fake MarkingsStorage mínimo
class FakeMarkingsStorage implements MarkingsStorage {
  private wipeCalls = 0;
  private shouldFail = false;
  private opsLog: string[] | null = null;

  bindOpsLog(log: string[]): void {
    this.opsLog = log;
  }
  willRejectWipe(): void {
    this.shouldFail = true;
  }
  getWipeCalls(): number {
    return this.wipeCalls;
  }

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
    this.opsLog?.push('markings.wipeUserScope');
    this.wipeCalls++;
    if (this.shouldFail) throw new Error('wipe failed');
  }
}

class FakeOutboxStorage implements OutboxStoragePort {
  private clearCalls = 0;
  async clear(): Promise<void> {
    this.clearCalls++;
  }
  getClearCalls(): number {
    return this.clearCalls;
  }
}

class FakeRouter implements RouterPort {
  private navigateCalls: unknown[][] = [];
  navigate(commands: unknown[]): void {
    this.navigateCalls.push(commands);
  }
  getNavigateCalls(): readonly unknown[][] {
    return this.navigateCalls;
  }
}

class FakeSwMessenger implements SwMessengerPort {
  private postCalls: { type: string }[] = [];
  post(message: { type: string }): void {
    this.postCalls.push(message);
  }
  getPostCalls(): readonly { type: string }[] {
    return this.postCalls;
  }
}

describe('LogoutUseCase', () => {
  let repo: FakeAuthRepository;
  let identityStorage: FakeIdentityStorage;
  let profileStorage: FakeProfileStorage;
  let slugCache: FakeTenantSlugCache;
  let markingsStorage: FakeMarkingsStorage;
  let outboxStorage: FakeOutboxStorage;
  let router: FakeRouter;
  let swMessenger: FakeSwMessenger;
  let useCase: LogoutUseCase;

  beforeEach(() => {
    repo = new FakeAuthRepository();
    identityStorage = new FakeIdentityStorage();
    profileStorage = new FakeProfileStorage();
    slugCache = new FakeTenantSlugCache();
    markingsStorage = new FakeMarkingsStorage();
    outboxStorage = new FakeOutboxStorage();
    router = new FakeRouter();
    swMessenger = new FakeSwMessenger();
    useCase = new LogoutUseCase(
      repo,
      identityStorage,
      slugCache,
      profileStorage,
      markingsStorage,
      outboxStorage,
      router,
      swMessenger,
    );
  });

  describe('con identity activa', () => {
    it('ejecuta todos los pasos: repo.logout + markings + outbox + profile + identity + navigate', async () => {
      await identityStorage.write(makeIdentity());
      await useCase.execute();
      expect(repo.getLogoutCalls()).toBe(1);
      expect(markingsStorage.getWipeCalls()).toBe(1);
      expect(outboxStorage.getClearCalls()).toBe(1);
      expect(profileStorage.getClearCalls()).toBe(1);
      expect(await identityStorage.read()).toBeNull();
      expect(router.getNavigateCalls()).toEqual([['/login']]);
    });

    it('repo.logout falla → limpieza local se ejecuta igual (best-effort)', async () => {
      await identityStorage.write(makeIdentity());
      repo.willRejectLogout();
      await useCase.execute();
      // A pesar del fallo del repo, el storage se limpió
      expect(await identityStorage.read()).toBeNull();
      expect(markingsStorage.getWipeCalls()).toBe(1);
      expect(router.getNavigateCalls()).toEqual([['/login']]);
    });

    it('wipeUserScope se invoca ANTES de identityStorage.clear (orden crítico)', async () => {
      await identityStorage.write(makeIdentity());
      const opsLog: string[] = [];
      markingsStorage.bindOpsLog(opsLog);
      identityStorage.bindOpsLog(opsLog);
      await useCase.execute();
      const wipeIdx = opsLog.indexOf('markings.wipeUserScope');
      const clearIdx = opsLog.indexOf('identity.clear');
      expect(wipeIdx).toBeGreaterThanOrEqual(0);
      expect(clearIdx).toBeGreaterThanOrEqual(0);
      expect(wipeIdx).toBeLessThan(clearIdx);
    });

    it('navega a /login siempre (incluso si algún paso de limpieza falla)', async () => {
      await identityStorage.write(makeIdentity());
      markingsStorage.willRejectWipe();
      await useCase.execute();
      expect(router.getNavigateCalls()).toEqual([['/login']]);
    });

    it('swMessenger.post es invocado con {type: LOGOUT}', async () => {
      await identityStorage.write(makeIdentity());
      await useCase.execute();
      expect(swMessenger.getPostCalls()).toEqual([{ type: 'LOGOUT' }]);
    });

    it('swMessenger es opcional — funciona sin él', async () => {
      await identityStorage.write(makeIdentity());
      const ucWithoutSw = new LogoutUseCase(
        repo,
        identityStorage,
        slugCache,
        profileStorage,
        markingsStorage,
        outboxStorage,
        router,
      );
      await expect(ucWithoutSw.execute()).resolves.toBeUndefined();
    });
  });

  describe('sin identity activa', () => {
    it('identity null → solo navega a /login, no invoca repo ni markings', async () => {
      // storage vacío
      await useCase.execute();
      expect(repo.getLogoutCalls()).toBe(0);
      expect(markingsStorage.getWipeCalls()).toBe(0);
      expect(router.getNavigateCalls()).toEqual([['/login']]);
    });

    it('identity null → profileStorage.clear no se invoca', async () => {
      await useCase.execute();
      expect(profileStorage.getClearCalls()).toBe(0);
    });
  });
});
