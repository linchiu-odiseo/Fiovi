import { describe, it, expect } from 'vitest';
import { Identity } from '../../../../src/L1_domain/entities/identity';
import { InvalidIdentityError } from '../../../../src/L1_domain/errors/invalid-identity.error';

const NOW = 1_700_000_000_000; // ms timestamp fijo para tests

const makeIdentity = (overrides: Record<string, unknown> = {}) => {
  const defaults = {
    id: 'user-uuid',
    tenantId: 'tenant-uuid',
    tenantSlug: 'vonex',
    email: 'alumno@vonex.edu.pe',
    codigo: '79507732' as string | null,
    roles: ['student'] as string[],
    dashboardKind: 'student' as 'student' | 'tutor',
    expiresAt: NOW + 60_000,
  };
  const merged = { ...defaults, ...overrides };
  return new Identity(
    merged.id as string,
    merged.tenantId as string,
    merged.tenantSlug as string,
    merged.email as string,
    merged.codigo as string | null,
    merged.roles as string[],
    merged.dashboardKind as 'student' | 'tutor',
    merged.expiresAt as number,
  );
};

describe('Identity', () => {
  describe('constructor', () => {
    it('construye correctamente con dashboardKind student', () => {
      const identity = makeIdentity({ dashboardKind: 'student' });
      expect(identity.dashboardKind).toBe('student');
      expect(identity.email).toBe('alumno@vonex.edu.pe');
    });

    it('construye correctamente con dashboardKind tutor', () => {
      const identity = makeIdentity({
        dashboardKind: 'tutor',
        roles: ['tutor'],
        email: 'tutor1@vonex.pe',
        codigo: null,
      });
      expect(identity.dashboardKind).toBe('tutor');
      expect(identity.codigo).toBeNull();
    });

    it('acepta múltiples roles (custom + system) — el filtrado por Fiovi lo hace el mapper', () => {
      // Después de introducir custom roles, un user puede traer varios nombres
      // (`admin`, `student-seleccion`, `anual`...). Identity no valida el contenido
      // ni la cantidad — el dashboardKind (resuelto por el backend con prioridad)
      // es lo único que Fiovi rutea. La membresía `dashboardKind ∈ {student, tutor}`
      // se valida en el HTTP repo antes de instanciar Identity.
      const identity = makeIdentity({
        roles: ['student', 'student-seleccion'],
        dashboardKind: 'student',
      });
      expect(identity.roles).toEqual(['student', 'student-seleccion']);
      expect(identity.dashboardKind).toBe('student');
    });

    it('acepta roles vacío (el filtrado por dashboardKind vive en el mapper)', () => {
      // Mismo motivo que arriba: Identity es data pura, no valida contenido de
      // roles. Si algún caller construye Identity sin roles pero con dashboardKind
      // válido, Fiovi funciona normalmente porque nunca branchea por roles[].
      const identity = makeIdentity({ roles: [], dashboardKind: 'student' });
      expect(identity.roles).toEqual([]);
      expect(identity.dashboardKind).toBe('student');
    });

    it('lanza InvalidIdentityError si tenantSlug es vacío', () => {
      expect(
        () =>
          new Identity('id', 'tid', '', 'email@test.pe', null, ['student'], 'student', NOW + 1000),
      ).toThrow(InvalidIdentityError);
    });

    it('expone tenantSlug como propiedad readonly', () => {
      const identity = makeIdentity({ tenantSlug: 'pitagoras' });
      expect(identity.tenantSlug).toBe('pitagoras');
    });
  });

  describe('role() (alias legacy de dashboardKind)', () => {
    it('devuelve dashboardKind cuando es student', () => {
      const identity = makeIdentity({ dashboardKind: 'student' });
      expect(identity.role()).toBe('student');
    });

    it('devuelve dashboardKind cuando es tutor', () => {
      const identity = makeIdentity({ dashboardKind: 'tutor' });
      expect(identity.role()).toBe('tutor');
    });

    it('no depende de roles[0] — devuelve dashboardKind aunque roles[0] no matchee', () => {
      // Ejemplo: user con role custom `alumno-becado` que el backend resuelve
      // como dashboardKind='student'. Fiovi rutea a /student/home igual.
      const identity = makeIdentity({
        roles: ['alumno-becado'],
        dashboardKind: 'student',
      });
      expect(identity.role()).toBe('student');
    });
  });

  describe('isExpired()', () => {
    it('devuelve true si expiresAt está en el pasado (now >= expiresAt)', () => {
      const identity = makeIdentity({ expiresAt: NOW - 1000 });
      expect(identity.isExpired(NOW)).toBe(true);
    });

    it('devuelve true si expiresAt === now (límite exacto)', () => {
      const identity = makeIdentity({ expiresAt: NOW });
      expect(identity.isExpired(NOW)).toBe(true);
    });

    it('devuelve false si expiresAt está en el futuro', () => {
      const identity = makeIdentity({ expiresAt: NOW + 60_000 });
      expect(identity.isExpired(NOW)).toBe(false);
    });
  });

  describe('shouldRefresh()', () => {
    it('devuelve true si queda menos del umbral (30s < 60s threshold)', () => {
      const identity = makeIdentity({ expiresAt: NOW + 30_000 });
      expect(identity.shouldRefresh(NOW, 60_000)).toBe(true);
    });

    it('devuelve false si queda más del umbral (120s > 60s threshold)', () => {
      const identity = makeIdentity({ expiresAt: NOW + 120_000 });
      expect(identity.shouldRefresh(NOW, 60_000)).toBe(false);
    });

    it('usa threshold por defecto de 60_000ms si no se pasa', () => {
      const identity = makeIdentity({ expiresAt: NOW + 30_000 });
      expect(identity.shouldRefresh(NOW)).toBe(true);
    });
  });
});
