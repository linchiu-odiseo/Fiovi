import { Injectable, signal } from '@angular/core';
import { TutorExam } from '../../L1_domain/entities/tutor-exam';

// Store compartido de la lista de virtual exams del tutor (D1).
// Es un singleton de sesión (`providedIn: 'root'`) sin IndexedDB ni outbox —
// sólo RAM. Outlive a los page-local VMs (TutorExamsListViewModel y
// TutorExamDetailViewModel) para que la navegación lista → detalle no
// requiera un refetch extra. No realiza I/O: la responsabilidad de fetching
// es del VM; el store sólo almacena y lee.
@Injectable({ providedIn: 'root' })
export class TutorExamsStore {
  private readonly _exams = signal<readonly TutorExam[]>([]);

  // Expone la lista como readonly signal — los consumidores no pueden mutar
  // directamente; deben pasar por los métodos del store.
  readonly exams = this._exams.asReadonly();

  // Reemplaza toda la lista. Llamado por TutorExamsListViewModel en cada poll
  // exitoso. La Signal notifica a todos los subscriptores reactivos.
  setExams(exams: readonly TutorExam[]): void {
    this._exams.set(exams);
  }

  // Resolución de classroomId por recordId (warm path de D1). Retorna null
  // si el store está vacío o el recordId no existe (cold path / deep-link).
  findByRecordId(recordId: string): TutorExam | null {
    return this._exams().find((e) => e.recordId === recordId) ?? null;
  }

  // Actualiza un exam existente o agrega uno nuevo (post-iniciar/finalizar —
  // R4 mitigation: la lista refleja el nuevo estado sin esperar al próximo poll).
  upsert(exam: TutorExam): void {
    const current = this._exams();
    const idx = current.findIndex((e) => e.recordId === exam.recordId);
    if (idx === -1) {
      this._exams.set([...current, exam]);
    } else {
      const next = [...current];
      next[idx] = exam;
      this._exams.set(next);
    }
  }

  // Saca un exam del store por recordId. Usado tras archivar — el back
  // deja de devolver el exam en la lista, así que lo sacamos localmente
  // para que /tutor/home no muestre el card obsoleto hasta el próximo poll.
  // No-op si el recordId no está.
  remove(recordId: string): void {
    const current = this._exams();
    const next = current.filter((e) => e.recordId !== recordId);
    if (next.length !== current.length) {
      this._exams.set(next);
    }
  }

  // Limpia el store. Útil en logout o reset de sesión.
  clear(): void {
    this._exams.set([]);
  }
}
