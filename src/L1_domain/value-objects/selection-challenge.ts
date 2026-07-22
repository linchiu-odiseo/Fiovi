import type { TenantChoice } from './tenant-choice';

// Outcome del login cuando el email matchea >1 tenant. Sustituye a Identity
// como retorno del `AuthRepository.login()` en ese caso: el user tiene que
// elegir un tenant antes de completar el flow (POST /auth/select-tenant).
//
// El mismo shape se usa para el post-callback SSO Google — el backend redirige
// con `?selectionToken=&tenants=<b64>` y Fiovi hidrata este SelectionChallenge
// en el APP_INITIALIZER para renderizar el mismo selector.
//
// TTL sugerido por el backend: 5 min. `selectionExpiresAt` es un ms timestamp
// absoluto — el frontend compara contra `Date.now()` para decidir si expiró.
export interface SelectionChallenge {
  readonly selectionToken: string;
  readonly selectionExpiresAt: number;
  readonly tenants: readonly TenantChoice[];
}
