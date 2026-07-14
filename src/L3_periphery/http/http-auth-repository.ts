import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthRepository } from '../../L1_domain/ports/auth-repository';
import { Identity, Role } from '../../L1_domain/entities/identity';
import { SelectionChallenge } from '../../L1_domain/value-objects/selection-challenge';
import { SsoProvider } from '../../L1_domain/value-objects/sso-provider';
import { StudentProfile } from '../../L1_domain/value-objects/student-profile';
import { TutorProfile } from '../../L1_domain/value-objects/tutor-profile';
import { InvalidCredentialsError } from '../../L1_domain/errors/invalid-credentials.error';
import { NetworkError } from '../../L1_domain/errors/network.error';
import { RateLimitError } from '../../L1_domain/errors/rate-limit.error';
import { RefreshFailedError } from '../../L1_domain/errors/refresh-failed.error';
import { ProfileNotAvailableError } from '../../L1_domain/errors/profile-not-available.error';
import { SessionExpiredError } from '../../L1_domain/errors/session-expired.error';
import { SelectionInvalidError } from '../../L1_domain/errors/selection-invalid.error';
import { UnsupportedRoleError } from '../../L1_domain/errors/unsupported-role.error';
import { apiPath } from './api-paths';
import { SlugStore } from './slug-store';

// Roles que Fiovi soporta hoy. Cualquier otro (admin, teacher, custom)
// que devuelva el back se rechaza en el mapper con UnsupportedRoleError.
// Cuando se agregue soporte, ampliar este set y el tipo `Role` en L1.
const SUPPORTED_ROLES: ReadonlySet<Role> = new Set(['student', 'tutor']);

// Shape del user en `PublicAuthResponse` (POST /auth/login 1 tenant, POST
// /auth/select-tenant): incluye `slug` que hidrata `Identity.tenantSlug`.
interface PublicAuthResponseDto {
  user: {
    id: string;
    tenantId: string;
    slug: string;
    email: string;
    codigo: string | null;
    roles: string[];
    permissions: string[];
  };
  expiresAt: number;
}

// Shape del user en `TenantAuthResponse` (GET /t/{slug}/auth/me, POST /t/{slug}/auth/refresh):
// endpoints tenant-scoped que NO devuelven `slug` en el body (el slug ya está
// implícito en el path). El mapper lo inyecta desde el argumento `slug`.
interface TenantAuthResponseDto {
  user: {
    id: string;
    tenantId: string;
    email: string;
    codigo: string | null;
    roles: string[];
    permissions: string[];
  };
  expiresAt: number;
}

interface PublicAuthSelectionResponseDto {
  selectionToken: string;
  selectionExpiresAt: number;
  tenants: { slug: string; name: string }[];
}

interface PublicSsoProvidersResponseDto {
  providers: { provider: string; displayName: string }[];
}

interface StudentProfileDto {
  id: string;
  code: string;
  firstName: string;
  lastName: string;
  area: string | null;
}

interface TutorProfileDto {
  id: string;
  code: string;
  firstName: string;
  lastName: string;
  email: string;
  classrooms: {
    id: string;
    code: string;
    name: string;
    modality: 'presencial' | 'virtual';
    shift: 'manana' | 'tarde' | 'noche';
    campusName: string | null;
    cycleId: string;
    cycleName: string;
    studentCount: number;
  }[];
}

interface ErrorBodyDto {
  code?: string;
}

// Códigos del zod del back. Sólo se leen estos campos del body de error;
// `message` queda PROHIBIDO porque es texto humano volátil.
const CODE_INVALID_CREDENTIALS = 'TENANT_AUTH_INVALID_CREDENTIALS';
const REFRESH_FAILURE_CODES: ReadonlySet<string> = new Set([
  'TENANT_AUTH_REFRESH_TOKEN_MISSING',
  'TENANT_AUTH_REFRESH_TOKEN_NOT_FOUND',
  'TENANT_AUTH_REFRESH_TOKEN_EXPIRED',
  'TENANT_AUTH_REFRESH_TOKEN_REVOKED',
  'TENANT_AUTH_REFRESH_TOKEN_TENANT_MISMATCH',
  // legacy — algunos backs viejos aún emiten este código en vez de los 5 nuevos.
  'TENANT_AUTH_REFRESH_TOKEN_INVALID',
]);
const CODE_SELECTION_INVALID = 'PUBLIC_AUTH_SELECTION_TOKEN_INVALID';

@Injectable({ providedIn: 'root' })
export class HttpAuthRepository implements AuthRepository {
  private readonly http = inject(HttpClient);
  private readonly slugStore = inject(SlugStore);

  async login(credentials: {
    email: string;
    password: string;
  }): Promise<Identity | SelectionChallenge> {
    try {
      const dto = await firstValueFrom(
        this.http.post<PublicAuthResponseDto | PublicAuthSelectionResponseDto>(
          apiPath.login(),
          credentials,
        ),
      );
      if (isSelectionResponse(dto)) {
        return {
          selectionToken: dto.selectionToken,
          selectionExpiresAt: dto.selectionExpiresAt,
          tenants: dto.tenants.map((t) => ({ slug: t.slug, name: t.name })),
        };
      }
      return this.mapIdentityFromPublic(dto);
    } catch (err) {
      if (err instanceof UnsupportedRoleError) throw err;
      throw this.classifyLoginError(err);
    }
  }

  async selectTenant(input: { selectionToken: string; slug: string }): Promise<Identity> {
    try {
      const dto = await firstValueFrom(
        this.http.post<PublicAuthResponseDto>(apiPath.selectTenant(), input),
      );
      return this.mapIdentityFromPublic(dto);
    } catch (err) {
      if (err instanceof UnsupportedRoleError) throw err;
      throw this.classifySelectTenantError(err);
    }
  }

  async listSsoProviders(): Promise<SsoProvider[]> {
    try {
      const dto = await firstValueFrom(
        this.http.get<PublicSsoProvidersResponseDto>(apiPath.listSsoProviders()),
      );
      return dto.providers.map((p) => ({ provider: p.provider, displayName: p.displayName }));
    } catch {
      // Best-effort: si falla el fetch de providers, el botón simplemente no
      // se renderiza. No queremos que un provider caído bloquee el login por
      // password. Devolvemos lista vacía.
      return [];
    }
  }

  async me(): Promise<Identity> {
    const slug = this.requireSlug();
    try {
      const dto = await firstValueFrom(this.http.get<TenantAuthResponseDto>(apiPath.me(slug)));
      return this.mapIdentityFromTenant(dto, slug);
    } catch (err) {
      if (err instanceof UnsupportedRoleError) throw err;
      throw this.classifyMeError(err);
    }
  }

  async refresh(): Promise<Identity> {
    const slug = this.requireSlug();
    try {
      const dto = await firstValueFrom(
        this.http.post<TenantAuthResponseDto>(apiPath.refresh(slug), {}),
      );
      return this.mapIdentityFromTenant(dto, slug);
    } catch (err) {
      if (err instanceof UnsupportedRoleError) throw err;
      throw this.classifyRefreshError(err);
    }
  }

  async logout(): Promise<void> {
    const slug = this.slugStore.current();
    if (!slug) return; // sin slug no hay endpoint que llamar — best-effort.
    // Best-effort: errores de red o 5xx no se clasifican — el LogoutUseCase
    // ya envuelve la llamada en try/catch y continúa con la limpieza local.
    await firstValueFrom(this.http.post(apiPath.logout(slug), {}));
  }

  async getProfile(role: Role): Promise<StudentProfile | TutorProfile> {
    const slug = this.requireSlug();
    try {
      if (role === 'student') {
        const dto = await firstValueFrom(
          this.http.get<StudentProfileDto>(apiPath.profile(slug, 'student')),
        );
        return this.mapStudentProfile(dto);
      }
      const dto = await firstValueFrom(
        this.http.get<TutorProfileDto>(apiPath.profile(slug, 'tutor')),
      );
      return this.mapTutorProfile(dto);
    } catch (err) {
      throw this.classifyProfileError(err);
    }
  }

  // --- helpers ---

  private requireSlug(): string {
    const slug = this.slugStore.current();
    if (!slug) {
      // Bug del programador: alguien llamó un endpoint tenant-scoped sin haber
      // hidratado el slug (login exitoso o restore de storage al arrancar).
      // Lanzamos NetworkError para que el interceptor no intente refresh
      // (loop) y el use case caller navegue a /login.
      throw new NetworkError();
    }
    return slug;
  }

  // --- mappers ---

  private mapIdentityFromPublic(dto: PublicAuthResponseDto): Identity {
    return this.buildIdentity({
      id: dto.user.id,
      tenantId: dto.user.tenantId,
      tenantSlug: dto.user.slug,
      email: dto.user.email,
      codigo: dto.user.codigo,
      roles: dto.user.roles,
      permissions: dto.user.permissions,
      expiresAt: dto.expiresAt,
    });
  }

  private mapIdentityFromTenant(dto: TenantAuthResponseDto, slug: string): Identity {
    return this.buildIdentity({
      id: dto.user.id,
      tenantId: dto.user.tenantId,
      tenantSlug: slug,
      email: dto.user.email,
      codigo: dto.user.codigo,
      roles: dto.user.roles,
      permissions: dto.user.permissions,
      expiresAt: dto.expiresAt,
    });
  }

  private buildIdentity(fields: {
    id: string;
    tenantId: string;
    tenantSlug: string;
    email: string;
    codigo: string | null;
    roles: string[];
    permissions: string[];
    expiresAt: number;
  }): Identity {
    // Validamos rol ANTES de construir Identity: el cast `as Role[]` sería
    // una mentira de TypeScript si el back devuelve admin/teacher. El
    // invariante single-role de Identity ya se aplica en su constructor;
    // acá agregamos el invariante "rol soportado por este cliente".
    const rawRole = fields.roles[0];
    if (fields.roles.length !== 1 || !SUPPORTED_ROLES.has(rawRole as Role)) {
      throw new UnsupportedRoleError(rawRole ?? '(empty)');
    }
    return new Identity(
      fields.id,
      fields.tenantId,
      fields.tenantSlug,
      fields.email,
      fields.codigo,
      [rawRole as Role],
      fields.permissions,
      fields.expiresAt,
    );
  }

  private mapStudentProfile(dto: StudentProfileDto): StudentProfile {
    return {
      id: dto.id,
      code: dto.code,
      firstName: dto.firstName,
      lastName: dto.lastName,
      area: dto.area,
    };
  }

  private mapTutorProfile(dto: TutorProfileDto): TutorProfile {
    return {
      id: dto.id,
      code: dto.code,
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email,
      classrooms: dto.classrooms.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        modality: c.modality,
        shift: c.shift,
        campusName: c.campusName,
        cycleId: c.cycleId,
        cycleName: c.cycleName,
        studentCount: c.studentCount,
      })),
    };
  }

  // --- clasificadores de errores: (status, endpoint, code) — NUNCA message ---

  private classifyLoginError(err: unknown): Error {
    if (!(err instanceof HttpErrorResponse)) return new NetworkError();
    if (err.status === 0 || err.status >= 500) return new NetworkError();
    if (err.status === 429) return new RateLimitError();
    if (err.status === 401) {
      const code = this.extractCode(err);
      if (code === CODE_INVALID_CREDENTIALS) return new InvalidCredentialsError();
      // 401 sin code conocido en /login también lo tratamos como credenciales
      // inválidas (el back lo unifica anti-enumeration).
      return new InvalidCredentialsError();
    }
    return new NetworkError();
  }

  private classifySelectTenantError(err: unknown): Error {
    if (!(err instanceof HttpErrorResponse)) return new NetworkError();
    if (err.status === 0 || err.status >= 500) return new NetworkError();
    // 400/401/403/404 → el token expiró, el slug no está en la lista pre-
    // autenticada, o el backend rechazó por cualquier motivo. Todos convergen
    // al mismo mensaje UX: pedirle al user que inicie sesión de nuevo.
    if (err.status === 401 || err.status === 400 || err.status === 403 || err.status === 404) {
      const code = this.extractCode(err);
      if (code === CODE_SELECTION_INVALID || err.status === 401) {
        return new SelectionInvalidError();
      }
      return new SelectionInvalidError();
    }
    return new NetworkError();
  }

  private classifyMeError(err: unknown): Error {
    if (!(err instanceof HttpErrorResponse)) return new NetworkError();
    if (err.status === 0 || err.status >= 500) return new NetworkError();
    if (err.status === 401) return new SessionExpiredError();
    return new NetworkError();
  }

  private classifyRefreshError(err: unknown): Error {
    if (!(err instanceof HttpErrorResponse)) return new NetworkError();
    if (err.status === 0 || err.status >= 500) return new NetworkError();
    if (err.status === 401) {
      const code = this.extractCode(err);
      if (code && REFRESH_FAILURE_CODES.has(code)) {
        return new RefreshFailedError();
      }
      // 401 sin code conocido también es refresh failure — no podemos seguir.
      return new RefreshFailedError();
    }
    return new NetworkError();
  }

  private classifyProfileError(err: unknown): Error {
    if (!(err instanceof HttpErrorResponse)) return new NetworkError();
    if (err.status === 0 || err.status >= 500) return new NetworkError();
    if (err.status === 401) return new SessionExpiredError();
    if (err.status === 403 || err.status === 404) return new ProfileNotAvailableError();
    return new NetworkError();
  }

  private extractCode(err: HttpErrorResponse): string | null {
    const body = err.error as ErrorBodyDto | null;
    return typeof body?.code === 'string' ? body.code : null;
  }
}

function isSelectionResponse(
  dto: PublicAuthResponseDto | PublicAuthSelectionResponseDto,
): dto is PublicAuthSelectionResponseDto {
  return 'selectionToken' in dto;
}
