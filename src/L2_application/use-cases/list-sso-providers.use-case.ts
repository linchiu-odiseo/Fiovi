import { AuthRepository } from '../../L1_domain/ports/auth-repository';
import { SsoProvider } from '../../L1_domain/value-objects/sso-provider';

// Fetch de la lista de providers SSO habilitados globalmente en el SaaS.
// Consumido por la LoginPage para renderizar dinámicamente los botones
// (hoy Google; mañana Microsoft/otros sin deploy del frontend). Si el fetch
// falla el adapter devuelve `[]` — la UI simplemente no muestra botones SSO
// y el user cae al flow de password.
export class ListSsoProvidersUseCase {
  constructor(private readonly authRepo: AuthRepository) {}

  async execute(): Promise<SsoProvider[]> {
    return this.authRepo.listSsoProviders();
  }
}
