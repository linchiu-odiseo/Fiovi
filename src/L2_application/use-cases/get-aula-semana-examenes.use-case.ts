import { Clock } from '../../L1_domain/ports/clock';
import {
  TutorNavigationApi,
  type AulaSemanaExamenesResult,
} from '../../L1_domain/ports/tutor-navigation-api';

// Lee los exámenes de una (aula × semana) agrupados por curso (nivel 3 del
// nav mobile). Ancla el `Clock` con el serverTime del response. El backend
// garantiza que period_id pertenece al ciclo del classroom_id — cross-cycle
// devuelve 404, no empty.
export class GetAulaSemanaExamenesUseCase {
  constructor(
    private readonly api: TutorNavigationApi,
    private readonly clock: Clock,
  ) {}

  async execute(classroomId: string, periodId: string): Promise<AulaSemanaExamenesResult> {
    const result = await this.api.getAulaSemanaExamenes(classroomId, periodId);
    this.clock.setServerTime(result.serverTime);
    return result;
  }
}
