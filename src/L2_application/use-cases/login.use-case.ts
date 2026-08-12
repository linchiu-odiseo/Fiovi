import { AuthRepository } from '../../L1_domain/ports/auth-repository';
import { IdentityStorage } from '../../L1_domain/ports/identity-storage';
import { PwaCookieModeStore } from '../../L1_domain/ports/pwa-cookie-mode-store';
import { TenantSlugCache } from '../../L1_domain/ports/tenant-slug-cache';
import { Identity } from '../../L1_domain/entities/identity';
import { SelectionChallenge } from '../../L1_domain/value-objects/selection-challenge';
import { GetProfileUseCase } from './get-profile.use-case';

// Outcome del login: o entramos directo (1 tenant matcheó → Identity + cookies),
// o el user tiene que elegir tenant antes de completar (>1 tenant → challenge
// con selectionToken + lista). La view-model distingue con
// `'selectionToken' in outcome`.
export type LoginOutcome = Identity | SelectionChallenge;

// Use case de login: autentica credenciales, y según el outcome:
//   - Identity: persiste storage + hidrata slug cache + enciende el flag
//     PWA-cookie-mode + dispara fetch de perfil.
//   - SelectionChallenge: NO toca storage/cache ni el flag — se devuelve la
//     challenge para que la view-model dirija al selector de tenants (el flag
//     se prenderá tras el select-tenant exitoso).
// Si el repo falla (credenciales inválidas, rate limit, red), NADA se toca:
// storage, cache y flag permanecen intactos. Esto es crítico para preservar
// sesiones pre-migración de usuarios que atenten un re-login fallido — no
// activamos el modo pwa hasta tener cookies pwa de verdad seteadas por
// backend.
export class LoginUseCase {
  constructor(
    private readonly authRepo: AuthRepository,
    private readonly identityStorage: IdentityStorage,
    private readonly slugCache: TenantSlugCache,
    private readonly getProfile: GetProfileUseCase,
    private readonly pwaCookieMode: PwaCookieModeStore,
  ) {}

  async execute(credentials: {
    email: string;
    password: string;
    captchaToken?: string;
  }): Promise<LoginOutcome> {
    const outcome = await this.authRepo.login(credentials);
    if ('selectionToken' in outcome) {
      return outcome;
    }
    const identity = outcome;
    await this.identityStorage.write(identity);
    this.slugCache.set(identity.tenantSlug);
    // Backend seteó cookies `learnex_pwa_*` (el interceptor mandó
    // `X-Client-App: pwa` en /auth/login como fresh-cookie endpoint). Prendemos
    // el flag para que las próximas requests también manden el header y backend
    // lea el par pwa correcto.
    this.pwaCookieMode.enable();
    // Fire-and-forget: no bloquea el retorno del use case.
    void this.getProfile.execute(identity.role()).catch((err) => {
      console.warn('profile fetch post-login failed', err);
    });
    return identity;
  }
}
