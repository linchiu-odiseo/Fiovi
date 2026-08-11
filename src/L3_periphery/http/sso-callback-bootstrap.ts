import { Injectable, inject } from '@angular/core';
import { ProcessSsoCallbackUseCase } from '../../L2_application/use-cases/process-sso-callback.use-case';
import { PWA_COOKIE_MODE_STORE } from '../tokens';
import { SlugStore } from './slug-store';

// Clave donde `SelectTenantPage` lee el challenge que el bootstrap guardó
// tras el callback SSO (caso >1 tenant). sessionStorage (no localStorage)
// porque el token JWT es efímero (5 min) y no queremos que sobreviva a un
// cierre accidental de tab.
export const FIOVI_PENDING_SELECTION_KEY = 'fiovi.pending_selection';

// SsoCallbackBootstrap — corre en `APP_INITIALIZER` antes que
// `InitializeSessionUseCase`. Interpreta los query params con los que el
// backend redirigió al PWA tras el callback SSO y prepara el estado para
// que el resto de la app arranque coherente.
//
// Efectos por caso:
//   - `auto` (`?slug=X`): hidrata SlugStore + limpia URL con replaceState.
//     `InitializeSessionUseCase` verá el slug y disparará `me()` para
//     hidratar la Identity contra las cookies HttpOnly ya seteadas.
//   - `selection` (`?selectionToken=&tenants=<b64>`): stashea el challenge en
//     sessionStorage bajo `FIOVI_PENDING_SELECTION_KEY` + limpia URL.
//     La `SelectTenantPage` lo lee y renderiza el selector.
//   - `error` (`?ssoError=X`): NO tocamos la URL — el query param queda
//     para que `LoginPage` lo lea del `ActivatedRoute.snapshot` y muestre
//     el banner mapeado.
//   - `none`: no-op.
//
// `history.replaceState` va antes de cualquier render del Router para que
// el token JWT no viva en el history del navegador ni en el Referer de
// requests siguientes.
@Injectable({ providedIn: 'root' })
export class SsoCallbackBootstrap {
  private readonly process = new ProcessSsoCallbackUseCase();
  private readonly slugStore = inject(SlugStore);
  private readonly pwaCookieMode = inject(PWA_COOKIE_MODE_STORE);

  run(): void {
    const outcome = this.process.execute(window.location.search);
    switch (outcome.kind) {
      case 'auto':
        this.slugStore.set(outcome.slug);
        // Backend seteó cookies `learnex_pwa_*` (el SSO start siempre manda
        // `?app=pwa` — ver api-paths.ts). Encendemos el flag para que
        // InitializeSessionUseCase (APP_INITIALIZER #1, corre justo después)
        // mande `X-Client-App: pwa` en el `me()` inicial y backend lea la
        // cookie correcta. Sin esto, /me buscaría learnex_tenant_access
        // (default) → 401 → refresh → 401 → logout inmediato.
        this.pwaCookieMode.enable();
        this.cleanUrl();
        return;
      case 'selection':
        sessionStorage.setItem(FIOVI_PENDING_SELECTION_KEY, JSON.stringify(outcome.challenge));
        this.cleanUrl();
        return;
      case 'error':
        // Preservamos ?ssoError=<code> — LoginPage lo lee del snapshot.
        return;
      case 'none':
        return;
    }
  }

  private cleanUrl(): void {
    // Preservamos el pathname (`/`, `/login/select-tenant`) — el Router lo
    // usa para resolver la ruta inicial. Solo tiramos los query params.
    window.history.replaceState({}, '', window.location.pathname);
  }
}
