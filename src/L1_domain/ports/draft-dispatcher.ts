// Port L1 mínimo para que el LogoutUseCase (L2) pueda pedirle al dispatcher
// que limpie su state interno sin depender de la implementación concreta L3.
//
// El dispatcher real (`DraftAutoSaveDispatcher`) mantiene un `state Map` por
// sessionId que sobrevive entre sesiones porque el servicio es singleton
// (providedIn: 'root'). Si un draft queda con `stopped=true` porque el POST
// falló durante un logout (identity limpia → SessionExpiredError),
// notificarCambio() del próximo alumno encuentra ese stopped=true y NO
// dispara drafts nunca más para ese examen. wipeAll() cierra ese hueco.
//
// El Noop dispatcher lo implementa como no-op (nada que limpiar cuando el
// draft está apagado por env).
export interface DraftDispatcher {
  wipeAll(): void;
}
