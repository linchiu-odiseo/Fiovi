import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { GetTutorExamsUseCase } from '../../L2_application/use-cases/get-tutor-exams.use-case';
import { TutorExam } from '../../L1_domain/entities/tutor-exam';
import { NetworkError } from '../../L1_domain/errors/network.error';
import { TutorExamForbiddenError } from '../../L1_domain/errors/tutor-exam-forbidden.error';

// View-model de /tutor/actividad. Provider-local — cada montaje arranca
// limpio, sin timers propios.
//
// El listado sale 100% del back: `GetTutorExamsUseCase` devuelve todos los
// virtual-exams no-archivados del tutor. Acá filtramos por `estaFinalizado()`
// para mostrar sólo los que ya cerraron. Cuando el back archive a las 00 hs,
// desaparecen naturalmente sin storage local que sincronizar.
@Injectable()
export class TutorActividadListViewModel {
  private readonly getTutorExams = inject(GetTutorExamsUseCase);
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
      const all = await this.getTutorExams.execute();
      const finalized = all.filter((exam) => exam.estaFinalizado()).sort(byMostRecentFirst);
      this.events.set(finalized);
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

// Ordena por hora de finalización descendente (más recientes primero).
// Fallback a `scheduled` si `finishedAt` es null (defensa — no debería
// pasar para exámenes finalizados, pero evita NaN en el sort).
function byMostRecentFirst(a: TutorExam, b: TutorExam): number {
  const ta = (a.finishedAt ?? a.scheduled).getTime();
  const tb = (b.finishedAt ?? b.scheduled).getTime();
  return tb - ta;
}
