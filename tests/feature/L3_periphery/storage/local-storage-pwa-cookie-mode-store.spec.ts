import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalStoragePwaCookieModeStore } from '../../../../src/L3_periphery/storage/local-storage-pwa-cookie-mode-store';

const STORAGE_KEY = 'fiovi.pwa_cookie_mode';

describe('LocalStoragePwaCookieModeStore', () => {
  let store: LocalStoragePwaCookieModeStore;

  beforeEach(() => {
    localStorage.clear();
    store = new LocalStoragePwaCookieModeStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('isEnabled() = false en instalación fresh (no hay clave)', () => {
    expect(store.isEnabled()).toBe(false);
  });

  it('enable() persiste el flag y las próximas lecturas devuelven true', () => {
    store.enable();
    expect(store.isEnabled()).toBe(true);
    // Persistencia real: instancia nueva ve el mismo estado.
    const store2 = new LocalStoragePwaCookieModeStore();
    expect(store2.isEnabled()).toBe(true);
  });

  it('la clave persistida es la exacta esperada por el contrato del adapter', () => {
    store.enable();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1');
  });

  it('valores no esperados en la clave se tratan como deshabilitado (defensa contra data corrupta)', () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    expect(store.isEnabled()).toBe(false);
    localStorage.setItem(STORAGE_KEY, '');
    expect(store.isEnabled()).toBe(false);
    localStorage.setItem(STORAGE_KEY, '0');
    expect(store.isEnabled()).toBe(false);
  });

  it('isEnabled() devuelve false si localStorage está bloqueado (Safari ITP / modo privado)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: The operation is insecure.');
    });
    expect(store.isEnabled()).toBe(false); // No crash, degrada silenciosamente.
  });

  it('enable() no rompe si localStorage está bloqueado (Safari ITP)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => store.enable()).not.toThrow();
    // Y el store queda como pre-migración — el próximo login re-intentará.
  });
});
