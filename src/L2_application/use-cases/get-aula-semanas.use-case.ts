import { Clock } from '../../L1_domain/ports/clock';
import {
  TutorNavigationApi,
  type AulaSemanasResult,
} from '../../L1_domain/ports/tutor-navigation-api';

// Lee las semanas del ciclo del aula desde learnex y, como side-effect,
// ancla el `Clock` con el `serverTime` reportado por el backend. Mismo
// patrón que GetTodaysExamsUseCase (student side).
//
// Online-only: no hay outbox ni IDB. Errores de red se propagan al VM.
export class GetAulaSemanasUseCase {
  constructor(
    private readonly api: TutorNavigationApi,
    private readonly clock: Clock,
  ) {}

  async execute(classroomId: string): Promise<AulaSemanasResult> {
    const result = await this.api.getAulaSemanas(classroomId);
    this.clock.setServerTime(result.serverTime);
    return result;
  }
}
