import { InvalidIdentityError } from '../errors/invalid-identity.error';

// Los "tipos de dashboard" que Fiovi soporta hoy. El backend resuelve
// `dashboardKind` a partir del `baseKind` de los roles del user (prioridad
// admin > teacher > tutor > parent > student) y lo devuelve en login/me/refresh.
// Fiovi rutea por este tipo, NO por el nombre literal del role — así un role
// custom del tenant (ej. `student-seleccion`, `anual`) con `baseKind='student'`
// entra a `/student/home` sin depender del nombre.
export type Role = 'student' | 'tutor';

// Entidad de dominio que representa la identidad autenticada del usuario.
// Invariantes centrales:
//   - `tenantSlug` no vacío — arma las URLs `/t/{slug}/...` de todos los
//     endpoints tenant-scoped (refresh, logout, me, exams, drafts).
//   - `dashboardKind` en el set de tipos que Fiovi renderiza (`student` |
//     `tutor`). Validación afuera (en el mapper del HTTP repo o en el
//     storage) — acá asumimos que llega ya restringido al union `Role`.
// El constructor lanza `InvalidIdentityError` si el slug se rompe.
//
// La autorización efectiva vive en el server (RLS + guards en learnex).
// Esta entidad NO expone `permissions[]`: los permisos en cliente eran
// sólo hints de UI nunca consumidos (F5-03 — PII/metadata mínima en
// localStorage). Si en el futuro se necesita gating de UI por permiso,
// consultar al servidor en el momento del render o modelar un capability
// específico — no volver a hornear la lista completa en Identity.
//
// `roles: string[]` se mantiene como bag opaco (nombres, incluyendo custom
// como `student-seleccion`) — es pass-through para storage y diagnóstico;
// Fiovi NO branchea por role name en ningún lado.
export class Identity {
  constructor(
    readonly id: string, // UUID del TenantUser
    readonly tenantId: string,
    readonly tenantSlug: string, // ej. 'vonex' — viene del login response, ya no del .env
    readonly email: string,
    readonly codigo: string | null, // presente en alumno, null en tutor (learnex actual)
    readonly roles: readonly string[], // nombres opacos, incluye system + custom
    readonly dashboardKind: Role, // tipo de dashboard resuelto por el backend
    readonly expiresAt: number, // timestamp ms
  ) {
    if (!tenantSlug) {
      throw new InvalidIdentityError('Identity requires a non-empty tenantSlug');
    }
  }

  // Alias legacy: view-models y guards preexistentes llaman `role()`. Devuelve
  // el `dashboardKind` — que ES el tipo efectivo con el que Fiovi rutea.
  // Mantener el nombre evita churn en 11+ callsites; la semántica cambió.
  role(): Role {
    return this.dashboardKind;
  }

  isExpired(now: number): boolean {
    return now >= this.expiresAt;
  }

  shouldRefresh(now: number, thresholdMs = 60_000): boolean {
    return now >= this.expiresAt - thresholdMs;
  }
}
