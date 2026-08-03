// Tests del adapter L3 `LocalStorageIdentityStorage` — persistencia de
// `Identity` bajo la key `fiovi.identity`.
//
// Cubre los scenarios del spec `session-storage`:
// - Round-trip write/read (incluye dashboardKind)
// - Storage vacío → null
// - JSON corrupto → null + key eliminada
// - Shape inválido (campos faltantes / tipos errados) → null + key eliminada
// - Sin dashboardKind válido ni fallback en roles[0] → null + key eliminada
// - Backwards-compat: shape sin dashboardKind pero con roles[0] ∈ {student, tutor}
//   → carga OK con dashboardKind derivado de roles[0]
// - Key legacy `lugia.session` queda ignorada
// - clear() elimina la key
// - `codigo: null` (tutor real) es válido
// - Payload legacy con `permissions` (pre F5-03) → se lee ignorando el campo

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalStorageIdentityStorage } from '../../../../src/L3_periphery/storage/local-storage-identity-storage';
import { Identity } from '../../../../src/L1_domain/entities/identity';

const STORAGE_KEY = 'fiovi.identity';
const LEGACY_KEY = 'lugia.session';

// Payload persisted "canónico" — sin dashboardKind. Sirve para tests de fallback
// donde el read tiene que derivar dashboardKind desde roles[0]. Los tests que
// específicamente verifican persistencia de dashboardKind usan otro fixture.
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
    it('persiste y devuelve la Identity con todos los campos (incluyendo dashboardKind)', async () => {
      const identity = new Identity(
        '766aac21-71f9-4f48-a14a-5c2bcebc7d0b',
        '5fff5eec-34dc-40a2-b15e-10e503e7c2dc',
        'vonex',
        '79507732@vonex.edu.pe',
        '79507732',
        ['student'],
        'student',
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
      expect(restored?.dashboardKind).toBe('student');
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
        'student',
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
        'student',
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
        'tutor',
        1781410002223,
      );
      await storage.write(tutor);
      const restored = await storage.read();
      expect(restored?.codigo).toBeNull();
      expect(restored?.dashboardKind).toBe('tutor');
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

    it('shape sin dashboardKind y con roles vacío → null (ninguna fuente de tipo válida)', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...VALID_PERSISTED, roles: [] }));
      expect(await storage.read()).toBeNull();
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('shape sin dashboardKind y con roles[0] no soportado → null (fallback falla)', async () => {
      // Ejemplo: sesión persistida donde el back ahora devuelve un role custom
      // como primary y no hay dashboardKind. Sin fuente válida → limpiar.
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...VALID_PERSISTED, roles: ['admin'] }));
      expect(await storage.read()).toBeNull();
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
  });

  describe('backwards-compat con sesiones previas al PR de dashboardKind', () => {
    it('shape sin dashboardKind pero con roles[0]=student → carga con dashboardKind=student', async () => {
      // Sesiones persistidas antes del PR no tienen dashboardKind. Fallback:
      // usar roles[0] si es student|tutor. Evita forzar re-login.
      localStorage.setItem(STORAGE_KEY, JSON.stringify(VALID_PERSISTED));
      const restored = await storage.read();
      expect(restored).toBeInstanceOf(Identity);
      expect(restored?.dashboardKind).toBe('student');
      expect(restored?.role()).toBe('student');
    });

    it('shape sin dashboardKind pero con roles[0]=tutor → carga con dashboardKind=tutor', async () => {
      const tutorLegacy = { ...VALID_PERSISTED, roles: ['tutor'], codigo: null };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tutorLegacy));
      const restored = await storage.read();
      expect(restored?.dashboardKind).toBe('tutor');
    });

    it('dashboardKind persistido tiene precedencia sobre roles[0]', async () => {
      // Un user real con role custom `alumno-becado` que el backend resuelve a
      // dashboardKind='student' — la fuente autoritativa es dashboardKind, no
      // roles[].
      const customRole = {
        ...VALID_PERSISTED,
        roles: ['alumno-becado'],
        dashboardKind: 'student',
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(customRole));
      const restored = await storage.read();
      expect(restored?.dashboardKind).toBe('student');
      expect(restored?.roles).toEqual(['alumno-becado']);
    });

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
        'student',
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
