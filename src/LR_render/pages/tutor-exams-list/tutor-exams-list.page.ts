import { Component, DestroyRef, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TutorExamsListViewModel } from '../../view-models/tutor-exams-list.view-model';
import { ExamEnCurso } from '../../../L1_domain/entities/exam-en-curso';
import { PwaUpdateService } from '../../../L3_periphery/pwa/pwa-update.service';
import { UpdateBannerComponent } from '../../components/update-banner/update-banner.component';
import { UpdateConfirmModalComponent } from '../../components/update-confirm-modal/update-confirm-modal.component';
import { VersionFooterComponent } from '../../components/version-footer/version-footer.component';

// Home del tutor en /tutor/home. Muestra las aulas asignadas + una lista
// corta de exámenes actualmente in_progress (via /tutor/exams/en-curso).
// Al tocar una aula se navega al nivel de semanas (AULA → SEMANA → CURSO →
// EXÁMENES).
@Component({
  selector: 'app-tutor-exams-list-page',
  templateUrl: './tutor-exams-list.page.html',
  styleUrl: './tutor-exams-list.page.scss',
  imports: [UpdateBannerComponent, UpdateConfirmModalComponent, VersionFooterComponent],
  providers: [TutorExamsListViewModel],
})
export class TutorExamsListPage {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly vm = inject(TutorExamsListViewModel);
  protected readonly pwa = inject(PwaUpdateService);

  protected readonly showConfirmModal = signal(false);

  constructor() {
    void this.vm.start();
    this.destroyRef.onDestroy(() => this.vm.stop());
  }

  protected onBannerTap(): void {
    this.showConfirmModal.set(true);
  }

  protected onModalCancel(): void {
    this.showConfirmModal.set(false);
  }

  protected onModalConfirm(): void {
    void this.pwa.applyUpdate();
  }

  protected onExamCardClick(exam: ExamEnCurso): void {
    void this.router.navigate(['/tutor/exams', exam.recordId]);
  }

  protected onClassroomClick(classroomId: string): void {
    void this.router.navigate(['/tutor/aulas', classroomId, 'semanas']);
  }

  /** Duración en minutos para display, coherente con TutorExam.durationInMinutes. */
  protected durationInMinutes(exam: ExamEnCurso): number {
    return Math.round(exam.duration / 60);
  }

  protected countDisplay(exam: ExamEnCurso): string {
    return exam.count === null ? '—' : String(exam.count);
  }

  protected onSignOut(): void {
    void this.vm.signOut();
  }
}
