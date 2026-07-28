import { TutorActivityStorage } from '../../L1_domain/ports/tutor-activity-storage';

// Marca un evento como archivado. La fila desaparece del listado (que filtra
// archived === false) pero el registro persiste en IDB hasta el logout —
// permite futuras vistas de historial si el requerimiento cambia sin perder
// el dato.
export class ArchivarActividadTutorUseCase {
  constructor(private readonly storage: TutorActivityStorage) {}

  async execute(eventId: string): Promise<void> {
    await this.storage.archive(eventId);
  }
}
