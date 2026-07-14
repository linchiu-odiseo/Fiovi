import { Injectable } from '@angular/core';
import { Identity, Role } from '../../L1_domain/entities/identity';
import { IdentityStorage } from '../../L1_domain/ports/identity-storage';

const STORAGE_KEY = 'fiovi.identity';

// Shape persistido. Coincide 1:1 con el constructor de `Identity`. Si el
// shape cambia (campo nuevo, tipo distinto), `read()` lo detecta y limpia
// la entrada en vez de devolver un Identity inválido.
//
// `tenantSlug` es requerido — Identity fresca lo trae del login response
// (`user.slug`) y todas las URLs `/t/{slug}/...` dependen de él.
interface PersistedShape {
  id?: string;
  tenantId?: string;
  tenantSlug?: string;
  email?: string;
  codigo?: string | null;
  roles?: string[];
  permissions?: string[];
  expiresAt?: number;
}

@Injectable({ providedIn: 'root' })
export class LocalStorageIdentityStorage implements IdentityStorage {
  async read(): Promise<Identity | null> {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;

    let parsed: PersistedShape;
    try {
      parsed = JSON.parse(raw) as PersistedShape;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    if (
      !parsed?.id ||
      !parsed?.tenantId ||
      !parsed?.tenantSlug ||
      !parsed?.email ||
      !Array.isArray(parsed?.roles) ||
      !Array.isArray(parsed?.permissions) ||
      typeof parsed?.expiresAt !== 'number'
    ) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    try {
      return new Identity(
        parsed.id,
        parsed.tenantId,
        parsed.tenantSlug,
        parsed.email,
        parsed.codigo ?? null,
        parsed.roles as Role[],
        parsed.permissions,
        parsed.expiresAt,
      );
    } catch {
      // Shape sintácticamente OK pero rompe algún invariante de Identity
      // (p.ej. roles.length !== 1, tenantSlug vacío). Limpiar y empezar de cero.
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
  }

  async write(identity: Identity): Promise<void> {
    const data: PersistedShape = {
      id: identity.id,
      tenantId: identity.tenantId,
      tenantSlug: identity.tenantSlug,
      email: identity.email,
      codigo: identity.codigo,
      roles: [...identity.roles],
      permissions: [...identity.permissions],
      expiresAt: identity.expiresAt,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  async clear(): Promise<void> {
    localStorage.removeItem(STORAGE_KEY);
  }
}
