import { Component, DestroyRef, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TutorActividadListViewModel } from '../../view-models/tutor-actividad-list.view-model';
import { TutorExam } from '../../../L1_domain/entities/tutor-exam';
import { SwipeableCardComponent } from '../../components/swipeable-card/swipeable-card.component';

@Component({
  selector: 'app-tutor-actividad-list-page',
  templateUrl: './tutor-actividad-list.page.html',
  styleUrl: './tutor-actividad-list.page.scss',
  imports: [SwipeableCardComponent],
  providers: [TutorActividadListViewModel],
})
export class TutorActividadListPage {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly vm = inject(TutorActividadListViewModel);

  constructor() {
    void this.vm.start();
    this.destroyRef.onDestroy(() => {
      /* noop */
    });
  }

  protected onBack(): void {
    void this.router.navigate(['/profile']);
  }

  protected onCardClick(exam: TutorExam): void {
    this.vm.goToExam(exam);
  }

  protected onArchive(recordId: string): void {
    void this.vm.archivar(recordId);
  }

  protected onDismissArchiveError(): void {
    this.vm.dismissArchiveError();
  }

  protected formatFecha(date: Date | null): string {
    if (date === null) return '—';
    const months = [
      'ene',
      'feb',
      'mar',
      'abr',
      'may',
      'jun',
      'jul',
      'ago',
      'sep',
      'oct',
      'nov',
      'dic',
    ];
    const dd = date.getDate();
    const mm = months[date.getMonth()];
    const hh = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    return `${dd} ${mm} · ${hh}:${mi}`;
  }
}
