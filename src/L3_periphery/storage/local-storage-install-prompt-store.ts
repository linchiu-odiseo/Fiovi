import { Injectable } from '@angular/core';

import { InstallPromptStore } from '../../L1_domain/ports/install-prompt-store';

// Clave namespaceada `fiovi.install_prompt.*` para no colisionar con otras
// del proyecto (`fiovi.pwa_cookie_mode`). Cambiar el string requiere
// migración LEER-VIEJO/ESCRIBIR-NUEVO — sino se pierde el flag de todas
// las instalaciones vivas.
const STORAGE_KEY = 'fiovi.install_prompt.installed';
const INSTALLED_VALUE = '1';

@Injectable({ providedIn: 'root' })
export class LocalStorageInstallPromptStore implements InstallPromptStore {
  isMarkedInstalled(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY) === INSTALLED_VALUE;
    } catch {
      // localStorage bloqueado (Safari ITP, modo privado, iframe cross-origin).
      // Degradamos a false = el card sigue apareciendo. Peor caso: user que
      // ya instaló ve el card en visitas web posteriores; al abrir desde el
      // icono standalone el probe lo oculta igual.
      return false;
    }
  }

  markInstalled(): void {
    try {
      localStorage.setItem(STORAGE_KEY, INSTALLED_VALUE);
    } catch {
      // Si no persiste, el flag se pierde entre visitas. No crash.
    }
  }
}
