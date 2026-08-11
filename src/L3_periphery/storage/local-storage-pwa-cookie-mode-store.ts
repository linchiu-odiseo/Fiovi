import { Injectable } from '@angular/core';
import { PwaCookieModeStore } from '../../L1_domain/ports/pwa-cookie-mode-store';

// Clave y valor son deliberadamente estables — si un futuro release cambia el
// contrato, migrar via LEER-VIEJO/ESCRIBIR-NUEVO en el próprio adapter (nunca
// romper flags de installs vivas: eso disparaba re-logins masivos, que es
// exactamente lo que este flag existe para evitar).
const STORAGE_KEY = 'fiovi.pwa_cookie_mode';
const ENABLED_VALUE = '1';

@Injectable({ providedIn: 'root' })
export class LocalStoragePwaCookieModeStore implements PwaCookieModeStore {
  isEnabled(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY) === ENABLED_VALUE;
    } catch {
      // localStorage tira en modo privado bloqueado por policy del browser
      // (Safari ITP en algunas configuraciones, iframes cross-origin, etc.).
      // Degradamos a false = comportamiento pre-migración: sin header, backend
      // usa cookies tenant. Peor caso el user queda con el bug de "1 sesión por
      // browser" hasta que localStorage vuelva a funcionar; nunca deslogueo.
      return false;
    }
  }

  enable(): void {
    try {
      localStorage.setItem(STORAGE_KEY, ENABLED_VALUE);
    } catch {
      // Idem: si no podemos persistir, seguimos en modo legacy para esta
      // sesión y el próximo login re-intentará habilitar. Nunca crash.
    }
  }
}
