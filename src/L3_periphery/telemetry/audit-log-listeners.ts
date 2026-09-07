import { AuditLogStore } from './audit-log-store.service';
import type { AIEvent, AOEvent, DPEvent } from './audit-log-event';
import { lookupSsoError } from './audit-log-dictionaries';

// Instala listeners globales para eventos de aplicación (VC, OF, AI-prompt).
// Emite AO al bootstrap (cold vs warm) y, si es el primer bootstrap del día,
// también DP y AI-standalone.
//
// Se invoca desde un `provideAppInitializer` en app.config.ts.
// Idempotente por diseño: llamado múltiple veces solo re-registra listeners
// nuevos (los viejos siguen activos, no hay dedup — no debería llamarse >1).

export function installAuditLogListeners(store: AuditLogStore): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  // AO — cold vs warm. Usamos performance.getEntriesByType('navigation')[0].type:
  // 'reload' → warm (0), cualquier otro → cold (1).
  const navEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
  const isReload = navEntries[0]?.type === 'reload';
  const seId = readSsoErrorId();
  const ao: AOEvent = {
    t: Date.now(),
    e: 'AO',
    cold: isReload ? 0 : 1,
    ...(seId !== undefined ? { se: seId } : {}),
  };
  store.append(ao);

  // DP + AI-standalone se emiten solo si no están ya en el batch de hoy
  // (evita duplicados en reloads del mismo día). Async fire-and-forget.
  void emitOncePerDay(store);

  // Listener visibilitychange → VC
  document.addEventListener('visibilitychange', () => {
    const v: 0 | 1 = document.visibilityState === 'visible' ? 1 : 0;
    store.append({ t: Date.now(), e: 'VC', v });
  });

  // Listeners online/offline → OF
  window.addEventListener('online', () => {
    store.append({ t: Date.now(), e: 'OF', o: 1 });
  });
  window.addEventListener('offline', () => {
    store.append({ t: Date.now(), e: 'OF', o: 0 });
  });

  // Listener appinstalled → AI mode:prompt-accepted (one-shot en la vida del user)
  window.addEventListener('appinstalled', () => {
    const ai: AIEvent = { t: Date.now(), e: 'AI', mode: 'prompt-accepted' };
    store.append(ai);
  });
}

// Emite DP y AI-standalone solo si el batch del día no los tiene ya.
// Best-effort: si currentDayBatch falla, se re-intentaría en el próximo bootstrap.
async function emitOncePerDay(store: AuditLogStore): Promise<void> {
  const batch = await store.currentDayBatch();
  const hasDP = batch.some((ev) => ev.e === 'DP');
  const hasAIStandalone = batch.some((ev) => ev.e === 'AI' && ev.mode === 'standalone');

  if (!hasDP) {
    const dp: DPEvent = {
      t: Date.now(),
      e: 'DP',
      ram: readDeviceMemory(),
      cores: readHardwareConcurrency(),
      screen: `${window.innerWidth}x${window.innerHeight}`,
      dpr: window.devicePixelRatio,
    };
    store.append(dp);
  }

  if (!hasAIStandalone) {
    const isStandalone = safeMatchMedia('(display-mode: standalone)');
    if (isStandalone) {
      const ai: AIEvent = { t: Date.now(), e: 'AI', mode: 'standalone' };
      store.append(ai);
    }
  }
}

function readDeviceMemory(): number | null {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null;
}

function readHardwareConcurrency(): number | null {
  return typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : null;
}

function safeMatchMedia(query: string): boolean {
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

// Lee `?sso_error=X` de la URL de bootstrap (Sub-bloque F.3). Defensivo: si
// `window.location` no está disponible o el parseo falla, no emite `se`
// (undefined) en vez de lanzar — el bootstrap de la app no puede fallar por
// esto.
function readSsoErrorId(): number | undefined {
  try {
    const search = window.location?.search;
    if (!search) return undefined;
    const params = new URLSearchParams(search);
    const code = params.get('sso_error');
    if (!code) return undefined;
    return lookupSsoError(code);
  } catch {
    return undefined;
  }
}
