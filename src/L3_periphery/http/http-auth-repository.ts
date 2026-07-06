import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthRepository } from '../../L1_domain/ports/auth-repository';
import { Identity, Role } from '../../L1_domain/entities/identity';
import { StudentProfile } from '../../L1_domain/value-objects/student-profile';
import { TutorProfile } from '../../L1_domain/value-objects/tutor-profile';
import { InvalidCredentialsError } from '../../L1_domain/errors/invalid-credentials.error';
import { NetworkError } from '../../L1_domain/errors/network.error';
import { RateLimitError } from '../../L1_domain/errors/rate-limit.error';
import { RefreshFailedError } from '../../L1_domain/errors/refresh-failed.error';
import { ProfileNotAvailableError } from '../../L1_domain/errors/profile-not-available.error';
import { SessionExpiredError } from '../../L1_domain/errors/session-expired.error';
import { UnsupportedRoleError } from '../../L1_domain/errors/unsupported-role.error';
import { apiPath } from './api-paths';

// Roles que Fiovi soporta hoy. Cualquier otro (admin, teacher, custom)
// que devuelva el back se rechaza en el mapper con UnsupportedRoleError.
// Cuando se agregue soporte, ampliar este set y el tipo `Role` en L1.
const SUPPORTED_ROLES: ReadonlySet<Role> = new Set(['student', 'tutor']);

// Shapes del back learnex (verificados al 2026-06-13 contra responses reales).
// Ver .authentic/pwa-auth-contract.md y proposal.md del change.
interface LoginResponseDto {
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
const CODE_REFRESH_INVALID = 'TENANT_AUTH_REFRESH_TOKEN_INVALID';
const CODE_REFRESH_MISSING = 'TENANT_AUTH_REFRESH_TOKEN_MISSING';

@Injectable({ providedIn: 'root' })
export class HttpAuthRepository implements AuthRepository {
  private readonly http = inject(HttpClient);

  async login(credentials: { email: string; password: string }): Promise<Identity> {
    try {
      const dto = await firstValueFrom(
        this.http.post<LoginResponseDto>(apiPath.login(), credentials),
      );
      return this.mapIdentity(dto);
    } catch (err) {
      // UnsupportedRoleError viene de mapIdentity (post-200), NO es error HTTP.
      // Propagar tal cual sin clasificar.
      if (err instanceof UnsupportedRoleError) throw err;
      throw this.classifyLoginError(err);
    }
  }

  async me(): Promise<Identity> {
    try {
      const dto = await firstValueFrom(this.http.get<LoginResponseDto>(apiPath.me()));
      return this.mapIdentity(dto);
    } catch (err) {
      if (err instanceof UnsupportedRoleError) throw err;
      throw this.classifyMeError(err);
    }
  }

  async refresh(): Promise<Identity> {
    try {
      const dto = await firstValueFrom(
        this.http.post<LoginResponseDto>(apiPath.refresh(), {}),
      );
      return this.mapIdentity(dto);
    } catch (err) {
      if (err instanceof UnsupportedRoleError) throw err;
      throw this.classifyRefreshError(err);
    }
  }

  async logout(): Promise<void> {
    // Best-effort: errores de red o 5xx no se clasifican — el LogoutUseCase
    // ya envuelve la llamada en try/catch y continúa con la limpieza local.
    await firstValueFrom(this.http.post(apiPath.logout(), {}));
  }

  async getProfile(role: Role): Promise<StudentProfile | TutorProfile> {
    try {
      if (role === 'student') {
        const dto = await firstValueFrom(
          this.http.get<StudentProfileDto>(apiPath.profile('student')),
        );
        return this.mapStudentProfile(dto);
      }
      const dto = await firstValueFrom(
        this.http.get<TutorProfileDto>(apiPath.profile('tutor')),
      );
      return this.mapTutorProfile(dto);
    } catch (err) {
      throw this.classifyProfileError(err);
    }
  }

  // --- mappers ---

  private mapIdentity(dto: LoginResponseDto): Identity {
    // Validamos rol ANTES de construir Identity: el cast `as Role[]` sería
    // una mentira de TypeScript si el back devuelve admin/teacher. El
    // invariante single-role de Identity ya se aplica en su constructor;
    // acá agregamos el invariante "rol soportado por este cliente".
    const rawRole = dto.user.roles[0];
    if (dto.user.roles.length !== 1 || !SUPPORTED_ROLES.has(rawRole as Role)) {
      throw new UnsupportedRoleError(rawRole ?? '(empty)');
    }
    return new Identity(
      dto.user.id,
      dto.user.tenantId,
      dto.user.email,
      dto.user.codigo,
      [rawRole as Role],
      dto.user.permissions,
      dto.expiresAt,
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
      if (code === CODE_REFRESH_INVALID || code === CODE_REFRESH_MISSING) {
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
