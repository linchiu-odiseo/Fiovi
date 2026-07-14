import { Injectable, signal } from '@angular/core';
import { TenantSlugCache } from '../../L1_domain/ports/tenant-slug-cache';

// SlugStore — cache sync del slug del tenant activo. Implementa el port
// `TenantSlugCache` (L1) para que los use cases L2 lo consuman sin acoplar
// a Angular/Signal.
//
// La `Identity` es la fuente autoritativa del slug (viene del login response
// y se persiste en `IdentityStorage`). Este store expone una versión sync +
// reactiva para los sitios que necesitan armar URLs `/t/{slug}/...` sin poder
// hacer `await identityStorage.read()`:
//   - `apiPath.refresh(slug)`, `apiPath.me(slug)`, etc. (helpers puros).
//   - `HttpAuthRepository` y adapters de exams / tutor cuando arman URLs.
//
// Ciclo de vida:
//   - `hydrate(slug | null)` — corre en APP_INITIALIZER post-lectura de
//     IdentityStorage, y también post-callback SSO cuando `?slug=` viene en
//     la URL (antes que el resto de la app se monte).
//   - `set(slug)` — post-login / post-refresh / post-select-tenant, cuando
//     el use case ya persistió la Identity.
//   - `clear()` — post-logout.
//
// El signal permite reaccionar en la UI (mostrar/ocultar navegación por
// tenant) sin pasar el slug por props.
@Injectable({ providedIn: 'root' })
export class SlugStore implements TenantSlugCache {
  private readonly _slug = signal<string | null>(null);

  readonly slug = this._slug.asReadonly();

  current(): string | null {
    return this._slug();
  }

  set(slug: string): void {
    if (!slug) return;
    this._slug.set(slug);
  }

  clear(): void {
    this._slug.set(null);
  }
}
