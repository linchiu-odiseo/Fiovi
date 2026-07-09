import { Component, DestroyRef, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TutorExamDetailViewModel } from '../../view-models/tutor-exam-detail.view-model';
import { ClassroomStudent } from '../../../L1_domain/value-objects/classroom-student';
import { ExamServerStatusValue } from '../../../L1_domain/value-objects/exam-server-status';

// Pantalla de gestión del examen virtual del tutor (/tutor/exams/:recordId).
// El VM se provee localmente — cada montaje arranca limpio la secuencia D1.
// Ver diseño D4 (routing), D5 (UI guards), D6 (path).
@Component({
  selector: 'app-tutor-exam-detail-page',
  templateUrl: './tutor-exam-detail.page.html',
  styleUrl: './tutor-exam-detail.page.scss',
  providers: [TutorExamDetailViewModel],
})
export class TutorExamDetailPage {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly vm = inject(TutorExamDetailViewModel);

  constructor() {
    void this.vm.load();
    // La carga no tiene cleanup (online-only, D3) pero si el componente se
    // destruye antes de resolverse, la Promise simplemente queda sin efecto.
    this.destroyRef.onDestroy(() => {
      // No hay timers ni listeners en el detail VM (a diferencia del list VM).
    });
  }

  // Volver a /tutor/home usando Router.navigate — robusto para deep-links e
  // iOS standalone PWA donde no hay historial de navegación previo ni gesto
  // del sistema para volver. NO usar history.back().
  onVolver(): void {
    void this.router.navigate(['/tutor/home']);
  }

  // Mapa de estado del backend → chip visible en la UI. Mismo patrón que
  // `statusLabel(exam)` en el listado. Vive en el page component (no en el
  // VM) porque es puramente presentación es-PE + clase CSS: no es orquestación
  // ni dominio, y colocarlo en L2/VM crearía un DTO de presentación que
  // rompería la separación de capas.
  protected statusChip(status: ExamServerStatusValue): { label: string; modifier: string } {
    switch (status) {
      case 'scheduled':
        return { label: 'Programado', modifier: 'scheduled' };
      case 'in_progress':
        return { label: 'En curso', modifier: 'in-progress' };
      case 'finalized':
        return { label: 'Finalizado', modifier: 'finalized' };
    }
  }

  // Proxy a vm para que el template acceda a los guards sin llamar vm.vm.canIniciar().
  protected canIniciar(): boolean {
    return this.vm.canIniciar();
  }

  protected canFinalizar(): boolean {
    return this.vm.canFinalizar();
  }

  protected isCheckboxDisabled(student: ClassroomStudent): boolean {
    return this.vm.isCheckboxDisabled(student);
  }

  protected isStudentEnabled(studentId: string): boolean {
    return this.vm.enabledStudentIds().includes(studentId);
  }

  protected onIniciar(): void {
    void this.vm.iniciar();
  }

  protected onFinalizar(): void {
    void this.vm.finalizar();
  }

  protected onToggleStudent(studentId: string): void {
    void this.vm.toggleStudent(studentId);
  }

  protected onRetry(): void {
    void this.vm.retry();
  }
}
