import { Component, DestroyRef, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TareaTutorCard, TutorTasksListViewModel } from '../../view-models/tutor-tasks-list.view-model';

@Component({
  selector: 'app-tutor-tasks-list-page',
  templateUrl: './tutor-tasks-list.page.html',
  styleUrl: './tutor-tasks-list.page.scss',
  providers: [TutorTasksListViewModel],
})
export class TutorTasksListPage {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly vm = inject(TutorTasksListViewModel);

  constructor() {
    void this.vm.start();
    this.destroyRef.onDestroy(() => this.vm.stop());
  }

  protected onBack(): void {
    void this.router.navigate(['/tutor/home']);
  }

  protected onCardClick(card: TareaTutorCard): void {
    void this.router.navigate(['/tutor/exams', card.recordId]);
  }

  protected onRetry(): void {
    void this.vm.refresh();
  }

  // Fecha absoluta compacta es-PE ("28 jul · 00:00").
  protected formatDeadline(date: Date): string {
    const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const dd = date.getDate();
    const mm = months[date.getMonth()];
    const hh = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    return `${dd} ${mm} · ${hh}:${mi}`;
  }
}
