import { AuthRepository } from '../../L1_domain/ports/auth-repository';
import { IdentityStorage } from '../../L1_domain/ports/identity-storage';
import { SessionRefreshScheduler } from '../../L1_domain/ports/session-refresh-scheduler';
import { TenantSlugCache } from '../../L1_domain/ports/tenant-slug-cache';
import { Identity } from '../../L1_domain/entities/identity';
import { RefreshFailedError } from '../../L1_domain/errors/refresh-failed.error';
import { LogoutUseCase } from './logout.use-case';

// Refresca la identity via POST /t/{slug}/auth/refresh. Si el refresh falla
// con `RefreshFailedError` (token inválido/expirado), invoca `LogoutUseCase`
// para limpiar estado local y redirigir a /login. El slug del path lo lee
// el adapter L3 desde `TenantSlugCache`; acá solo hidratamos el cache
// post-refresh (por si el back rotó slug, cosa que hoy no pasa pero es
// invariante correcto).
//
// Tras refresh exitoso, re-agenda el scheduler proactivo con el nuevo
// `expiresAt`. Es lo que mantiene el ciclo: cada vez que el refresh corre
// (sea disparado por el scheduler o por el interceptor reactivo), el proximo
// tick queda armado. Si el use case falla, el scheduler NO se re-agenda —
// logout lo cancelara (fallo por RefreshFailedError) o el interceptor
// reactivo tomara el proximo 401 (fallo por NetworkError).
export class RefreshIdentityUseCase {
  constructor(
    private readonly authRepo: AuthRepository,
    private readonly identityStorage: IdentityStorage,
    private readonly slugCache: TenantSlugCache,
    private readonly logout: LogoutUseCase,
    private readonly refreshScheduler: SessionRefreshScheduler,
  ) {}

  async execute(): Promise<Identity> {
    try {
      const identity = await this.authRepo.refresh();
      await this.identityStorage.write(identity);
      this.slugCache.set(identity.tenantSlug);
      this.refreshScheduler.schedule(identity.expiresAt);
      return identity;
    } catch (err) {
      if (err instanceof RefreshFailedError) {
        await this.logout.execute();
      }
      throw err;
    }
  }
}
