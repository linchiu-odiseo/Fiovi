import { Identity, Role } from '../entities/identity';
import { SelectionChallenge } from '../value-objects/selection-challenge';
import { SsoProvider } from '../value-objects/sso-provider';
import { StudentProfile } from '../value-objects/student-profile';
import { TutorProfile } from '../value-objects/tutor-profile';

// Puerto del dominio para autenticación contra el backend learnex.
// Implementación concreta vive en L3 (`HttpAuthRepository`).
// Clasificación de errores HTTP por (status, endpoint, code) — nunca por message.
export interface AuthRepository {
  /**
   * POST /auth/login (global, sin slug en path).
   * Retorna:
   *   - `Identity` cuando el email matchea 1 tenant (cookies HttpOnly ya seteadas).
   *   - `SelectionChallenge` cuando matchea >1 tenant (sin cookies; el flow
   *     se completa con `selectTenant()` tras elegir el slug).
   * El caller distingue con `'selectionToken' in outcome`.
   *
   * `captchaToken` es opcional: el backend lo exige solo cuando `CAPTCHA_SECRET`
   * está seteado en learnex. Si el server rechaza el captcha, responde con el
   * mismo 401 `TENANT_AUTH_INVALID_CREDENTIALS` que un password inválido — es
   * política intencional anti-bot (no diferenciar la causa en el cliente).
   */
  login(credentials: {
    email: string;
    password: string;
    captchaToken?: string;
  }): Promise<Identity | SelectionChallenge>;

  /**
   * POST /auth/select-tenant (global). Cierra el flow multi-tenant tras el
   * selector — vale tanto para password como para SSO Google.
   */
  selectTenant(input: { selectionToken: string; slug: string }): Promise<Identity>;

  /**
   * GET /auth/sso/providers — lista global de providers SSO habilitados.
   * Fuente única para renderizar dinámicamente los botones (Google, futuros).
   */
  listSsoProviders(): Promise<SsoProvider[]>;

  me(): Promise<Identity>;
  refresh(): Promise<Identity>;
  logout(): Promise<void>;
  getProfile(role: Role): Promise<StudentProfile | TutorProfile>;
}
