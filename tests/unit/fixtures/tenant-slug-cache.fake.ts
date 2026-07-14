import { TenantSlugCache } from '../../../src/L1_domain/ports/tenant-slug-cache';

// Fake in-memory del `TenantSlugCache` para tests de L2. Sin Signal ni
// reactivity — devuelve/setea el string plano. Los tests que necesitan
// simular "arranque sin slug" llaman `clear()`; los que arrancan con un
// slug preseteado lo hacen via `set('vonex')` en el beforeEach.
export class FakeTenantSlugCache implements TenantSlugCache {
  private slug: string | null = null;

  current(): string | null {
    return this.slug;
  }

  set(slug: string): void {
    this.slug = slug;
  }

  clear(): void {
    this.slug = null;
  }
}
