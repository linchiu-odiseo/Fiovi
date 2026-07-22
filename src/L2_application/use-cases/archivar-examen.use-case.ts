import { TutorExamsApi } from '../../L1_domain/ports/tutor-exams-api';

// Archiva un virtual exam (finalized → archived). Transición irreversible
// desde la perspectiva del tutor: el examen deja de aparecer en la lista.
// Online-only (D3): no hay outbox.
export class ArchivarExamenUseCase {
  constructor(private readonly api: TutorExamsApi) {}

  async execute(req: { recordId: string }): Promise<void> {
    await this.api.archivar(req.recordId);
  }
}
