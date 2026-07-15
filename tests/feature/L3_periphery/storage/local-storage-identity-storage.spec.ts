// Tests del adapter L3 `LocalStorageIdentityStorage` — persistencia de
// `Identity` bajo la key `fiovi.identity`. Reemplaza al viejo
// `LocalStorageSessionStorage`.
//
// Cubre los scenarios del spec `session-storage`:
// - Round-trip write/read
// - Storage vacío → null
// - JSON corrupto → null + key eliminada
// - Shape inválido (campos faltantes / tipos errados) → null + key eliminada
// - Invariante de Identity violado (roles.length !== 1) → null + key eliminada
// - Key legacy `lugia.session` queda ignorada
// - clear() elimina la key
// - `codigo: null` (tutor real) es válido
// - Payload legacy con `permissions` (pre F5-03) → se lee ignorando el campo

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalStorageIdentityStorage } from '../../../../src/L3_periphery/storage/local-storage-identity-storage';
import { Identity } from '../../../../src/L1_domain/entities/identity';

const STORAGE_KEY = 'fiovi.identity';
const LEGACY_KEY = 'lugia.session';

const VALID_PERSISTED = {
  id: '766aac21-71f9-4f48-a14a-5c2bcebc7d0b',
  tenantId: '5fff5eec-34dc-40a2-b15e-10e503e7c2dc',
  tenantSlug: 'vonex',
  email: '79507732@vonex.edu.pe',
  codigo: '79507732',
  roles: ['student'],
  expiresAt: 1781458612856,
};

describe('LocalStorageIdentityStorage', () => {
  let storage: LocalStorageIdentityStorage;

  beforeEach(() => {
    localStorage.clear();
    storage = new LocalStorageIdentityStorage();
  });

  afterEach(() => localStorage.clear());

  describe('write + read (round-trip)', () => {
    it('persiste y devuelve la Identity con todos los campos', async () => {
      const identity = new Identity(
        '766aac21-71f9-4f48-a14a-5c2bcebc7d0b',
        '5fff5eec-34dc-40a2-b15e-10e503e7c2dc',
        'vonex',
        '79507732@vonex.edu.pe',
        '79507732',
        ['student'],
        1781458612856,
      );
      await storage.write(identity);
      const restored = await storage.read();
      expect(restored).toBeInstanceOf(Identity);
      expect(restored?.id).toBe('766aac21-71f9-4f48-a14a-5c2bcebc7d0b');
      expect(restored?.tenantSlug).toBe('vonex');
      expect(restored?.email).toBe('79507732@vonex.edu.pe');
      expect(restored?.codigo).toBe('79507732');
      expect(restored?.roles).toEqual(['student']);
      expect(restored?.expiresAt).toBe(1781458612856);
      expect(restored?.role()).toBe('student');
    });

    it('NO persiste `permissions` en el JSON (F5-03: minimización de PII)', async () => {
      const identity = new Identity(
        'id',
        'tenant',
        'vonex',
        'a@b.test',
        '12345',
        ['student'],
        Date.now() + 60_000,
      );
      await storage.write(identity);
      const raw = localStorage.getItem(STORAGE_KEY);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw as string);
      expect(parsed).not.toHaveProperty('permissions');
    });

    it('usa la clave exacta `fiovi.identity`', async () => {
      const identity = new Identity(
        'id',
        'tenant',
        'vonex',
        'a@b.test',
        '12345',
        ['student'],
        Date.now() + 60_000,
      );
      await storage.write(identity);
      expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    });

    it('tutor con codigo: null se persiste y restaura correctamente', async () => {
      const tutor = new Identity(
        '7526d026-7de5-4b99-bd2f-cc95b560f630',
        'tenant',
        'vonex',
        'tutor1@vonex.pe',
        null, // tutor real: codigo viene null del back
        ['tutor'],
        1781410002223,
      );
      await storage.write(tutor);
      const restored = await storage.read();
      expect(restored?.codigo).toBeNull();
      expect(restored?.role()).toBe('tutor');
    });
  });

  describe('read sin datos', () => {
    it('localStorage vacío devuelve null', async () => {
      expect(await storage.read()).toBeNull();
    });
  });

  describe('read con datos corruptos', () => {
    it('JSON no parseable → null + key eliminada', async () => {
      localStorage.setItem(STORAGE_KEY, 'no-soy-json{');
      expect(await storage.read()).toBeNull();
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('shape sin id → null + key eliminada', async () => {
      const broken = { ...VALID_PERSISTED } as Partial<typeof VALID_PERSISTED>;
      delete broken.id;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(broken));
      expect(await storage.read()).toBeNull();
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('shape con roles no array → null + key eliminada', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...VALID_PERSISTED, roles: 'student' }));
      expect(await storage.read()).toBeNull();
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('shape con expiresAt no number → null + key eliminada', async () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...VALID_PERSISTED, expiresAt: 'manana' }),
      );
      expect(await storage.read()).toBeNull();
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('shape sintácticamente OK pero roles.length === 0 → null + key eliminada (Identity constructor lanza)', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...VALID_PERSISTED, roles: [] }));
      expect(await storage.read()).toBeNull();
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('shape sintácticamente OK pero roles.length === 2 → null + key eliminada', async () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...VALID_PERSISTED, roles: ['student', 'tutor'] }),
      );
      expect(await storage.read()).toBeNull();
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
  });

  describe('compatibilidad con instalaciones previas', () => {
    it('payload legacy con `permissions` extra → se lee OK ignorando el campo', async () => {
      // Instalaciones anteriores a F5-03 dejaron `permissions` en localStorage.
      // Al bootear, la app debe rehidratar la Identity sin crashear ni descartar
      // la sesión — el campo extra simplemente se ignora.
      const legacy = { ...VALID_PERSISTED, permissions: ['student:exams:view'] };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
      const restored = await storage.read();
      expect(restored).toBeInstanceOf(Identity);
      expect(restored?.email).toBe(VALID_PERSISTED.email);
      // Al reescribir después con write(), el campo legacy desaparece.
      if (restored) await storage.write(restored);
      const rewritten = JSON.parse(localStorage.getItem(STORAGE_KEY) as string);
      expect(rewritten).not.toHaveProperty('permissions');
    });
  });

  describe('key legacy `lugia.session`', () => {
    it('data huérfana de la key vieja → null (no migra, no crashea, no la borra)', async () => {
      localStorage.setItem(
        LEGACY_KEY,
        JSON.stringify({ bearerToken: '6|legacy', userEmail: 'old@panda.test' }),
      );
      // El storage nuevo ni lee ni toca esa key — sólo devuelve null porque
      // `fiovi.identity` no existe.
      expect(await storage.read()).toBeNull();
      // Y la key legacy NO la tocamos (puede seguir ahí, no es nuestro problema).
      expect(localStorage.getItem(LEGACY_KEY)).not.toBeNull();
    });
  });

  describe('clear', () => {
    it('elimina la key del storage', async () => {
      const identity = new Identity(
        'id',
        'tenant',
        'vonex',
        'a@b.test',
        null,
        ['student'],
        Date.now() + 60_000,
      );
      await storage.write(identity);
      await storage.clear();
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
      expect(await storage.read()).toBeNull();
    });

    it('es idempotente: clear sin datos no falla', async () => {
      await expect(storage.clear()).resolves.toBeUndefined();
    });
  });
});
