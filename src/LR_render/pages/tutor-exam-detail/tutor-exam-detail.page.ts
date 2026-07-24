import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { TutorExamDetailViewModel } from '../../view-models/tutor-exam-detail.view-model';
import { ClassroomStudent } from '../../../L1_domain/value-objects/classroom-student';
import { ExamServerStatusValue } from '../../../L1_domain/value-objects/exam-server-status';
import { TutorExamDetail } from '../../../L1_domain/value-objects/tutor-exam-detail';
import { HWheelComponent, HWheelItem } from '../../components/h-wheel/h-wheel.component';

// Etiquetas cortas de día de semana en es-PE para los chips de la rueda
// horizontal de días. Domingo = 0, siguiendo el índice nativo de Date.
const DOW_LABELS = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];

// Pantalla de gestión del examen virtual del tutor (/tutor/exams/:recordId).
// El VM se provee localmente — cada montaje arranca limpio la secuencia D1.
// Ver diseño D4 (routing), D5 (UI guards), D6 (path).
@Component({
  selector: 'app-tutor-exam-detail-page',
  templateUrl: './tutor-exam-detail.page.html',
  styleUrl: './tutor-exam-detail.page.scss',
  providers: [TutorExamDetailViewModel],
  imports: [HWheelComponent],
})
export class TutorExamDetailPage {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly vm = inject(TutorExamDetailViewModel);

  /**
   * Items de la rueda de días: HOY, MAÑ, y luego día_de_semana + número.
   * Se rebuildea reactivo — Date.now() se lee al leer el computed, así que
   * al abrir el modal siempre son los días desde HOY. IDs son offsets
   * numéricos (0..MAX) como strings.
   */
  protected readonly dayChips = computed<readonly HWheelItem[]>(() => {
    const items: HWheelItem[] = [];
    const now = new Date();
    const max = TutorExamDetailViewModel.HOMEWORK_MAX_DAY_OFFSET;
    for (let offset = 0; offset <= max; offset++) {
      const d = new Date(now);
      d.setDate(d.getDate() + offset);
      let top: string;
      if (offset === 0) top = 'HOY';
      else if (offset === 1) top = 'MAÑ';
      else top = DOW_LABELS[d.getDay()]!;
      items.push({ id: String(offset), top, bottom: String(d.getDate()) });
    }
    return items;
  });

  /** Items de la rueda de horas: 1..23 (sin minutos, sin 0/24). */
  protected readonly hourChips = computed<readonly HWheelItem[]>(() => {
    const items: HWheelItem[] = [];
    for (let h = 1; h <= 23; h++) {
      items.push({ id: String(h), bottom: `${String(h).padStart(2, '0')}h` });
    }
    return items;
  });

  /** Bridges signal ↔ string entre VM (number) y componente rueda (string). */
  protected readonly selectedDayId = computed<string | null>(() => {
    const v = this.vm.pendingDeadlineDayOffset();
    return v === null ? null : String(v);
  });
  protected readonly selectedHourId = computed<string | null>(() => {
    const v = this.vm.pendingDeadlineHour();
    return v === null ? null : String(v);
  });

  protected onDayIdChange(id: string | null): void {
    if (id === null) return;
    const n = Number(id);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return;
    this.vm.pendingDeadlineDayOffset.set(n);
    if (this.vm.openUntilError() !== null) this.vm.openUntilError.set(null);
  }

  protected onHourIdChange(id: string | null): void {
    if (id === null) return;
    const n = Number(id);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return;
    this.vm.pendingDeadlineHour.set(n);
    if (this.vm.openUntilError() !== null) this.vm.openUntilError.set(null);
  }

  // Ref al input de edit inline de duración. Autofoco + select al entrar
  // en modo edit para que el tutor pueda tipear el nuevo valor de una.
  private readonly minutesEditInput = viewChild<ElementRef<HTMLInputElement>>('minutesEditInput');

  constructor() {
    void this.vm.load();
    // El VM arranca un ticker de countdown de 1s cuando el examen está
    // in_progress (para refrescar `nowTick`). `stop()` cancela el interval
    // al destruir la page — sin esto quedaría un leak tras navegar.
    this.destroyRef.onDestroy(() => this.vm.stop());

    effect(() => {
      if (this.vm.editingDuration()) {
        queueMicrotask(() => {
          const el = this.minutesEditInput()?.nativeElement;
          el?.focus();
          el?.select();
        });
      }
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

  protected canArchivar(): boolean {
    return this.vm.canArchivar();
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
    if (this.vm.durationError() !== null) this.vm.durationError.set(null);
  }

  protected onModeChange(mode: 'examen' | 'tarea'): void {
    this.vm.pendingMode.set(mode);
    // Al cambiar de modo limpio el error de fecha si el usuario venía
    // corrigiéndolo — evita mostrar mensajes viejos que ya no aplican.
    this.vm.openUntilError.set(null);
  }

  protected startEditDuration(): void {
    this.vm.editingDuration.set(true);
  }

  protected stopEditDuration(): void {
    this.vm.editingDuration.set(false);
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

  protected onArchivar(): void {
    this.vm.openArchivarModal();
  }

  protected onCancelArchivarModal(): void {
    this.vm.cancelArchivarModal();
  }

  protected onConfirmArchivarModal(): void {
    void this.vm.confirmArchivarModal();
  }

  protected onToggleStudent(studentId: string): void {
    this.vm.requestToggleStudent(studentId);
  }

  protected onConfirmDesactivar(): void {
    void this.vm.confirmDesactivarStudent();
  }

  protected onCancelDesactivar(): void {
    this.vm.cancelDesactivarStudent();
  }

  /** Nombre del alumno cuyo desactivar está pendiente — para el copy del modal. */
  protected pendingDesactivarStudentName(): string {
    const id = this.vm.desactivarPendingStudentId();
    if (id === null) return '';
    const s = this.vm.students().find((x) => x.studentId === id);
    if (!s) return '';
    return `${s.firstName} ${s.lastName}`;
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
