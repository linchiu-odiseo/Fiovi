import { Component, DestroyRef, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { StudentHistorialDetailViewModel } from '../../view-models/student-historial-detail.view-model';

@Component({
  selector: 'app-student-historial-detail-page',
  templateUrl: './student-historial-detail.page.html',
  styleUrl: './student-historial-detail.page.scss',
  providers: [StudentHistorialDetailViewModel],
})
export class StudentHistorialDetailPage {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly vm = inject(StudentHistorialDetailViewModel);

  constructor() {
    const examId = this.route.snapshot.paramMap.get('examId');
    if (examId === null) {
      void this.router.navigate(['/student/historial']);
      return;
    }
    void this.vm.start(examId);
    this.destroyRef.onDestroy(() => {
      /* noop */
    });
  }

  protected onBack(): void {
    void this.router.navigate(['/student/historial']);
  }

  // Formatea fecha "28 jul · 14:32". Reusa patrón de la lista.
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

  protected async onCopyHash(): Promise<void> {
    const d = this.vm.detalle();
    if (!d?.ack) return;
    try {
      await navigator.clipboard.writeText(d.ack.submissionHash);
    } catch {
      // Sin clipboard (browser viejo o permiso denegado): no-op silencioso.
      // El hash sigue visible en pantalla para que el user lo copie a mano.
    }
  }
}
