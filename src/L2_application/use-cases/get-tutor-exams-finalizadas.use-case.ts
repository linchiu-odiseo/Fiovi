import { TutorExam } from '../../L1_domain/entities/tutor-exam';
import { TutorExamsApi } from '../../L1_domain/ports/tutor-exams-api';

// Lee la lista de virtual exams FINALIZADOS del tutor desde el endpoint
// dedicado `/tutor/exams/finalizadas`. Análogo a GetTutorExamsUseCase pero
// contra el endpoint chico (0-10 items típicos) — evita bajar el listado
// completo del tutor para mostrar el historial de /tutor/actividad.
//
// Online-only: sin outbox, sin IDB. Si la red falla, el error propaga tal
// cual al caller.
export class GetTutorExamsFinalizadasUseCase {
  constructor(private readonly api: TutorExamsApi) {}

  async execute(): Promise<readonly TutorExam[]> {
    return this.api.getExamsFinalizadas();
  }
}
