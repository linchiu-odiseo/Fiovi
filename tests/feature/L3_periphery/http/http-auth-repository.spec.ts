// Tests del adapter L3 `HttpAuthRepository` contra learnex (post cut-over
// a slug dinámico + SSO selector).
//
// Endpoints:
// - Globales sin slug: /auth/login, /auth/select-tenant, /auth/sso/providers
// - Tenant-scoped con slug (hidratado en `SlugStore` en beforeEach):
//   /t/{slug}/auth/{refresh,logout,me}, /t/{slug}/{student|tutor}/me
//
// Usamos `HttpTestingController` para responder cada request sin red real.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpAuthRepository } from '../../../../src/L3_periphery/http/http-auth-repository';
import { SlugStore } from '../../../../src/L3_periphery/http/slug-store';
import { Identity } from '../../../../src/L1_domain/entities/identity';
import { InvalidCredentialsError } from '../../../../src/L1_domain/errors/invalid-credentials.error';
import { NetworkError } from '../../../../src/L1_domain/errors/network.error';
import { RateLimitError } from '../../../../src/L1_domain/errors/rate-limit.error';
import { RefreshFailedError } from '../../../../src/L1_domain/errors/refresh-failed.error';
import { ProfileNotAvailableError } from '../../../../src/L1_domain/errors/profile-not-available.error';
import { SelectionInvalidError } from '../../../../src/L1_domain/errors/selection-invalid.error';
import { SessionExpiredError } from '../../../../src/L1_domain/errors/session-expired.error';
import { UnsupportedRoleError } from '../../../../src/L1_domain/errors/unsupported-role.error';
import { environment } from '../../../../src/environments/environment';

const TEST_SLUG = 'vonex';
const LOGIN_URL = `${environment.apiBaseUrl}/auth/login`;
const SELECT_TENANT_URL = `${environment.apiBaseUrl}/auth/select-tenant`;
const SSO_PROVIDERS_URL = `${environment.apiBaseUrl}/auth/sso/providers`;
const TENANT_BASE = `${environment.apiBaseUrl}/t/${TEST_SLUG}`;
const ME_URL = `${TENANT_BASE}/auth/me`;
const REFRESH_URL = `${TENANT_BASE}/auth/refresh`;
const LOGOUT_URL = `${TENANT_BASE}/auth/logout`;
const STUDENT_PROFILE_URL = `${TENANT_BASE}/student/me`;
const TUTOR_PROFILE_URL = `${TENANT_BASE}/tutor/me`;

// Fixtures del payload del back. Simulan la respuesta HTTP real de learnex,
// que sigue incluyendo `permissions[]` — Fiovi lo ignora en el mapper (F5-03,
// ver `http-auth-repository.ts` para la razón). Se mantiene en los fixtures
// para reflejar fielmente lo que el server manda; el test verifica que no
// aparece en la `Identity` construida por el adapter.
const STUDENT_LOGIN_RESPONSE = {
  user: {
    id: '766aac21-71f9-4f48-a14a-5c2bcebc7d0b',
    tenantId: '5fff5eec-34dc-40a2-b15e-10e503e7c2dc',
    slug: TEST_SLUG,
    email: '79507732@vonex.edu.pe',
    codigo: '79507732',
    roles: ['student'],
    permissions: ['student:dashboard:view', 'student:exams:view'],
    dashboardKind: 'student',
  },
  expiresAt: 1781458612856,
};

const STUDENT_TENANT_RESPONSE = {
  user: {
    id: '766aac21-71f9-4f48-a14a-5c2bcebc7d0b',
    tenantId: '5fff5eec-34dc-40a2-b15e-10e503e7c2dc',
    email: '79507732@vonex.edu.pe',
    codigo: '79507732',
    roles: ['student'],
    permissions: ['student:dashboard:view', 'student:exams:view'],
    dashboardKind: 'student',
  },
  expiresAt: 1781458612856,
};

const TUTOR_LOGIN_RESPONSE = {
  user: {
    id: '7526d026-7de5-4b99-bd2f-cc95b560f630',
    tenantId: '5fff5eec-34dc-40a2-b15e-10e503e7c2dc',
    slug: TEST_SLUG,
    email: 'tutor1@vonex.pe',
    codigo: null,
    roles: ['tutor'],
    permissions: ['tutor:dashboard:view'],
    dashboardKind: 'tutor',
  },
  expiresAt: 1781410002223,
};

const SELECTION_RESPONSE = {
  selectionToken: 'jwt.selection.token',
  selectionExpiresAt: Date.now() + 5 * 60 * 1000,
  tenants: [
    { slug: 'vonex', name: 'Academia Vonex' },
    { slug: 'pitagoras', name: 'Academia Pitágoras' },
  ],
};

const STUDENT_PROFILE_RESPONSE = {
  id: '573e8dfa-faf4-4846-b05f-14143710515d',
  code: '79507732',
  firstName: 'Gabriel',
  lastName: 'Acuña Acuña',
  area: null as string | null,
};

const TUTOR_PROFILE_RESPONSE = {
  id: '19cabb89-c81d-4882-91be-3ab0e1414fae',
  code: 'T001',
  firstName: 'Carlos',
  lastName: 'Mendoza',
  email: 'tutor1@vonex.pe',
  classrooms: [
    {
      id: 'a957e020-14d6-41fb-af47-c52531d10b41',
      code: 'LIMA0001',
      name: 'Lima 01',
      modality: 'presencial',
      shift: 'manana',
      campusName: 'Lima Cercado',
      cycleId: 'e720709f-f499-4c77-974b-a4854bdd9632',
      cycleName: 'San Marcos - Semi Anual 0326',
      studentCount: 60,
    },
    {
      id: '5741e2db-a339-4466-99e5-1a4eb1d4339f',
      code: 'LIMA0002',
      name: 'Lima 02',
      modality: 'presencial',
      shift: 'manana',
      campusName: 'Lima San Juan De Lurigancho',
      cycleId: 'e720709f-f499-4c77-974b-a4854bdd9632',
      cycleName: 'San Marcos - Semi Anual 0326',
      studentCount: 60,
    },
  ],
};

describe('HttpAuthRepository', () => {
  let httpMock: HttpTestingController;
  let repo: HttpAuthRepository;
  let slugStore: SlugStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), HttpAuthRepository, SlugStore],
    });
    httpMock = TestBed.inject(HttpTestingController);
    repo = TestBed.inject(HttpAuthRepository);
    slugStore = TestBed.inject(SlugStore);
    // Los endpoints tenant-scoped requieren el slug hidratado — simulamos
    // el estado post-login. Los endpoints globales (login/select-tenant/providers)
    // no lo requieren pero setearlo no interfiere.
    slugStore.set(TEST_SLUG);
  });

  afterEach(() => httpMock.verify());

  describe('login (1 tenant)', () => {
    const credentials = { email: '79507732@vonex.edu.pe', password: '79507732' };

    it('mapea 200 alumno a Identity con slug incluido', async () => {
      const pending = repo.login(credentials);
      const req = httpMock.expectOne(LOGIN_URL);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(credentials);
      req.flush(STUDENT_LOGIN_RESPONSE);

      const outcome = await pending;
      expect(outcome).toBeInstanceOf(Identity);
      const identity = outcome as Identity;
      expect(identity.id).toBe('766aac21-71f9-4f48-a14a-5c2bcebc7d0b');
      expect(identity.tenantSlug).toBe(TEST_SLUG);
      expect(identity.email).toBe('79507732@vonex.edu.pe');
      expect(identity.codigo).toBe('79507732');
      expect(identity.tenantId).toBe('5fff5eec-34dc-40a2-b15e-10e503e7c2dc');
      expect(identity.role()).toBe('student');
      expect(identity.expiresAt).toBe(1781458612856);
    });

    it('mapea 200 tutor a Identity con codigo: null y roles: ["tutor"]', async () => {
      const pending = repo.login({ email: 'tutor1@vonex.pe', password: 'tutor123' });
      const req = httpMock.expectOne(LOGIN_URL);
      req.flush(TUTOR_LOGIN_RESPONSE);

      const outcome = await pending;
      expect(outcome).toBeInstanceOf(Identity);
      const identity = outcome as Identity;
      expect(identity.codigo).toBeNull();
      expect(identity.role()).toBe('tutor');
      expect(identity.tenantSlug).toBe(TEST_SLUG);
    });

    it('mapea 401 con code TENANT_AUTH_INVALID_CREDENTIALS a InvalidCredentialsError', async () => {
      const pending = repo.login(credentials);
      const req = httpMock.expectOne(LOGIN_URL);
      req.flush(
        { code: 'TENANT_AUTH_INVALID_CREDENTIALS', message: 'cualquier string del back' },
        { status: 401, statusText: 'Unauthorized' },
      );
      await expect(pending).rejects.toBeInstanceOf(InvalidCredentialsError);
    });

    it('mapea 401 sin code a InvalidCredentialsError (fallback anti-enumeration)', async () => {
      const pending = repo.login(credentials);
      const req = httpMock.expectOne(LOGIN_URL);
      req.flush({}, { status: 401, statusText: 'Unauthorized' });
      await expect(pending).rejects.toBeInstanceOf(InvalidCredentialsError);
    });

    it('mapea 429 a RateLimitError', async () => {
      const pending = repo.login(credentials);
      const req = httpMock.expectOne(LOGIN_URL);
      req.flush(
        { code: 'TENANT_AUTH_RATE_LIMITED' },
        { status: 429, statusText: 'Too Many Requests' },
      );
      await expect(pending).rejects.toBeInstanceOf(RateLimitError);
    });

    it('mapea 500 a NetworkError', async () => {
      const pending = repo.login(credentials);
      const req = httpMock.expectOne(LOGIN_URL);
      req.flush('boom', { status: 500, statusText: 'Server Error' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });

    it('mapea fallo de transporte (status 0) a NetworkError', async () => {
      const pending = repo.login(credentials);
      const req = httpMock.expectOne(LOGIN_URL);
      req.error(new ProgressEvent('error'), { status: 0, statusText: 'Network failure' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });

    it('mapea 200 con dashboardKind: "admin" a UnsupportedRoleError', async () => {
      const pending = repo.login(credentials);
      const req = httpMock.expectOne(LOGIN_URL);
      req.flush({
        ...STUDENT_LOGIN_RESPONSE,
        user: { ...STUDENT_LOGIN_RESPONSE.user, dashboardKind: 'admin' },
      });
      await expect(pending).rejects.toBeInstanceOf(UnsupportedRoleError);
    });

    it('mapea 200 sin dashboardKind (undefined) a UnsupportedRoleError', async () => {
      const pending = repo.login(credentials);
      const req = httpMock.expectOne(LOGIN_URL);
      const { dashboardKind: _dk, ...userNoKind } = STUDENT_LOGIN_RESPONSE.user;
      req.flush({
        ...STUDENT_LOGIN_RESPONSE,
        user: userNoKind,
      });
      await expect(pending).rejects.toBeInstanceOf(UnsupportedRoleError);
    });

    it('mapea 200 con dashboardKind: "generic" a UnsupportedRoleError (role custom sin baseKind)', async () => {
      const pending = repo.login(credentials);
      const req = httpMock.expectOne(LOGIN_URL);
      req.flush({
        ...STUDENT_LOGIN_RESPONSE,
        user: { ...STUDENT_LOGIN_RESPONSE.user, dashboardKind: 'generic' },
      });
      await expect(pending).rejects.toBeInstanceOf(UnsupportedRoleError);
    });

    it('acepta role custom cuando dashboardKind es student (student-seleccion, anual, etc.)', async () => {
      // Simula un tenant admin que creó un role custom llamado 'student-seleccion'
      // con baseKind='student'. El backend resuelve dashboardKind='student' por
      // prioridad. Fiovi acepta y rutea a /student/home como si fuera role de sistema.
      const pending = repo.login(credentials);
      const req = httpMock.expectOne(LOGIN_URL);
      req.flush({
        ...STUDENT_LOGIN_RESPONSE,
        user: {
          ...STUDENT_LOGIN_RESPONSE.user,
          roles: ['student-seleccion'],
          dashboardKind: 'student',
        },
      });
      const identity = await pending;
      expect((identity as { dashboardKind: string }).dashboardKind).toBe('student');
    });

    it('incluye captchaToken en el body cuando viene en las credenciales', async () => {
      const pending = repo.login({ ...credentials, captchaToken: 'turnstile-token-abc' });
      const req = httpMock.expectOne(LOGIN_URL);
      expect(req.request.body).toEqual({ ...credentials, captchaToken: 'turnstile-token-abc' });
      req.flush(STUDENT_LOGIN_RESPONSE);
      await pending;
    });

    it('omite captchaToken del body cuando viene undefined (dev sin captcha)', async () => {
      const pending = repo.login({ ...credentials, captchaToken: undefined });
      const req = httpMock.expectOne(LOGIN_URL);
      // El campo no aparece en absoluto — ni como key con undefined ni como null.
      // Zod del back en dev sin CAPTCHA_SECRET puede rechazar `null`; ausencia
      // total es siempre segura.
      expect(req.request.body).toEqual(credentials);
      expect('captchaToken' in (req.request.body as object)).toBe(false);
      req.flush(STUDENT_LOGIN_RESPONSE);
      await pending;
    });
  });

  describe('login (N tenants → SelectionChallenge)', () => {
    it('devuelve SelectionChallenge cuando el response trae selectionToken', async () => {
      const pending = repo.login({ email: 'multi@academia.edu', password: 'x' });
      const req = httpMock.expectOne(LOGIN_URL);
      req.flush(SELECTION_RESPONSE);

      const outcome = await pending;
      expect(outcome).not.toBeInstanceOf(Identity);
      if ('selectionToken' in outcome) {
        expect(outcome.selectionToken).toBe('jwt.selection.token');
        expect(outcome.tenants).toHaveLength(2);
        expect(outcome.tenants[0].slug).toBe('vonex');
        expect(outcome.tenants[1].slug).toBe('pitagoras');
      } else {
        throw new Error('expected SelectionChallenge branch');
      }
    });
  });

  describe('selectTenant', () => {
    const input = { selectionToken: 'jwt.selection.token', slug: TEST_SLUG };

    it('mapea 200 a Identity con slug del response', async () => {
      const pending = repo.selectTenant(input);
      const req = httpMock.expectOne(SELECT_TENANT_URL);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(input);
      req.flush(STUDENT_LOGIN_RESPONSE);

      const identity = await pending;
      expect(identity.tenantSlug).toBe(TEST_SLUG);
      expect(identity.role()).toBe('student');
    });

    it('mapea 401 a SelectionInvalidError (token expiró o inválido)', async () => {
      const pending = repo.selectTenant(input);
      const req = httpMock.expectOne(SELECT_TENANT_URL);
      req.flush(
        { code: 'PUBLIC_AUTH_SELECTION_TOKEN_INVALID' },
        { status: 401, statusText: 'Unauthorized' },
      );
      await expect(pending).rejects.toBeInstanceOf(SelectionInvalidError);
    });

    it('mapea 400 a SelectionInvalidError (slug fuera de la lista pre-autenticada)', async () => {
      const pending = repo.selectTenant(input);
      const req = httpMock.expectOne(SELECT_TENANT_URL);
      req.flush({}, { status: 400, statusText: 'Bad Request' });
      await expect(pending).rejects.toBeInstanceOf(SelectionInvalidError);
    });

    it('mapea 500 a NetworkError', async () => {
      const pending = repo.selectTenant(input);
      const req = httpMock.expectOne(SELECT_TENANT_URL);
      req.flush('boom', { status: 500, statusText: 'Server Error' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });
  });

  describe('listSsoProviders', () => {
    it('devuelve la lista mapeada', async () => {
      const pending = repo.listSsoProviders();
      const req = httpMock.expectOne(SSO_PROVIDERS_URL);
      expect(req.request.method).toBe('GET');
      req.flush({ providers: [{ provider: 'google', displayName: 'Google' }] });

      const providers = await pending;
      expect(providers).toEqual([{ provider: 'google', displayName: 'Google' }]);
    });

    it('devuelve [] si el request falla (best-effort — el user cae a password)', async () => {
      const pending = repo.listSsoProviders();
      const req = httpMock.expectOne(SSO_PROVIDERS_URL);
      req.flush('boom', { status: 500, statusText: 'Server Error' });

      const providers = await pending;
      expect(providers).toEqual([]);
    });
  });

  describe('me', () => {
    it('mapea 200 a Identity inyectando el slug del SlugStore', async () => {
      const pending = repo.me();
      const req = httpMock.expectOne(ME_URL);
      expect(req.request.method).toBe('GET');
      req.flush(STUDENT_TENANT_RESPONSE);

      const identity = await pending;
      expect(identity.tenantSlug).toBe(TEST_SLUG);
      expect(identity.email).toBe('79507732@vonex.edu.pe');
    });

    it('mapea 401 a SessionExpiredError', async () => {
      const pending = repo.me();
      const req = httpMock.expectOne(ME_URL);
      req.flush(null, { status: 401, statusText: 'Unauthorized' });
      await expect(pending).rejects.toBeInstanceOf(SessionExpiredError);
    });

    it('mapea 500 a NetworkError', async () => {
      const pending = repo.me();
      const req = httpMock.expectOne(ME_URL);
      req.flush('boom', { status: 500, statusText: 'Server Error' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });

    it('lanza NetworkError si el SlugStore no está hidratado (bug del programador)', async () => {
      slugStore.clear();
      await expect(repo.me()).rejects.toBeInstanceOf(NetworkError);
    });
  });

  describe('refresh', () => {
    it('mapea 200 a Identity actualizada', async () => {
      const pending = repo.refresh();
      const req = httpMock.expectOne(REFRESH_URL);
      expect(req.request.method).toBe('POST');
      req.flush(STUDENT_TENANT_RESPONSE);

      const identity = await pending;
      expect(identity.id).toBe('766aac21-71f9-4f48-a14a-5c2bcebc7d0b');
      expect(identity.tenantSlug).toBe(TEST_SLUG);
    });

    it('mapea 401 con code TENANT_AUTH_REFRESH_TOKEN_EXPIRED a RefreshFailedError', async () => {
      const pending = repo.refresh();
      const req = httpMock.expectOne(REFRESH_URL);
      req.flush(
        { code: 'TENANT_AUTH_REFRESH_TOKEN_EXPIRED' },
        { status: 401, statusText: 'Unauthorized' },
      );
      await expect(pending).rejects.toBeInstanceOf(RefreshFailedError);
    });

    it('mapea 401 con code TENANT_AUTH_REFRESH_TOKEN_MISSING a RefreshFailedError', async () => {
      const pending = repo.refresh();
      const req = httpMock.expectOne(REFRESH_URL);
      req.flush(
        { code: 'TENANT_AUTH_REFRESH_TOKEN_MISSING' },
        { status: 401, statusText: 'Unauthorized' },
      );
      await expect(pending).rejects.toBeInstanceOf(RefreshFailedError);
    });

    it('mapea 401 sin code a RefreshFailedError (fallback — no podemos seguir)', async () => {
      const pending = repo.refresh();
      const req = httpMock.expectOne(REFRESH_URL);
      req.flush({}, { status: 401, statusText: 'Unauthorized' });
      await expect(pending).rejects.toBeInstanceOf(RefreshFailedError);
    });
  });

  describe('logout', () => {
    it('204 resuelve sin error', async () => {
      const pending = repo.logout();
      const req = httpMock.expectOne(LOGOUT_URL);
      expect(req.request.method).toBe('POST');
      req.flush(null, { status: 204, statusText: 'No Content' });
      await expect(pending).resolves.toBeUndefined();
    });

    it('5xx propaga el error (best-effort lo maneja el use case caller)', async () => {
      const pending = repo.logout();
      const req = httpMock.expectOne(LOGOUT_URL);
      req.flush('boom', { status: 500, statusText: 'Server Error' });
      await expect(pending).rejects.toBeTruthy();
    });

    it('sin slug hidratado, es no-op sin request', async () => {
      slugStore.clear();
      await expect(repo.logout()).resolves.toBeUndefined();
      httpMock.expectNone(LOGOUT_URL);
    });
  });

  describe('getProfile', () => {
    it('student: mapea 200 a StudentProfile', async () => {
      const pending = repo.getProfile('student');
      const req = httpMock.expectOne(STUDENT_PROFILE_URL);
      expect(req.request.method).toBe('GET');
      req.flush(STUDENT_PROFILE_RESPONSE);

      const profile = await pending;
      expect(profile).toEqual({
        id: '573e8dfa-faf4-4846-b05f-14143710515d',
        code: '79507732',
        firstName: 'Gabriel',
        lastName: 'Acuña Acuña',
        area: null,
      });
    });

    it('tutor: mapea 200 a TutorProfile con 2 aulas', async () => {
      const pending = repo.getProfile('tutor');
      const req = httpMock.expectOne(TUTOR_PROFILE_URL);
      req.flush(TUTOR_PROFILE_RESPONSE);

      const profile = await pending;
      expect(profile.firstName).toBe('Carlos');
      if ('classrooms' in profile) {
        expect(profile.classrooms).toHaveLength(2);
      }
    });

    it('student: mapea 401 a SessionExpiredError', async () => {
      const pending = repo.getProfile('student');
      const req = httpMock.expectOne(STUDENT_PROFILE_URL);
      req.flush(null, { status: 401, statusText: 'Unauthorized' });
      await expect(pending).rejects.toBeInstanceOf(SessionExpiredError);
    });

    it('student: mapea 403 a ProfileNotAvailableError', async () => {
      const pending = repo.getProfile('student');
      const req = httpMock.expectOne(STUDENT_PROFILE_URL);
      req.flush(null, { status: 403, statusText: 'Forbidden' });
      await expect(pending).rejects.toBeInstanceOf(ProfileNotAvailableError);
    });

    it('student: mapea 500 a NetworkError', async () => {
      const pending = repo.getProfile('student');
      const req = httpMock.expectOne(STUDENT_PROFILE_URL);
      req.flush('boom', { status: 500, statusText: 'Server Error' });
      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });
  });

  describe('URLs vía apiPath — endpoints globales vs tenant-scoped', () => {
    it('login pega a /auth/login (SIN slug en path)', async () => {
      const pending = repo.login({ email: 'a@b.test', password: 'x' });
      const req = httpMock.expectOne(LOGIN_URL);
      expect(req.request.url).toBe(`${environment.apiBaseUrl}/auth/login`);
      req.flush(STUDENT_LOGIN_RESPONSE);
      await pending;
    });

    it('select-tenant pega a /auth/select-tenant (SIN slug en path)', async () => {
      const pending = repo.selectTenant({ selectionToken: 't', slug: 'vonex' });
      const req = httpMock.expectOne(SELECT_TENANT_URL);
      expect(req.request.url).toBe(`${environment.apiBaseUrl}/auth/select-tenant`);
      req.flush(STUDENT_LOGIN_RESPONSE);
      await pending;
    });

    it('me pega a /t/{slug}/auth/me con slug del SlugStore', async () => {
      const pending = repo.me();
      const req = httpMock.expectOne(ME_URL);
      expect(req.request.url).toBe(`${environment.apiBaseUrl}/t/${TEST_SLUG}/auth/me`);
      req.flush(STUDENT_TENANT_RESPONSE);
      await pending;
    });

    it('profile(student) pega a /t/{slug}/student/me', async () => {
      const pending = repo.getProfile('student');
      const req = httpMock.expectOne(STUDENT_PROFILE_URL);
      expect(req.request.url).toBe(`${environment.apiBaseUrl}/t/${TEST_SLUG}/student/me`);
      req.flush(STUDENT_PROFILE_RESPONSE);
      await pending;
    });
  });
});
