import { AuthRepository } from '../../L1_domain/ports/auth-repository';
import { IdentityStorage } from '../../L1_domain/ports/identity-storage';
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
//   - Identity: persiste storage + hidrata slug cache + dispara fetch de perfil.
//   - SelectionChallenge: NO toca storage/cache — se devuelve la challenge para
//     que la view-model dirija al selector de tenants.
// Si el repo falla (credenciales inválidas, rate limit, red), el storage NO se
// toca: la identity previa permanece intacta.
export class LoginUseCase {
  constructor(
    private readonly authRepo: AuthRepository,
    private readonly identityStorage: IdentityStorage,
    private readonly slugCache: TenantSlugCache,
    private readonly getProfile: GetProfileUseCase,
  ) {}

  async execute(credentials: { email: string; password: string }): Promise<LoginOutcome> {
    const outcome = await this.authRepo.login(credentials);
    if ('selectionToken' in outcome) {
      return outcome;
    }
    const identity = outcome;
    await this.identityStorage.write(identity);
    this.slugCache.set(identity.tenantSlug);
    // Fire-and-forget: no bloquea el retorno del use case.
    void this.getProfile.execute(identity.role()).catch((err) => {
      console.warn('profile fetch post-login failed', err);
    });
    return identity;
  }
}
