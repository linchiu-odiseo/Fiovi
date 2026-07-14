import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SelectTenantUseCase } from '../../L2_application/use-cases/select-tenant.use-case';
import { SelectionChallenge } from '../../L1_domain/value-objects/selection-challenge';
import { TenantChoice } from '../../L1_domain/value-objects/tenant-choice';
import { NetworkError } from '../../L1_domain/errors/network.error';
import { SelectionInvalidError } from '../../L1_domain/errors/selection-invalid.error';
import { UnsupportedRoleError } from '../../L1_domain/errors/unsupported-role.error';
import { FIOVI_PENDING_SELECTION_KEY } from '../../L3_periphery/http/sso-callback-bootstrap';

// Outcome del click en un tenant:
//   - 'ok'             → login completo, ya navega a /{role}/home.
//   - 'expired'        → selectionToken TTL vencido — banner + redirect a /login.
//   - 'network'        → fallo de red — banner, form disponible para reintentar.
//   - 'unsupported-role' → user linkeado a un rol no soportado por Fiovi.
export type SelectOutcome = 'ok' | 'expired' | 'network' | 'unsupported-role';

@Injectable()
export class SelectTenantViewModel {
  private readonly selectTenant = inject(SelectTenantUseCase);
  private readonly router = inject(Router);

  readonly isSubmitting = signal(false);
  readonly submittingSlug = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly tenants = signal<readonly TenantChoice[]>([]);

  private challenge: SelectionChallenge | null = null;

  // Hidrata el challenge desde sessionStorage. Retorna true si hay una
  // selección pendiente válida; false si no hay nada / expiró / está corrupto
  // (en cuyo caso la page redirige a /login).
  hydrate(): boolean {
    const raw = sessionStorage.getItem(FIOVI_PENDING_SELECTION_KEY);
    if (!raw) return false;
    let parsed: SelectionChallenge;
    try {
      parsed = JSON.parse(raw) as SelectionChallenge;
    } catch {
      sessionStorage.removeItem(FIOVI_PENDING_SELECTION_KEY);
      return false;
    }
    if (
      typeof parsed.selectionToken !== 'string' ||
      typeof parsed.selectionExpiresAt !== 'number' ||
      !Array.isArray(parsed.tenants) ||
      parsed.tenants.length === 0
    ) {
      sessionStorage.removeItem(FIOVI_PENDING_SELECTION_KEY);
      return false;
    }
    if (parsed.selectionExpiresAt <= Date.now()) {
      sessionStorage.removeItem(FIOVI_PENDING_SELECTION_KEY);
      this.errorMessage.set('La selección expiró. Iniciá sesión de nuevo.');
      return false;
    }
    this.challenge = parsed;
    this.tenants.set(parsed.tenants);
    return true;
  }

  async choose(slug: string): Promise<SelectOutcome> {
    if (!this.challenge || this.isSubmitting()) return 'network';
    this.isSubmitting.set(true);
    this.submittingSlug.set(slug);
    this.errorMessage.set(null);
    try {
      const identity = await this.selectTenant.execute({
        selectionToken: this.challenge.selectionToken,
        slug,
      });
      // Limpiamos el challenge del sessionStorage — login completo.
      sessionStorage.removeItem(FIOVI_PENDING_SELECTION_KEY);
      await this.router.navigate([`/${identity.role()}/home`]);
      return 'ok';
    } catch (err) {
      if (err instanceof SelectionInvalidError) {
        sessionStorage.removeItem(FIOVI_PENDING_SELECTION_KEY);
        this.errorMessage.set('La selección expiró. Iniciá sesión de nuevo.');
        await this.router.navigate(['/login']);
        return 'expired';
      }
      if (err instanceof UnsupportedRoleError) {
        this.errorMessage.set(
          'Esta aplicación está disponible solo para alumnos y tutores. Contactá a tu administrador.',
        );
        return 'unsupported-role';
      }
      if (err instanceof NetworkError) {
        this.errorMessage.set('No se pudo conectar al servidor. Inténtalo de nuevo.');
        return 'network';
      }
      throw err;
    } finally {
      this.isSubmitting.set(false);
      this.submittingSlug.set(null);
    }
  }

  async cancel(): Promise<void> {
    sessionStorage.removeItem(FIOVI_PENDING_SELECTION_KEY);
    await this.router.navigate(['/login']);
  }
}
