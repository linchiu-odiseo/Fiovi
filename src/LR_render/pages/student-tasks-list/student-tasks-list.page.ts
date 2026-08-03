import { Component, DestroyRef, inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  StudentTasksListViewModel,
  TareaCard,
} from '../../view-models/student-tasks-list.view-model';

@Component({
  selector: 'app-student-tasks-list-page',
  templateUrl: './student-tasks-list.page.html',
  styleUrl: './student-tasks-list.page.scss',
  providers: [StudentTasksListViewModel],
})
export class StudentTasksListPage {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly vm = inject(StudentTasksListViewModel);

  constructor() {
    void this.vm.start();
    this.destroyRef.onDestroy(() => this.vm.stop());
  }

  protected onBack(): void {
    void this.router.navigate(['/student/home']);
  }

  protected onCardClick(card: TareaCard): void {
    if (!card.clickable) return;
    void this.router.navigate(['/student/simulacro', card.id]);
  }

  protected onRetry(): void {
    void this.vm.refresh();
  }

  // Formatea la fecha del deadline como "28 jul · 00:00" — evita depender de
  // Intl para no traer polyfills; el idioma es-PE es hardcoded en el resto
  // del proyecto (fase 1+).
  protected formatDeadline(date: Date): string {
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
