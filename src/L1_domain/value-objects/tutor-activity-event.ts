// Evento del "historial de actividad" del tutor. Un registro por examen
// finalizado desde Fiovi (post-200 OK del back). El caso "activó" NO se
// registra por decisión de UX: la card muestra una fila por examen con la
// hora del finalizó — mostrar activación es ruido.
//
// `archived: true` marca la fila como oculta del listado. El registro
// persiste en IDB para no perder el evento (idempotencia por id), pero la
// vista lo excluye. Se limpia junto con el resto en `wipeUserScope()` durante
// logout.
export interface TutorActivityEvent {
  readonly id: string; // UUID del evento (generado en el LR al registrar)
  readonly recordId: string; // recordId del virtual-exam (destino del deep-link)
  readonly examName: string;
  readonly courseName: string | null;
  readonly finalizedAt: Date;
  readonly archived: boolean;
}
