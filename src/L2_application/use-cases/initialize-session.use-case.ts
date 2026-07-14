import { AuthRepository } from '../../L1_domain/ports/auth-repository';
import { IdentityStorage } from '../../L1_domain/ports/identity-storage';
import { TenantSlugCache } from '../../L1_domain/ports/tenant-slug-cache';
import { Identity } from '../../L1_domain/entities/identity';
import { SessionExpiredError } from '../../L1_domain/errors/session-expired.error';
import { NetworkError } from '../../L1_domain/errors/network.error';
import { UnsupportedRoleError } from '../../L1_domain/errors/unsupported-role.error';
import { GetProfileUseCase } from './get-profile.use-case';

// Use case del AppInitializer: valida la sesión al arrancar la app via GET /auth/me.
//
// Orden de hidratación (asegura que `me()` pueda armar el path tenant-scoped):
//   1. Si SlugStore ya tiene slug (viene de SsoCallbackBootstrap con ?slug=X),
//      ese slug + las cookies del callback bastan para llamar `me()`.
//   2. Si SlugStore está vacío, intentamos leer una Identity persistida del
//      IdentityStorage e hidratar el slug desde ahí (bootstrap normal con
//      sesión previa).
//   3. Si tampoco hay identity persistida → sin slug no hay endpoint que
//      llamar; devolvemos null y el user cae a `/login`.
//
// Casos post-`me()`:
// - OK → persiste identity, dispara profile fire-and-forget, devuelve Identity.
// - 401 (SessionExpiredError) → limpia IdentityStorage + SlugCache, devuelve null.
// - UnsupportedRoleError → cookies vivas pero rol no soportado (admin/teacher).
//   Logout best-effort para invalidar cookies server-side + limpia local + null.
// - NetworkError → NO toca storage, propaga (UI muestra pantalla offline).
export class InitializeSessionUseCase {
  constructor(
    private readonly authRepo: AuthRepository,
    private readonly identityStorage: IdentityStorage,
    private readonly slugCache: TenantSlugCache,
    private readonly getProfile: GetProfileUseCase,
  ) {}

  async execute(): Promise<Identity | null> {
    if (!this.slugCache.current()) {
      const stored = await this.identityStorage.read();
      if (!stored) {
        // Sin slug hidratado ni identity previa → asumimos no autenticado.
        // No llamamos `me()` porque no podríamos armar el path.
        return null;
      }
      this.slugCache.set(stored.tenantSlug);
    }

    try {
      const identity = await this.authRepo.me();
      await this.identityStorage.write(identity);
      this.slugCache.set(identity.tenantSlug);
      // Fire-and-forget: warm up del caché de perfil.
      void this.getProfile.execute(identity.role()).catch(() => undefined);
      return identity;
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        await this.identityStorage.clear();
        this.slugCache.clear();
        return null;
      }
      if (err instanceof UnsupportedRoleError) {
        // Best-effort: pedirle al back que invalide la cookie. Si falla por
        // red, igual seguimos limpiando lo local — el TTL de 15min del
        // access token también las invalidará pronto.
        try {
          await this.authRepo.logout();
        } catch {
          // ignorar — best-effort.
        }
        await this.identityStorage.clear();
        this.slugCache.clear();
        return null;
      }
      if (err instanceof NetworkError) {
        // Offline: no limpiar storage. El caller decide (pantalla offline).
        throw err;
      }
      throw err;
    }
  }
}
