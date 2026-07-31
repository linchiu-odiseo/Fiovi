import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { GetTutorExamsFinalizadasUseCase } from '../../L2_application/use-cases/get-tutor-exams-finalizadas.use-case';
import { ArchivarExamenUseCase } from '../../L2_application/use-cases/archivar-examen.use-case';
import { TutorExam } from '../../L1_domain/entities/tutor-exam';
import { NetworkError } from '../../L1_domain/errors/network.error';
import { TutorExamForbiddenError } from '../../L1_domain/errors/tutor-exam-forbidden.error';
import { ExamConflictError } from '../../L1_domain/errors/exam-conflict.error';
import { VirtualExamNotFoundError } from '../../L1_domain/errors/virtual-exam-not-found.error';

// View-model de /tutor/actividad. Provider-local — cada montaje arranca
// limpio, sin timers propios.
//
// El listado sale del endpoint dedicado /tutor/exams/finalizadas — payload
// liviano (0-10 items post-archived 00h). Los items traen classroomName
// desde el DTO (no hace falta lookup en el profile). El back archiva a las
// 00h, entonces la lista se limpia sola sin storage local que sincronizar.
@Injectable()
export class TutorActividadListViewModel {
  private readonly getFinalizadas = inject(GetTutorExamsFinalizadasUseCase);
  private readonly archivarExamen = inject(ArchivarExamenUseCase);
  private readonly router = inject(Router);

  readonly events = signal<readonly TutorExam[]>([]);
  readonly isLoading = signal(false);
  readonly loadError = signal(false);

  // Estado del archivado por card. La UI usa esto para mostrar spinner en la
  // card en curso y bloquear taps repetidos. `archiveError` almacena el copy
  // final (ya mapeado); consumidor lo mostraría como banner sobre el listado.
  readonly archivingId = signal<string | null>(null);
  readonly archiveError = signal<string | null>(null);

  async start(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.isLoading.set(true);
    this.loadError.set(false);
    try {
      const items = await this.getFinalizadas.execute();
      const sorted = [...items].sort(byMostRecentFirst);
      this.events.set(sorted);
    } catch (err) {
      this.events.set([]);
      if (err instanceof NetworkError || err instanceof TutorExamForbiddenError) {
        this.loadError.set(true);
      } else {
        throw err;
      }
    } finally {
      this.isLoading.set(false);
    }
  }

  // Archiva un examen finalizado desde el swipe de la card. Online-only —
  // el use case no tiene outbox. Sin reintento automático: si falla, el
  // mensaje queda en `archiveError` y el usuario decide si vuelve a intentar.
  //
  // Optimista: no removemos la card de la lista antes de la respuesta del
  // back porque no hay rollback trivial si falla (el orden `sort(byMostRecent)`
  // no está indexado por recordId). Preferimos esperar el 200 y refrescar.
  async archivar(recordId: string): Promise<void> {
    if (this.archivingId() !== null) return; // Un archive por vez.
    this.archivingId.set(recordId);
    this.archiveError.set(null);
    try {
      await this.archivarExamen.execute({ recordId });
      await this.refresh();
    } catch (err) {
      this.archiveError.set(copyForArchive(err));
    } finally {
      this.archivingId.set(null);
    }
  }

  dismissArchiveError(): void {
    this.archiveError.set(null);
  }

  goToExam(exam: TutorExam): void {
    // Pasa `from=/tutor/actividad` para que el detail sepa a dónde volver
    // cuando el tutor tape Volver o Archivar. Sin esto cae al default
    // /tutor/home, que es lo correcto cuando venís del home pero no
    // cuando venís de la lista de actividad.
    void this.router.navigate(['/tutor/exams', exam.recordId], {
      queryParams: { from: '/tutor/actividad' },
    });
  }
}

// Ordena por hora de finalización descendente. `finishedAt` viene non-null
// desde el endpoint dedicado, pero mantenemos el fallback defensivo por si
// el DTO cambia.
function byMostRecentFirst(a: TutorExam, b: TutorExam): number {
  const ta = (a.finishedAt ?? a.scheduled).getTime();
  const tb = (b.finishedAt ?? b.scheduled).getTime();
  return tb - ta;
}

// Mapea errores del archivar a copy es-PE. Alineado con la tabla del
// tutor-exam-detail.view-model (§D2) — mismos mensajes para que el tutor no
// vea inconsistencias entre pantallas.
function copyForArchive(err: unknown): string {
  if (err instanceof ExamConflictError) {
    return 'El examen ya fue archivado o todavía no está finalizado.';
  }
  if (err instanceof VirtualExamNotFoundError) return 'Este examen ya no está disponible.';
  if (err instanceof TutorExamForbiddenError) {
    return 'No tenés permiso para archivar este examen.';
  }
  if (err instanceof NetworkError) return 'Sin conexión. Revisá tu red y reintentá.';
  return 'Ocurrió un error al archivar el examen. Reintentá.';
}
