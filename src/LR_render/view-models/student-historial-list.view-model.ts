import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  GetHistorialUseCase,
  HistorialEntry,
} from '../../L2_application/use-cases/get-historial.use-case';
import { GetTodaysExamsUseCase } from '../../L2_application/use-cases/get-todays-exams.use-case';
import { Exam } from '../../L1_domain/entities/exam';

// View-model de /student/historial (lista). Provider-local — cada montaje
// arranca limpio.
//
// El historial es 100% local (IDB). El fetch a `getTodaysExams` es opcional:
// si funciona, enriquece los envíos de hoy con nombre + curso; si falla (sin
// red, sesión expirada), la lista igual muestra los envíos con fecha + hash.
// Esto es intencional — el alumno debería poder ver su comprobante offline.
@Injectable()
export class StudentHistorialListViewModel {
  private readonly getHistorial = inject(GetHistorialUseCase);
  private readonly getTodaysExams = inject(GetTodaysExamsUseCase);
  private readonly router = inject(Router);

  readonly entries = signal<readonly HistorialEntry[]>([]);
  readonly isLoading = signal(false);
  readonly storageError = signal(false);

  async start(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.isLoading.set(true);
    this.storageError.set(false);
    let todaysExams: readonly Exam[] = [];
    try {
      todaysExams = await this.getTodaysExams.execute();
    } catch {
      // Best-effort: sin red, sesión expirada, permisos revocados — el
      // historial local igual se muestra, solo pierde nombre + curso de
      // los envíos de hoy.
    }
    try {
      const list = await this.getHistorial.execute(todaysExams);
      this.entries.set(list);
    } catch {
      // Storage roto (OfflineStorageUnavailableError). El único caso donde
      // no podemos mostrar nada.
      this.entries.set([]);
      this.storageError.set(true);
    } finally {
      this.isLoading.set(false);
    }
  }

  goToDetail(examId: string): void {
    void this.router.navigate(['/student/historial', examId]);
  }
}
