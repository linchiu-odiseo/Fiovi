import { Clock } from '../../L1_domain/ports/clock';
import {
  TutorNavigationApi,
  type ExamsEnCursoResult,
} from '../../L1_domain/ports/tutor-navigation-api';

// Trae los exámenes actualmente in_progress del tutor logueado (a través de
// TODAS sus aulas). Ancla el `Clock` con el serverTime — crítico acá porque
// las cards muestran countdown local basado en startedAt + duration y ese
// countdown debe derivar del reloj server-anchored, no del reloj local.
//
// Reemplaza el filtro client-side sobre /tutor/virtual-exams que hacía el
// home hoy. Payload acotado (~0-10 items). El view-model del home lo consume
// tanto para pintar la sección "Exámenes en curso" como para derivar el
// badge "N en curso" por card de aula (agrupamiento client-side por
// classroomId).
export class GetExamsEnCursoUseCase {
  constructor(
    private readonly api: TutorNavigationApi,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<ExamsEnCursoResult> {
    const result = await this.api.getExamsEnCurso();
    this.clock.setServerTime(result.serverTime);
    return result;
  }
}
