import { Component, DestroyRef, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TutorExamDetailViewModel } from '../../view-models/tutor-exam-detail.view-model';
import { ClassroomStudent } from '../../../L1_domain/value-objects/classroom-student';
import { ExamServerStatusValue } from '../../../L1_domain/value-objects/exam-server-status';
import { TutorExamDetail } from '../../../L1_domain/value-objects/tutor-exam-detail';

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
    // El VM arranca un ticker de countdown de 1s cuando el examen está
    // in_progress (para refrescar `nowTick`). `stop()` cancela el interval
    // al destruir la page — sin esto quedaría un leak tras navegar.
    this.destroyRef.onDestroy(() => this.vm.stop());
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
    // Abre el modal en vez de disparar el iniciar directo, para que el tutor
    // pueda ajustar la duración antes de arrancar.
    this.vm.openIniciarModal();
  }

  protected onCancelIniciarModal(): void {
    this.vm.cancelIniciarModal();
  }

  protected onConfirmIniciarModal(): void {
    void this.vm.confirmIniciarModal();
  }

  protected onMinutesInput(event: Event): void {
    const parsed = this.parseIntInput(event);
    this.vm.pendingMinutes.set(parsed);
  }

  protected onSecondsInput(event: Event): void {
    const parsed = this.parseIntInput(event);
    this.vm.pendingSeconds.set(parsed);
  }

  // Etiqueta "mm:ss" del total en el resumen del modal.
  protected formatMmSs(totalSeconds: number | null): string {
    if (totalSeconds === null) return '—';
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  private parseIntInput(event: Event): number | null {
    const target = event.target as HTMLInputElement | null;
    if (!target) return null;
    const raw = target.value.trim();
    if (raw === '') return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return null;
    return parsed;
  }

  protected onFinalizar(): void {
    // Abre el modal de confirmación — cerrar antes de tiempo es irreversible.
    this.vm.openFinalizarModal();
  }

  protected onCancelFinalizarModal(): void {
    this.vm.cancelFinalizarModal();
  }

  protected onConfirmFinalizarModal(): void {
    void this.vm.confirmFinalizarModal();
  }

  protected onToggleStudent(studentId: string): void {
    void this.vm.toggleStudent(studentId);
  }

  protected onRetry(): void {
    void this.vm.retry();
  }

  // Duración en minutos redondeados — el back guarda segundos.
  protected durationMinutes(detail: TutorExamDetail): number {
    return Math.round(detail.duration / 60);
  }

  // Etiqueta de preguntas: "8 preguntas" o "Pendiente" cuando count es null.
  protected countLabel(detail: TutorExamDetail): string {
    if (detail.count === null) return 'Preguntas: pendientes';
    return `${detail.count} preguntas`;
  }

  // Fecha compacta es-PE: 10/07/2026 14:32 — sin dependencias externas.
  protected formatDateTime(date: Date): string {
    return `${this.formatDate(date)} ${this.formatTime(date)}`;
  }

  // Solo fecha (dd/mm/yyyy) — el cajetín las separa en celdas propias.
  protected formatDate(date: Date): string {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  // Solo hora (HH:mm).
  protected formatTime(date: Date): string {
    const hh = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    return `${hh}:${mi}`;
  }
}
