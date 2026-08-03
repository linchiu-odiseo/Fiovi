import { Injectable, computed, inject, signal } from '@angular/core';
import {
  GetHistorialEntryUseCase,
  HistorialEntryDetalle,
} from '../../L2_application/use-cases/get-historial-entry.use-case';
import { GetTodaysExamsUseCase } from '../../L2_application/use-cases/get-todays-exams.use-case';
import { AlternativaValue } from '../../L1_domain/ports/markings-storage';
import { AdmissionArea } from '../../L1_domain/value-objects/admission-area';
import { Exam } from '../../L1_domain/entities/exam';

// Fila de la grilla del detalle: número de pregunta + alternativa elegida
// (o '—' cuando no está marcada).
export interface HistorialAnswerRow {
  readonly pregunta: number;
  readonly alternativa: AlternativaValue;
}

// View-model del detalle del historial. Provider-local.
//
// Best-effort con getTodaysExams igual que el list VM: sin red seguimos
// mostrando ack + marcaciones (que viven en IDB), solo perdemos count/name
// del examen si no es de hoy.
@Injectable()
export class StudentHistorialDetailViewModel {
  private readonly getHistorialEntry = inject(GetHistorialEntryUseCase);
  private readonly getTodaysExams = inject(GetTodaysExamsUseCase);

  readonly examId = signal<string | null>(null);
  readonly detalle = signal<HistorialEntryDetalle | null>(null);
  readonly isLoading = signal(false);
  readonly storageError = signal(false);

  // Filas ordenadas por número de pregunta ascendente. Si tenemos el `exam`,
  // usamos su `count` para asegurar filas 1..count (incluye no-marcadas).
  // Si no, solo listamos las preguntas que hay en `marcaciones`.
  readonly rows = computed<HistorialAnswerRow[]>(() => {
    const d = this.detalle();
    if (!d) return [];
    const map = d.marcaciones;
    const count = d.exam?.count ?? this.inferCount(map);
    const rows: HistorialAnswerRow[] = [];
    for (let n = 1; n <= count; n++) {
      const key = String(n);
      rows.push({ pregunta: n, alternativa: map[key] ?? null });
    }
    return rows;
  });

  // Área de POSTULACIÓN persistida en el snapshot. null cuando no hay
  // snapshot (envío legacy) o cuando la entrada es "no-envío".
  readonly admissionArea = computed<AdmissionArea | null>(
    () => this.detalle()?.admissionArea ?? null,
  );

  async start(examId: string): Promise<void> {
    this.examId.set(examId);
    this.isLoading.set(true);
    this.storageError.set(false);
    let todaysExams: readonly Exam[] = [];
    try {
      todaysExams = await this.getTodaysExams.execute();
    } catch {
      // Ignorar — la carga desde IDB sigue.
    }
    try {
      const d = await this.getHistorialEntry.execute(examId, todaysExams);
      this.detalle.set(d);
    } catch {
      this.detalle.set(null);
      this.storageError.set(true);
    } finally {
      this.isLoading.set(false);
    }
  }

  private inferCount(map: Record<string, AlternativaValue>): number {
    let max = 0;
    for (const key of Object.keys(map)) {
      const n = Number(key);
      if (Number.isInteger(n) && n > max) max = n;
    }
    return max;
  }
}
