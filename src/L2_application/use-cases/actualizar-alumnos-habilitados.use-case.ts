import { TutorExamsApi } from '../../L1_domain/ports/tutor-exams-api';

// Actualiza el set de alumnos habilitados para rendir el virtual exam.
// Online-only (D3): el backend es la fuente de verdad. Un error de red
// se propaga al VM que revierte el estado local (D5 optimistic-ish rollback).
export class ActualizarAlumnosHabilitadosUseCase {
  constructor(private readonly api: TutorExamsApi) {}

  async execute(req: { recordId: string; enabledStudentIds: readonly string[] }): Promise<void> {
    return this.api.updateEnabledStudents(req);
  }
}
