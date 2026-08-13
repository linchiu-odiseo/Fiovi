// Wrapper del evento `beforeinstallprompt` de Chromium. Existe SOLO en
// Android Chrome/Edge/Samsung Internet y desktop Chromium — iOS y Firefox
// NO lo disparan nunca. Los use cases lo consultan vía este port sin
// acoplarse al evento crudo del browser.
//
// El evento se dispara cuando Chrome decide que la app es installable
// (manifest válido + SW registrado + engagement heuristics). Puede tardar
// segundos y NO es determinístico — por eso el adapter mantiene el estado
// latched. `isAvailable()` es sync: el use case pregunta en cada tick;
// si aún no llegó, devuelve `false` y el card cae a otro modo (o queda
// hidden si no hay alternativa).
//
// `trigger()` es async — abre el diálogo nativo del browser y espera la
// respuesta del user. Resuelve con:
//   - 'accepted': el user tocó "Instalar" en el diálogo nativo.
//   - 'dismissed': el user cerró el diálogo sin instalar.
//   - 'unavailable': el evento no estaba capturado (safety guard; el
//     view-model debería no llamar `trigger()` si `isAvailable()` fue
//     `false`, pero el race window entre ambos hace que este caso valga).
//
// El adapter L3 puede exponer superficie extra (ej. Signal reactive) que
// esta interface deliberadamente NO tiene: L1 no puede depender de
// @angular/core.
export type NativeInstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

export interface NativeInstallPrompt {
  isAvailable(): boolean;
  trigger(): Promise<NativeInstallOutcome>;
}
