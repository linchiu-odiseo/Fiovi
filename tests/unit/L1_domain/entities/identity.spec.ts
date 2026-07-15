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
    roles: ['student'] as ['student'] | ['tutor'],
    expiresAt: NOW + 60_000,
  };
  const merged = { ...defaults, ...overrides };
  return new Identity(
    merged.id as string,
    merged.tenantId as string,
    merged.tenantSlug as string,
    merged.email as string,
    merged.codigo as string | null,
    merged.roles as ['student'] | ['tutor'],
    merged.expiresAt as number,
  );
};

describe('Identity', () => {
  describe('constructor', () => {
    it('construye correctamente con 1 rol student', () => {
      const identity = makeIdentity({ roles: ['student'] });
      expect(identity.roles).toEqual(['student']);
      expect(identity.email).toBe('alumno@vonex.edu.pe');
    });

    it('construye correctamente con 1 rol tutor', () => {
      const identity = makeIdentity({ roles: ['tutor'], email: 'tutor1@vonex.pe', codigo: null });
      expect(identity.roles).toEqual(['tutor']);
      expect(identity.codigo).toBeNull();
    });

    it('lanza InvalidIdentityError con 0 roles', () => {
      expect(
        () => new Identity('id', 'tid', 'vonex', 'email@test.pe', null, [], NOW + 1000),
      ).toThrow(InvalidIdentityError);
    });

    it('lanza InvalidIdentityError con 2 roles', () => {
      expect(
        () =>
          new Identity(
            'id',
            'tid',
            'vonex',
            'email@test.pe',
            null,
            ['student', 'tutor'],
            NOW + 1000,
          ),
      ).toThrow(InvalidIdentityError);
    });

    it('lanza InvalidIdentityError si tenantSlug es vacío', () => {
      expect(
        () => new Identity('id', 'tid', '', 'email@test.pe', null, ['student'], NOW + 1000),
      ).toThrow(InvalidIdentityError);
    });

    it('expone tenantSlug como propiedad readonly', () => {
      const identity = makeIdentity({ tenantSlug: 'pitagoras' });
      expect(identity.tenantSlug).toBe('pitagoras');
    });
  });

  describe('role()', () => {
    it('devuelve el único rol (student)', () => {
      const identity = makeIdentity({ roles: ['student'] });
      expect(identity.role()).toBe('student');
    });

    it('devuelve el único rol (tutor)', () => {
      const identity = makeIdentity({ roles: ['tutor'] });
      expect(identity.role()).toBe('tutor');
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
      // Con expiresAt NOW + 30_000 y default 60_000 → debe devolver true
      const identity = makeIdentity({ expiresAt: NOW + 30_000 });
      expect(identity.shouldRefresh(NOW)).toBe(true);
    });
  });
});
