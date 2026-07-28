import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { GetActividadTutorUseCase } from '../../L2_application/use-cases/get-actividad-tutor.use-case';
import { ArchivarActividadTutorUseCase } from '../../L2_application/use-cases/archivar-actividad-tutor.use-case';
import { TutorActivityEvent } from '../../L1_domain/value-objects/tutor-activity-event';

// View-model de /tutor/actividad. Provider-local — cada montaje arranca
// limpio, sin timers propios.
//
// El listado sale 100% de IDB via `GetActividadTutorUseCase`. Sin fetch al
// back — el evento se registra al finalizar desde tutor-exam-detail.
@Injectable()
export class TutorActividadListViewModel {
  private readonly getActividad = inject(GetActividadTutorUseCase);
  private readonly archivarActividad = inject(ArchivarActividadTutorUseCase);
  private readonly router = inject(Router);

  readonly events = signal<readonly TutorActivityEvent[]>([]);
  readonly isLoading = signal(false);
  readonly storageError = signal(false);
  // Toast de "Archivado · deshacer" (5s). Guarda el último evento archivado
  // para permitir undo — cuando el user presiona "Deshacer", limpiamos el
  // flag y refrescamos.
  //
  // NOTA: "deshacer" no está implementado en este MVP porque el port solo
  // expone `archive()`. Si más adelante hace falta undo, se agrega
  // `unarchive()` al port + método al use case. Por ahora el toast solo
  // avisa; no ofrece acción.
  readonly lastArchivedName = signal<string | null>(null);

  async start(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.isLoading.set(true);
    this.storageError.set(false);
    try {
      const list = await this.getActividad.execute();
      this.events.set(list);
    } catch {
      this.events.set([]);
      this.storageError.set(true);
    } finally {
      this.isLoading.set(false);
    }
  }

  async archive(event: TutorActivityEvent): Promise<void> {
    try {
      await this.archivarActividad.execute(event.id);
      this.lastArchivedName.set(event.examName);
      // Auto-hide del toast a los 5s (design.md D6).
      setTimeout(() => {
        if (this.lastArchivedName() === event.examName) {
          this.lastArchivedName.set(null);
        }
      }, 5_000);
      await this.refresh();
    } catch {
      // Best-effort: si IDB falla, dejamos el listado como estaba.
    }
  }

  goToExam(event: TutorActivityEvent): void {
    void this.router.navigate(['/tutor/exams', event.recordId]);
  }
}
