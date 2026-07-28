import { TutorActivityEvent } from '../value-objects/tutor-activity-event';

// Puerto para el "historial de actividad" del tutor (Item 4 del refine).
//
// Persistencia local en IDB, mismo scope de wipe que MarkingsStorage: se
// borra en `LogoutUseCase` junto con el resto. Sin cross-device. Sin back.
//
// `append` es idempotente por `event.id` — segundo write con el mismo id es
// no-op. Esto permite que el LR use un id derivado del `recordId` (o un
// UUID sync) sin miedo a duplicados por double-tap.
//
// `list` retorna TODOS los eventos (incluye archivados). El use case filtra.
//
// `archive` marca el flag; NO borra la fila. Elección del user: "1.A —
// archivados desaparecen del listado, sin vista de archivados". El registro
// queda hasta el próximo logout.
//
// `wipeUserScope` sin argumento — el adapter lee IdentityStorage
// internamente, igual pattern que MarkingsStorage.
export interface TutorActivityStorage {
  append(event: TutorActivityEvent): Promise<void>;
  list(): Promise<TutorActivityEvent[]>;
  archive(eventId: string): Promise<void>;
  wipeUserScope(): Promise<void>;
}
