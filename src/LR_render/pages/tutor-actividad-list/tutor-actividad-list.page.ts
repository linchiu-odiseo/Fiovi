import { Component, DestroyRef, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TutorActividadListViewModel } from '../../view-models/tutor-actividad-list.view-model';
import { TutorActivityEvent } from '../../../L1_domain/value-objects/tutor-activity-event';

@Component({
  selector: 'app-tutor-actividad-list-page',
  templateUrl: './tutor-actividad-list.page.html',
  styleUrl: './tutor-actividad-list.page.scss',
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

  protected onCardClick(event: TutorActivityEvent): void {
    this.vm.goToExam(event);
  }

  protected onArchive(event: TutorActivityEvent, mouseEvent: Event): void {
    mouseEvent.stopPropagation();
    void this.vm.archive(event);
  }

  protected formatFecha(date: Date): string {
    const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const dd = date.getDate();
    const mm = months[date.getMonth()];
    const hh = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    return `${dd} ${mm} · ${hh}:${mi}`;
  }
}
