import { Component, DestroyRef, inject } from '@angular/core';
import { Router } from '@angular/router';
import { StudentHistorialListViewModel } from '../../view-models/student-historial-list.view-model';
import { HistorialEntry } from '../../../L2_application/use-cases/get-historial.use-case';

@Component({
  selector: 'app-student-historial-list-page',
  templateUrl: './student-historial-list.page.html',
  styleUrl: './student-historial-list.page.scss',
  providers: [StudentHistorialListViewModel],
})
export class StudentHistorialListPage {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly vm = inject(StudentHistorialListViewModel);

  constructor() {
    void this.vm.start();
    this.destroyRef.onDestroy(() => {
      /* noop — el VM no tiene timers */
    });
  }

  protected onBack(): void {
    void this.router.navigate(['/profile']);
  }

  protected onEntryClick(entry: HistorialEntry): void {
    this.vm.goToDetail(entry.examId);
  }

  // Formatea la fecha del envío como "28 jul · 14:32". Reutiliza el patrón
  // de student-tasks-list.page.ts (sin Intl para no traer polyfills).
  protected formatFecha(date: Date): string {
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

  // Hash truncado para preview: primeros 8 chars ~ suficiente para reconocer
  // sin ocupar 64 chars en la lista. El detalle muestra el hash completo.
  protected shortHash(hash: string): string {
    return hash.slice(0, 8) + '…';
  }
}
