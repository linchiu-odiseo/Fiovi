import { Exam } from '../../L1_domain/entities/exam';
import { AnswersMap, MarkingsStorage } from '../../L1_domain/ports/markings-storage';
import { SubmissionAck } from '../../L1_domain/value-objects/submission-ack';

// Bundle para el detalle del historial. `ack` es null cuando el estado es
// "no-envío" (finalized sin ack local). `marcaciones` puede estar vacío
// para envíos hechos desde otra device (el alumno ve solo el hash + hora).
// `exam` es null cuando el back ya no lo devuelve (>1 día → archivado).
export interface HistorialEntryDetalle {
  readonly examId: string;
  readonly exam: Exam | null;
  readonly ack: SubmissionAck | null;
  readonly marcaciones: AnswersMap;
}

// Lee el detalle de una entrada del historial por examId. Combina lo que
// hay en IDB (ack + marcaciones) con la metadata del exam si viene en
// `todaysExams` (para poder mostrar nombre + count de preguntas). Es puro
// TS, no hace fetch — el view-model pasa `todaysExams` desde el home.
export class GetHistorialEntryUseCase {
  constructor(private readonly markings: MarkingsStorage) {}

  async execute(examId: string, todaysExams: readonly Exam[]): Promise<HistorialEntryDetalle> {
    const [ack, marcaciones] = await Promise.all([
      this.markings.getSubmissionAck(examId),
      this.markings.getMarcaciones(examId),
    ]);
    const exam = todaysExams.find((e) => e.id === examId) ?? null;
    return { examId, exam, ack, marcaciones };
  }
}
