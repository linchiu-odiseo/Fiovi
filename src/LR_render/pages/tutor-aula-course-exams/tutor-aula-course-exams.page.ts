import { Component, inject } from '@angular/core';
import { TutorAulaCourseExamsViewModel } from '../../view-models/tutor-aula-course-exams.view-model';
import { TutorExam } from '../../../L1_domain/entities/tutor-exam';
import { ExamServerStatusValue } from '../../../L1_domain/value-objects/exam-server-status';

@Component({
  selector: 'app-tutor-aula-course-exams-page',
  templateUrl: './tutor-aula-course-exams.page.html',
  styleUrl: './tutor-aula-course-exams.page.scss',
  providers: [TutorAulaCourseExamsViewModel],
})
export class TutorAulaCourseExamsPage {
  protected readonly vm = inject(TutorAulaCourseExamsViewModel);

  constructor() {
    void this.vm.load();
  }

  protected onVolver(): void {
    this.vm.goBack();
  }

  protected onExamClick(exam: TutorExam): void {
    this.vm.goToExam(exam);
  }

  protected onRetry(): void {
    void this.vm.load();
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
