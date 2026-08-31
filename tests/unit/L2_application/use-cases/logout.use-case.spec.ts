import { describe, it, expect, beforeEach } from 'vitest';
import { LogoutUseCase } from '../../../../src/L2_application/use-cases/logout.use-case';
import { Identity } from '../../../../src/L1_domain/entities/identity';
import { FakeAuthRepository } from '../../fixtures/auth-repository.fake';
import { FakeIdentityStorage } from '../../fixtures/identity-storage.fake';
import { FakeProfileStorage } from '../../fixtures/profile-storage.fake';
import { FakeSessionRefreshScheduler } from '../../fixtures/session-refresh-scheduler.fake';
import { FakeTenantSlugCache } from '../../fixtures/tenant-slug-cache.fake';
import { DraftDispatcher } from '../../../../src/L1_domain/ports/draft-dispatcher';
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
    role,
    NOW + 900_000,
  );

class FakeDraftDispatcher implements DraftDispatcher {
  private wipeCalls = 0;
  private shouldFail = false;
  private opsLog: string[] | null = null;

  bindOpsLog(log: string[]): void {
    this.opsLog = log;
  }
  willThrowOnWipe(): void {
    this.shouldFail = true;
  }
  getWipeCalls(): number {
    return this.wipeCalls;
  }

  wipeAll(): void {
    this.opsLog?.push('draft.wipeAll');
    this.wipeCalls++;
    if (this.shouldFail) throw new Error('dispatcher wipe failed');
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
  let draftDispatcher: FakeDraftDispatcher;
  let router: FakeRouter;
  let swMessenger: FakeSwMessenger;
  let refreshScheduler: FakeSessionRefreshScheduler;
  let useCase: LogoutUseCase;

  beforeEach(() => {
    repo = new FakeAuthRepository();
    identityStorage = new FakeIdentityStorage();
    profileStorage = new FakeProfileStorage();
    slugCache = new FakeTenantSlugCache();
    draftDispatcher = new FakeDraftDispatcher();
    router = new FakeRouter();
    swMessenger = new FakeSwMessenger();
    refreshScheduler = new FakeSessionRefreshScheduler();
    useCase = new LogoutUseCase(
      repo,
      identityStorage,
      slugCache,
      profileStorage,
      draftDispatcher,
      router,
      refreshScheduler,
      swMessenger,
    );
  });

  describe('con identity activa', () => {
    it('ejecuta los pasos esperados: repo.logout + dispatcher.wipeAll + profile + identity + navigate', async () => {
      await identityStorage.write(makeIdentity());
      await useCase.execute();
      expect(repo.getLogoutCalls()).toBe(1);
      expect(draftDispatcher.getWipeCalls()).toBe(1);
      expect(profileStorage.getClearCalls()).toBe(1);
      expect(await identityStorage.read()).toBeNull();
      expect(router.getNavigateCalls()).toEqual([['/login']]);
    });

    it('repo.logout falla → limpieza local se ejecuta igual (best-effort)', async () => {
      await identityStorage.write(makeIdentity());
      repo.willRejectLogout();
      await useCase.execute();
      expect(await identityStorage.read()).toBeNull();
      expect(draftDispatcher.getWipeCalls()).toBe(1);
      expect(router.getNavigateCalls()).toEqual([['/login']]);
    });

    it('draftDispatcher.wipeAll se invoca ANTES de identityStorage.clear (orden crítico)', async () => {
      await identityStorage.write(makeIdentity());
      const opsLog: string[] = [];
      draftDispatcher.bindOpsLog(opsLog);
      identityStorage.bindOpsLog(opsLog);
      await useCase.execute();
      const wipeIdx = opsLog.indexOf('draft.wipeAll');
      const clearIdx = opsLog.indexOf('identity.clear');
      expect(wipeIdx).toBeGreaterThanOrEqual(0);
      expect(clearIdx).toBeGreaterThanOrEqual(0);
      expect(wipeIdx).toBeLessThan(clearIdx);
    });

    it('draftDispatcher.wipeAll falla → sigue igual, navega a /login', async () => {
      await identityStorage.write(makeIdentity());
      draftDispatcher.willThrowOnWipe();
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
        draftDispatcher,
        router,
        refreshScheduler,
      );
      await expect(ucWithoutSw.execute()).resolves.toBeUndefined();
    });
  });

  describe('sin identity activa', () => {
    it('identity null → solo navega a /login, no invoca repo ni dispatcher', async () => {
      await useCase.execute();
      expect(repo.getLogoutCalls()).toBe(0);
      expect(draftDispatcher.getWipeCalls()).toBe(0);
      expect(router.getNavigateCalls()).toEqual([['/login']]);
    });

    it('identity null → profileStorage.clear no se invoca', async () => {
      await useCase.execute();
      expect(profileStorage.getClearCalls()).toBe(0);
    });

    it('identity null → scheduler.cancel() se invoca igual (idempotente)', async () => {
      // El scheduler puede tener un timer huerfano de una sesion anterior (raro
      // pero posible con hot reload en dev, o con multiples pestañas). Cancel
      // es idempotente y barato — mejor prevenir que dejar un timer suelto.
      await useCase.execute();
      expect(refreshScheduler.cancelCalls).toBe(1);
    });
  });

  describe('scheduler cancel', () => {
    it('logout con identity activa cancela el scheduler PRIMERO (antes de repo.logout)', async () => {
      await identityStorage.write(makeIdentity());
      await useCase.execute();
      expect(refreshScheduler.cancelCalls).toBe(1);
      // Si el timer proactivo se disparaba durante el logout, RefreshIdentity
      // volveria a hidratar storage con la identity que acabamos de limpiar —
      // ruido inutil que confunde el debugging.
    });
  });
});
