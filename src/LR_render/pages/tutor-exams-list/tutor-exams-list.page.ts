import { Component, DestroyRef, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TutorExamsListViewModel } from '../../view-models/tutor-exams-list.view-model';
import { ExamEnCurso } from '../../../L1_domain/entities/exam-en-curso';
import { VersionFooterComponent } from '../../components/version-footer/version-footer.component';

// Home del tutor en /tutor/home. Muestra las aulas asignadas + una lista
// corta de exámenes actualmente in_progress (via /tutor/exams/en-curso).
// Al tocar una aula se navega al nivel de semanas (AULA → SEMANA → CURSO →
// EXÁMENES).
@Component({
  selector: 'app-tutor-exams-list-page',
  templateUrl: './tutor-exams-list.page.html',
  styleUrl: './tutor-exams-list.page.scss',
  imports: [VersionFooterComponent],
  providers: [TutorExamsListViewModel],
})
export class TutorExamsListPage {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly vm = inject(TutorExamsListViewModel);

  constructor() {
    void this.vm.start();
    this.destroyRef.onDestroy(() => this.vm.stop());
  }

  protected onExamCardClick(exam: ExamEnCurso): void {
    void this.router.navigate(['/tutor/exams', exam.recordId]);
  }

  protected onClassroomClick(classroomId: string): void {
    void this.router.navigate(['/tutor/aulas', classroomId, 'semanas']);
  }

  protected onProfileClick(): void {
    void this.router.navigate(['/profile']);
  }

  /** Duración en minutos para display, coherente con TutorExam.durationInMinutes. */
  protected durationInMinutes(exam: ExamEnCurso): number {
    return Math.round(exam.duration / 60);
  }

  protected countDisplay(exam: ExamEnCurso): string {
    return exam.count === null ? '—' : String(exam.count);
  }
}
