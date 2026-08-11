import { AuthRepository } from '../../L1_domain/ports/auth-repository';
import { IdentityStorage } from '../../L1_domain/ports/identity-storage';
import { PwaCookieModeStore } from '../../L1_domain/ports/pwa-cookie-mode-store';
import { TenantSlugCache } from '../../L1_domain/ports/tenant-slug-cache';
import { Identity } from '../../L1_domain/entities/identity';
import { GetProfileUseCase } from './get-profile.use-case';

// Segunda mitad del flow multi-tenant. La view-model de `/login/select-tenant`
// invoca esto pasando el slug que el user eligió + el `selectionToken` del
// challenge (pre-autenticado por password o por SSO Google).
//
// Post-selección exitosa el backend:
//   - setea cookies HttpOnly con path `/t/{slug}` (scope al tenant elegido).
//     El interceptor mandó `X-Client-App: pwa` en /auth/select-tenant como
//     fresh-cookie endpoint, así que backend setea `learnex_pwa_*`.
//   - responde `{user:{...,slug}, expiresAt}`.
//   - Si el token traía context SSO (google), linkea `providerSub` al tenant
//     elegido — transparente al frontend.
//
// La view-model luego navega a `/{role}/home`. Si el repo tira
// `SelectionInvalidError` (token expiró, slug fuera de la lista, backend
// rechazó), la view-model muestra un toast y redirige a `/login`.
export class SelectTenantUseCase {
  constructor(
    private readonly authRepo: AuthRepository,
    private readonly identityStorage: IdentityStorage,
    private readonly slugCache: TenantSlugCache,
    private readonly getProfile: GetProfileUseCase,
    private readonly pwaCookieMode: PwaCookieModeStore,
  ) {}

  async execute(input: { selectionToken: string; slug: string }): Promise<Identity> {
    const identity = await this.authRepo.selectTenant(input);
    await this.identityStorage.write(identity);
    this.slugCache.set(identity.tenantSlug);
    // Backend acaba de setear cookies pwa (interceptor mandó el header en
    // /auth/select-tenant). Prendemos el flag para que próximas requests
    // también manden el header — ver PwaCookieModeStore para el racional.
    this.pwaCookieMode.enable();
    void this.getProfile.execute(identity.role()).catch((err) => {
      console.warn('profile fetch post-select-tenant failed', err);
    });
    return identity;
  }
}
