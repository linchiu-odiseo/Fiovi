import { TutorExamsApi } from '../../L1_domain/ports/tutor-exams-api';

// Reconcilia la lista de alumnos habilitados de un virtual exam con las
// matrículas actuales del aula (scheduled → in_progress gate).
// Online-only: sin outbox, sin IndexedDB, sin ACKs. Todos los errores del
// puerto se propagan sin transformacion — el VM los clasifica con instanceof.
// Patron calcado de IniciarExamenUseCase (28 LOC) — ver design.md D3.
export class RefreshHabilitadosUseCase {
  constructor(private readonly api: TutorExamsApi) {}

  execute(recordId: string): Promise<{ addedCount: number; totalEnabledCount: number }> {
    return this.api.refreshEnabled(recordId);
  }
}
