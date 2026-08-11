// Flag persistente que indica "esta instalación de Fiovi ya migró al modo
// cookie-separada (learnex_pwa_*)". Se prende tras el primer login/SSO exitoso
// con el build post-migración; nunca se apaga (no hay endpoint para volver al
// modo tenant).
//
// Sesiones pre-migración (usuarios que ya tenían sesión activa cuando el build
// nuevo llegó) quedan con flag=false y siguen usando cookies `learnex_tenant_*`
// como antes — el interceptor NO agrega el header `X-Client-App: pwa`, el
// backend usa el kind por defecto (`tenant`) y todo funciona sin deslogueo.
//
// El flag solo se enciende sobre auth exitosa (Identity retornada, no
// SelectionChallenge). Si un login falla, el flag NO se enciende — así un user
// pre-migración que intente re-loguearse y equivoque la clave no pierde su
// sesión vieja tenant.
//
// Sync porque el interceptor HTTP lo consulta en cada request al `apiBaseUrl`;
// async agregaría cost sin motivo (el adapter lee localStorage, que es sync).
export interface PwaCookieModeStore {
  isEnabled(): boolean;
  enable(): void;
}
