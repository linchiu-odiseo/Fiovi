import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { GetTutorExamsFinalizadasUseCase } from '../../L2_application/use-cases/get-tutor-exams-finalizadas.use-case';
import { TutorExam } from '../../L1_domain/entities/tutor-exam';
import { NetworkError } from '../../L1_domain/errors/network.error';
import { TutorExamForbiddenError } from '../../L1_domain/errors/tutor-exam-forbidden.error';

// View-model de /tutor/actividad. Provider-local — cada montaje arranca
// limpio, sin timers propios.
//
// El listado sale del endpoint dedicado /tutor/exams/finalizadas — payload
// liviano (0-10 items post-archived 00h). Los items traen classroomName
// desde el DTO (no hace falta lookup en el profile). El back archiva a las
// 00h, entonces la lista se limpia sola sin storage local que sincronizar.
@Injectable()
export class TutorActividadListViewModel {
  private readonly getFinalizadas = inject(GetTutorExamsFinalizadasUseCase);
  private readonly router = inject(Router);

  readonly events = signal<readonly TutorExam[]>([]);
  readonly isLoading = signal(false);
  readonly loadError = signal(false);

  async start(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.isLoading.set(true);
    this.loadError.set(false);
    try {
      const items = await this.getFinalizadas.execute();
      const sorted = [...items].sort(byMostRecentFirst);
      this.events.set(sorted);
    } catch (err) {
      this.events.set([]);
      if (err instanceof NetworkError || err instanceof TutorExamForbiddenError) {
        this.loadError.set(true);
      } else {
        throw err;
      }
    } finally {
      this.isLoading.set(false);
    }
  }

  goToExam(exam: TutorExam): void {
    void this.router.navigate(['/tutor/exams', exam.recordId]);
  }
}

// Ordena por hora de finalización descendente. `finishedAt` viene non-null
// desde el endpoint dedicado, pero mantenemos el fallback defensivo por si
// el DTO cambia.
function byMostRecentFirst(a: TutorExam, b: TutorExam): number {
  const ta = (a.finishedAt ?? a.scheduled).getTime();
  const tb = (b.finishedAt ?? b.scheduled).getTime();
  return tb - ta;
}
