import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TutorAulaSemanaExamenesViewModel } from '../../view-models/tutor-aula-semana-examenes.view-model';
import { TutorExam } from '../../../L1_domain/entities/tutor-exam';
import { AulaSemanaExamGrupo } from '../../../L1_domain/entities/aula-semana-exam-grupo';
import { ExamServerStatusValue } from '../../../L1_domain/value-objects/exam-server-status';

interface StatusCounts {
  readonly scheduled: number;
  readonly in_progress: number;
  readonly finalized: number;
}

// Pantalla /tutor/aulas/:classroomId/semanas/:periodId — nivel 3 del nav.
// Muestra los exámenes de la semana ya agrupados por curso. Cada card de
// curso expande sus exámenes inline (sin request adicional al hacer tap).
@Component({
  selector: 'app-tutor-aula-semana-examenes-page',
  templateUrl: './tutor-aula-semana-examenes.page.html',
  styleUrl: './tutor-aula-semana-examenes.page.scss',
  providers: [TutorAulaSemanaExamenesViewModel],
})
export class TutorAulaSemanaExamenesPage {
  protected readonly vm = inject(TutorAulaSemanaExamenesViewModel);
  private readonly router = inject(Router);

  constructor() {
    void this.vm.load();
  }

  protected onVolver(): void {
    this.vm.goBack();
  }

  protected onRetry(): void {
    void this.vm.load();
  }

  protected onExamClick(exam: TutorExam): void {
    void this.router.navigate(['/tutor/exams', exam.recordId]);
  }

  protected onCourseClick(grupo: AulaSemanaExamGrupo): void {
    this.vm.toggleCourse(grupo);
  }

  /**
   * Cuenta los exámenes de un grupo por status. Alimenta las pills del header
   * del acordeón — cero JS extra en el hot path porque el grupo tiene ≤4
   * items (fichas EXFE/EXF1/EXF2/EXF3).
   */
  protected statusCounts(grupo: AulaSemanaExamGrupo): StatusCounts {
    let scheduled = 0;
    let inProgress = 0;
    let finalized = 0;
    for (const exam of grupo.examenes) {
      const s = exam.serverStatus.value;
      if (s === 'scheduled') scheduled++;
      else if (s === 'in_progress') inProgress++;
      else if (s === 'finalized') finalized++;
    }
    return { scheduled, in_progress: inProgress, finalized };
  }

  protected statusLabel(exam: TutorExam): string {
    return this.mapStatus(exam.serverStatus.value).label;
  }

  protected statusModifier(exam: TutorExam): string {
    return this.mapStatus(exam.serverStatus.value).modifier;
  }

  protected countDisplay(exam: TutorExam): string {
    return exam.count === null ? '—' : String(exam.count);
  }

  private mapStatus(status: ExamServerStatusValue): { label: string; modifier: string } {
    switch (status) {
      case 'scheduled':
        return { label: 'Programado', modifier: 'scheduled' };
      case 'in_progress':
        return { label: 'En curso', modifier: 'in-progress' };
      case 'finalized':
        return { label: 'Finalizado', modifier: 'finalized' };
    }
  }
}
