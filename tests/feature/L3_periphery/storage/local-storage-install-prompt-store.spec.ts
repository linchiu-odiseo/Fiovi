import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalStorageInstallPromptStore } from '../../../../src/L3_periphery/storage/local-storage-install-prompt-store';

const STORAGE_KEY = 'fiovi.install_prompt.installed';

describe('LocalStorageInstallPromptStore', () => {
  let store: LocalStorageInstallPromptStore;

  beforeEach(() => {
    localStorage.clear();
    store = new LocalStorageInstallPromptStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('devuelve false en instalación fresh', () => {
    expect(store.isMarkedInstalled()).toBe(false);
  });

  it('markInstalled() persiste el flag y las próximas lecturas devuelven true', () => {
    store.markInstalled();
    expect(store.isMarkedInstalled()).toBe(true);
    // Persistencia real: instancia nueva ve el mismo estado.
    expect(new LocalStorageInstallPromptStore().isMarkedInstalled()).toBe(true);
  });

  it('la clave persistida es la exacta esperada por el contrato', () => {
    store.markInstalled();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1');
  });

  it('valores corruptos se tratan como false', () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    expect(store.isMarkedInstalled()).toBe(false);
    localStorage.setItem(STORAGE_KEY, '0');
    expect(store.isMarkedInstalled()).toBe(false);
    localStorage.setItem(STORAGE_KEY, '');
    expect(store.isMarkedInstalled()).toBe(false);
  });

  it('degrada silencioso si localStorage está bloqueado al leer', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(store.isMarkedInstalled()).toBe(false);
  });

  it('markInstalled() no crashea si localStorage está bloqueado', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => store.markInstalled()).not.toThrow();
  });
});
