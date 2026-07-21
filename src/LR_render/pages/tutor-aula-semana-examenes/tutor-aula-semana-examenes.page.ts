import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TutorAulaSemanaExamenesViewModel } from '../../view-models/tutor-aula-semana-examenes.view-model';
import { TutorExam } from '../../../L1_domain/entities/tutor-exam';
import { ExamServerStatusValue } from '../../../L1_domain/value-objects/exam-server-status';

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
