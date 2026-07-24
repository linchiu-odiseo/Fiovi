import { Injectable, signal, inject } from '@angular/core';
import { SwUpdate, VersionEvent, VersionReadyEvent } from '@angular/service-worker';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

import {
  CHECK_THROTTLE_MS,
  EMPTY_PENDING_UPDATE,
  PendingUpdate,
  VERSION_FALLBACK,
} from './pwa-update.types';

// Servicio L3 que orquesta el ciclo de actualización del shell servido por el
// Service Worker de Angular:
//   1. Escucha versionUpdates → al detectar VERSION_READY guarda la versión
//      latched (no la expone aún).
//   2. Aplica gating de ruta: la versión solo se expone (available=true)
//      cuando el alumno NO está en /simulacro/:id, para no interrumpir un
//      examen en curso. El gating se re-evalúa en cada NavigationEnd.
//   3. Polling adicional: cada vez que la app vuelve a foreground
//      (visibilitychange + online + throttle 60s) dispara un checkForUpdate.
//   4. applyUpdate(): activate + reload, idempotente, con fallback silencioso
//      si la activación falla.
@Injectable({ providedIn: 'root' })
export class PwaUpdateService {
  private readonly swUpdate = inject(SwUpdate);
  private readonly router = inject(Router);

  readonly pendingUpdate = signal<PendingUpdate>(EMPTY_PENDING_UPDATE);

  private started = false;
  private latchedUpdate: PendingUpdate | null = null;
  private lastCheckTimestamp = 0;
  private applying = false;

  // Listener bound como property para que addEventListener/removeEventListener
  // operen sobre la misma referencia.
  private readonly onVisibilityChange = (): void => {
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
    if (typeof navigator === 'undefined' || !navigator.onLine) return;
    const now = Date.now();
    if (now - this.lastCheckTimestamp < CHECK_THROTTLE_MS) return;
    this.lastCheckTimestamp = now;
    void this.swUpdate.checkForUpdate().catch((error) => {
      console.warn('PwaUpdate: checkForUpdate failed', error);
    });
  };

  start(): void {
    if (this.started) return;
    this.started = true;

    if (!this.swUpdate.isEnabled) {
      console.info('PwaUpdate: SwUpdate disabled, skipping init');
      return;
    }

    this.swUpdate.versionUpdates
      .pipe(filter((event): event is VersionReadyEvent => event.type === 'VERSION_READY'))
      .subscribe((event: VersionEvent) => {
        const ready = event as VersionReadyEvent;
        const fromVersion = readAppDataVersion(ready.currentVersion);
        const toVersion = readAppDataVersion(ready.latestVersion);
        this.latchedUpdate = { available: false, fromVersion, toVersion };
        this.evaluateGating();
      });

    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() => this.evaluateGating());

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  // Chequeo manual bypasseando el throttle de visibilitychange. Devuelve
  // `true` si el SW descubrió una nueva versión (VERSION_READY se emitirá
  // de manera asincrónica y actualizará `pendingUpdate`), `false` si no
  // hay update disponible o si el service worker no está habilitado
  // (typical en dev, en pestañas insecure, o en navegadores sin soporte).
  //
  // Consumidores esperados: la fila "Actualizaciones" del /profile — el
  // usuario tapea, la vista muestra feedback inline según el resultado.
  async checkForUpdateNow(): Promise<boolean> {
    if (!this.swUpdate.isEnabled) return false;
    try {
      const found = await this.swUpdate.checkForUpdate();
      this.lastCheckTimestamp = Date.now();
      return found;
    } catch (error) {
      console.warn('PwaUpdate: manual checkForUpdate failed', error);
      return false;
    }
  }

  async applyUpdate(): Promise<void> {
    if (this.applying) return;
    this.applying = true;
    try {
      await this.swUpdate.activateUpdate();
      // Reload limpia el contexto; `applying` no se restaura porque la app se
      // reinicia. Si activateUpdate resuelve pero reload falla (raro), el
      // banner sigue visible y el alumno puede reintentar.
      document.location.reload();
    } catch (error) {
      console.warn('PwaUpdate: activation failed', error);
      this.applying = false;
    }
  }

  private evaluateGating(): void {
    if (this.latchedUpdate === null) {
      this.pendingUpdate.set(EMPTY_PENDING_UPDATE);
      return;
    }
    const inExam = this.router.url.startsWith('/simulacro/');
    this.pendingUpdate.set({ ...this.latchedUpdate, available: !inExam });
  }
}

// Lee `appData.version` de manera defensiva. Las versiones legacy (anteriores
// a este change) NO tienen `appData` en el `ngsw.json`, así que cae al
// fallback em dash en lugar de propagar `undefined` a la UI.
function readAppDataVersion(version: { appData?: unknown }): string {
  const appData = version.appData;
  if (
    appData &&
    typeof appData === 'object' &&
    'version' in appData &&
    typeof (appData as { version: unknown }).version === 'string' &&
    (appData as { version: string }).version.length > 0
  ) {
    return (appData as { version: string }).version;
  }
  return VERSION_FALLBACK;
}
