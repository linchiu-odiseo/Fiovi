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
//
// Nota (F5-03): NO se persiste `permissions[]`. La autoridad de
// autorización vive en el server (RLS + guards en learnex); el catálogo
// completo de permisos en localStorage era PII/metadata sin uso runtime.
// Si en el futuro se agrega un campo capability específico, agregarlo
// acá — pero primero considerar si puede vivir sólo en memoria.
interface PersistedShape {
  id?: string;
  tenantId?: string;
  tenantSlug?: string;
  email?: string;
  codigo?: string | null;
  roles?: string[];
  // Optional en el shape para tolerar sesiones persistidas antes del PR que
  // introdujo dashboardKind en Identity. Al leer, si falta pero roles[0] es
  // 'student'|'tutor' (lo único que Fiovi aceptaba antes), lo backfilleamos
  // para no forzar re-login. Si no matchea, limpiamos y devolvemos null.
  dashboardKind?: string;
  expiresAt?: number;
}

const VALID_DASHBOARD_KINDS: ReadonlySet<Role> = new Set(['student', 'tutor']);

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
      typeof parsed?.expiresAt !== 'number'
    ) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    // dashboardKind: preferí el persisted; fallback al primer role si es válido
    // (backwards-compat con sesiones anteriores a este PR — ver comment del
    // shape). Si ninguno matchea → clear + null.
    const persistedKind = parsed.dashboardKind;
    const fallbackKind = parsed.roles[0];
    const candidateKind =
      persistedKind && VALID_DASHBOARD_KINDS.has(persistedKind as Role)
        ? persistedKind
        : fallbackKind && VALID_DASHBOARD_KINDS.has(fallbackKind as Role)
          ? fallbackKind
          : null;
    if (candidateKind === null) {
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
        parsed.roles,
        candidateKind as Role,
        parsed.expiresAt,
      );
    } catch {
      // Shape sintácticamente OK pero rompe algún invariante de Identity
      // (p.ej. tenantSlug vacío). Limpiar y empezar de cero.
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
      dashboardKind: identity.dashboardKind,
      expiresAt: identity.expiresAt,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  async clear(): Promise<void> {
    localStorage.removeItem(STORAGE_KEY);
  }
}
