import { TutorActivityStorage } from '../../L1_domain/ports/tutor-activity-storage';
import { TutorActivityEvent } from '../../L1_domain/value-objects/tutor-activity-event';

// Retorna eventos NO archivados, ordenados por finalizedAt desc (más reciente
// primero). Los archivados se ignoran — decisión "1.A" del user: no hay vista
// de archivados. Si querés incluirlos, es un flag futuro.
export class GetActividadTutorUseCase {
  constructor(private readonly storage: TutorActivityStorage) {}

  async execute(): Promise<TutorActivityEvent[]> {
    const all = await this.storage.list();
    return all
      .filter((e) => !e.archived)
      .sort((a, b) => b.finalizedAt.getTime() - a.finalizedAt.getTime());
  }
}
