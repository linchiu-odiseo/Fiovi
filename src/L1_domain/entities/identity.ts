import { InvalidIdentityError } from '../errors/invalid-identity.error';

export type Role = 'student' | 'tutor';
export type Permission = string;

// Entidad de dominio que representa la identidad autenticada del usuario.
// Invariantes centrales:
//   - exactamente 1 rol (`roles.length === 1`).
//   - `tenantSlug` no vacío — arma las URLs `/t/{slug}/...` de todos los
//     endpoints tenant-scoped (refresh, logout, me, exams, drafts).
// El constructor lanza `InvalidIdentityError` si alguno se rompe.
export class Identity {
  constructor(
    readonly id: string, // UUID del TenantUser
    readonly tenantId: string,
    readonly tenantSlug: string, // ej. 'vonex' — viene del login response, ya no del .env
    readonly email: string,
    readonly codigo: string | null, // presente en alumno, null en tutor (learnex actual)
    readonly roles: readonly Role[],
    readonly permissions: readonly Permission[],
    readonly expiresAt: number, // timestamp ms
  ) {
    if (roles.length !== 1) {
      throw new InvalidIdentityError(`Identity requires exactly 1 role; got ${roles.length}`);
    }
    if (!tenantSlug) {
      throw new InvalidIdentityError('Identity requires a non-empty tenantSlug');
    }
  }

  role(): Role {
    return this.roles[0];
  }

  isExpired(now: number): boolean {
    return now >= this.expiresAt;
  }

  shouldRefresh(now: number, thresholdMs = 60_000): boolean {
    return now >= this.expiresAt - thresholdMs;
  }

  hasPermission(perm: Permission): boolean {
    return this.permissions.includes(perm);
  }
}
