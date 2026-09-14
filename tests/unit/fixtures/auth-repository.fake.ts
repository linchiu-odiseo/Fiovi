// Fake manual del puerto `AuthRepository` para tests de L2.
// Permite preconfigurar respuestas/errores de cada método y registra llamadas
// para que los tests puedan verificar que se invocaron correctamente.

import { AuthRepository } from '../../../src/L1_domain/ports/auth-repository';
import { Identity, Role } from '../../../src/L1_domain/entities/identity';
import { AuthSession } from '../../../src/L1_domain/value-objects/auth-session';
import { SelectionChallenge } from '../../../src/L1_domain/value-objects/selection-challenge';
import { ServerTime } from '../../../src/L1_domain/value-objects/server-time';
import { SsoProvider } from '../../../src/L1_domain/value-objects/sso-provider';
import { StudentProfile } from '../../../src/L1_domain/value-objects/student-profile';
import { TutorProfile } from '../../../src/L1_domain/value-objects/tutor-profile';

// Helper para construir un `AuthSession` en los tests sin repetir el shape.
// `serverTime` default a `null` — sin calibración, matchea el comportamiento
// de hoy salvo que el test la pida explícita.
export function authSession(identity: Identity, serverTime: ServerTime | null = null): AuthSession {
  return { identity, serverTime };
}

export class FakeAuthRepository implements AuthRepository {
  private nextLogin:
    | { kind: 'resolve'; outcome: AuthSession | SelectionChallenge }
    | { kind: 'reject'; error: Error }
    | null = null;
  private nextSelectTenant:
    | { kind: 'resolve'; session: AuthSession }
    | { kind: 'reject'; error: Error }
    | null = null;
  private nextSsoProviders: SsoProvider[] = [];
  private nextMe:
    | { kind: 'resolve'; session: AuthSession }
    | { kind: 'reject'; error: Error }
    | null = null;
  private nextRefresh:
    | { kind: 'resolve'; session: AuthSession }
    | { kind: 'reject'; error: Error }
    | null = null;
  private logoutShouldFail = false;
  private nextProfile:
    | { kind: 'resolve'; profile: StudentProfile | TutorProfile }
    | { kind: 'reject'; error: Error }
    | null = null;

  private loginCalls: { email: string; password: string; captchaToken?: string }[] = [];
  private selectTenantCalls: { selectionToken: string; slug: string }[] = [];
  private ssoProvidersCalls = 0;
  private meCalls = 0;
  private refreshCalls = 0;
  private logoutCalls = 0;
  private profileCalls: Role[] = [];

  // Configuración

  willResolveLogin(outcome: AuthSession | SelectionChallenge): void {
    this.nextLogin = { kind: 'resolve', outcome };
  }

  willRejectLogin(error: Error): void {
    this.nextLogin = { kind: 'reject', error };
  }

  willResolveSelectTenant(session: AuthSession): void {
    this.nextSelectTenant = { kind: 'resolve', session };
  }

  willRejectSelectTenant(error: Error): void {
    this.nextSelectTenant = { kind: 'reject', error };
  }

  willResolveSsoProviders(providers: SsoProvider[]): void {
    this.nextSsoProviders = providers;
  }

  willResolveMe(session: AuthSession): void {
    this.nextMe = { kind: 'resolve', session };
  }

  willRejectMe(error: Error): void {
    this.nextMe = { kind: 'reject', error };
  }

  willResolveRefresh(session: AuthSession): void {
    this.nextRefresh = { kind: 'resolve', session };
  }

  willRejectRefresh(error: Error): void {
    this.nextRefresh = { kind: 'reject', error };
  }

  willRejectLogout(): void {
    this.logoutShouldFail = true;
  }

  willResolveProfile(profile: StudentProfile | TutorProfile): void {
    this.nextProfile = { kind: 'resolve', profile };
  }

  willRejectProfile(error: Error): void {
    this.nextProfile = { kind: 'reject', error };
  }

  // Inspectores

  getLoginCalls(): readonly { email: string; password: string; captchaToken?: string }[] {
    return this.loginCalls;
  }

  getSelectTenantCalls(): readonly { selectionToken: string; slug: string }[] {
    return this.selectTenantCalls;
  }

  getSsoProvidersCalls(): number {
    return this.ssoProvidersCalls;
  }

  getMeCalls(): number {
    return this.meCalls;
  }

  getRefreshCalls(): number {
    return this.refreshCalls;
  }

  getLogoutCalls(): number {
    return this.logoutCalls;
  }

  getProfileCalls(): readonly Role[] {
    return this.profileCalls;
  }

  // Implementación del puerto

  async login(credentials: {
    email: string;
    password: string;
    captchaToken?: string;
  }): Promise<AuthSession | SelectionChallenge> {
    this.loginCalls.push(credentials);
    if (!this.nextLogin)
      throw new Error(
        'FakeAuthRepository: configurar willResolveLogin/willRejectLogin antes de login()',
      );
    if (this.nextLogin.kind === 'reject') throw this.nextLogin.error;
    return this.nextLogin.outcome;
  }

  async selectTenant(input: { selectionToken: string; slug: string }): Promise<AuthSession> {
    this.selectTenantCalls.push(input);
    if (!this.nextSelectTenant)
      throw new Error(
        'FakeAuthRepository: configurar willResolveSelectTenant/willRejectSelectTenant antes de selectTenant()',
      );
    if (this.nextSelectTenant.kind === 'reject') throw this.nextSelectTenant.error;
    return this.nextSelectTenant.session;
  }

  async listSsoProviders(): Promise<SsoProvider[]> {
    this.ssoProvidersCalls++;
    return this.nextSsoProviders;
  }

  async me(): Promise<AuthSession> {
    this.meCalls++;
    if (!this.nextMe)
      throw new Error('FakeAuthRepository: configurar willResolveMe/willRejectMe antes de me()');
    if (this.nextMe.kind === 'reject') throw this.nextMe.error;
    return this.nextMe.session;
  }

  async refresh(): Promise<AuthSession> {
    this.refreshCalls++;
    if (!this.nextRefresh)
      throw new Error(
        'FakeAuthRepository: configurar willResolveRefresh/willRejectRefresh antes de refresh()',
      );
    if (this.nextRefresh.kind === 'reject') throw this.nextRefresh.error;
    return this.nextRefresh.session;
  }

  async logout(): Promise<void> {
    this.logoutCalls++;
    if (this.logoutShouldFail) throw new Error('logout server-side falló');
  }

  async getProfile(role: Role): Promise<StudentProfile | TutorProfile> {
    this.profileCalls.push(role);
    if (!this.nextProfile)
      throw new Error(
        'FakeAuthRepository: configurar willResolveProfile/willRejectProfile antes de getProfile()',
      );
    if (this.nextProfile.kind === 'reject') throw this.nextProfile.error;
    return this.nextProfile.profile;
  }
}
