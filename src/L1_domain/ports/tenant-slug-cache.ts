// Cache sync del slug del tenant activo.
//
// La `Identity` (persistida en `IdentityStorage`) es la fuente autoritativa,
// pero los sitios que arman URLs `/t/{slug}/...` necesitan leerlo sync
// (sin `await`). Este puerto expone esa lectura y las mutaciones asociadas.
//
// El adapter (L3) mantiene el estado en memoria + notifica reactivamente
// (Signal, RxJS Subject, etc.) — L1 sólo sabe del contrato.
//
// Ciclo de vida:
//   - `set(slug)` — post-login / post-refresh / post-select-tenant, y también
//     post-callback SSO cuando `?slug=<slug>` viene en la URL.
//   - `clear()` — post-logout.
//   - `current()` — lectura sync desde cualquier sitio.
export interface TenantSlugCache {
  current(): string | null;
  set(slug: string): void;
  clear(): void;
}
