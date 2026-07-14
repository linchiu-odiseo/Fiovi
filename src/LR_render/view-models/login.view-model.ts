import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { LoginUseCase } from '../../L2_application/use-cases/login.use-case';
import { ListSsoProvidersUseCase } from '../../L2_application/use-cases/list-sso-providers.use-case';
import { SsoProvider } from '../../L1_domain/value-objects/sso-provider';
import { InvalidCredentialsError } from '../../L1_domain/errors/invalid-credentials.error';
import { NetworkError } from '../../L1_domain/errors/network.error';
import { RateLimitError } from '../../L1_domain/errors/rate-limit.error';
import { UnsupportedRoleError } from '../../L1_domain/errors/unsupported-role.error';
import { FIOVI_PENDING_SELECTION_KEY } from '../../L3_periphery/http/sso-callback-bootstrap';

// Outcome del submit visible desde la template:
//   - 'ok'              → login directo (1 tenant), ya navega a /{role}/home.
//   - 'selection'       → email en >1 tenant, ya navega a /login/select-tenant.
//   - 'invalid'         → credenciales inválidas, mostrar banner.
//   - 'network'         → error de red o 5xx, mostrar banner.
//   - 'rate-limit'      → 429, mostrar banner.
//   - 'unsupported-role'→ rol no soportado por Fiovi, banner + form reseteado.
export type SubmitOutcome =
  | 'ok'
  | 'selection'
  | 'invalid'
  | 'network'
  | 'rate-limit'
  | 'unsupported-role';

@Injectable()
export class LoginViewModel {
  private readonly login = inject(LoginUseCase);
  private readonly listSsoProviders = inject(ListSsoProvidersUseCase);
  private readonly router = inject(Router);

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly ssoProviders = signal<readonly SsoProvider[]>([]);

  // Carga la lista de providers habilitados globalmente. Se llama desde el
  // `ngOnInit` de LoginPage. Best-effort: si falla, quedamos con lista vacía
  // y el user tiene que ir por password.
  async loadSsoProviders(): Promise<void> {
    try {
      const providers = await this.listSsoProviders.execute();
      this.ssoProviders.set(providers);
    } catch {
      this.ssoProviders.set([]);
    }
  }

  async submit(credentials: {
    email: string;
    password: string;
    captchaToken?: string;
  }): Promise<SubmitOutcome> {
    this.isSubmitting.set(true);
    this.errorMessage.set(null);
    try {
      const outcome = await this.login.execute(credentials);
      if ('selectionToken' in outcome) {
        // >1 tenant: stashamos el challenge y navegamos al selector.
        sessionStorage.setItem(FIOVI_PENDING_SELECTION_KEY, JSON.stringify(outcome));
        await this.router.navigate(['/login/select-tenant']);
        return 'selection';
      }
      await this.router.navigate([`/${outcome.role()}/home`]);
      return 'ok';
    } catch (err) {
      if (err instanceof InvalidCredentialsError) {
        this.errorMessage.set('Credenciales inválidas');
        return 'invalid';
      }
      if (err instanceof RateLimitError) {
        this.errorMessage.set('Demasiados intentos, esperá un minuto.');
        return 'rate-limit';
      }
      if (err instanceof UnsupportedRoleError) {
        // El back autenticó pero el rol no está soportado por este cliente
        // (hoy: solo student/tutor; admin/teacher pendientes). El mapper L3
        // ya rechazó antes de persistir identity, así que no hay storage que
        // limpiar acá. Las cookies HttpOnly del back se invalidarán en el
        // próximo arranque (AppInitializer detecta y limpia) o por TTL.
        this.errorMessage.set(
          'Esta aplicación está disponible solo para alumnos y tutores. Contactá a tu administrador.',
        );
        return 'unsupported-role';
      }
      if (err instanceof NetworkError) {
        this.errorMessage.set('No se pudo conectar al servidor. Inténtalo de nuevo.');
        return 'network';
      }
      // Bug del programador (otro error no contemplado). Re-lanzar para que
      // se vea en consola y no quede silenciado.
      throw err;
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
