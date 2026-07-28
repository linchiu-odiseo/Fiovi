import { TutorActivityStorage } from '../../L1_domain/ports/tutor-activity-storage';
import { TutorActivityEvent } from '../../L1_domain/value-objects/tutor-activity-event';

// Registra un evento de "actividad reciente" del tutor. Se invoca desde el
// LR post-confirmación del back (200 OK de /finalize). Mantiene el use case
// desacoplado del `FinalizarExamenUseCase` — la responsabilidad del use case
// de finalize es solo hablar con el back; el registro es cosmético.
export class RegistrarActividadTutorUseCase {
  constructor(private readonly storage: TutorActivityStorage) {}

  async execute(event: TutorActivityEvent): Promise<void> {
    await this.storage.append(event);
  }
}
