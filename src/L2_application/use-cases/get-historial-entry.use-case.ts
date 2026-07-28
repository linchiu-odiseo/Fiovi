import { Exam } from '../../L1_domain/entities/exam';
import { AnswersMap, MarkingsStorage } from '../../L1_domain/ports/markings-storage';
import { AdmissionArea, DEFAULT_ADMISSION_AREA } from '../../L1_domain/value-objects/admission-area';
import { SubmissionAck } from '../../L1_domain/value-objects/submission-ack';

// Bundle para el detalle del historial. `ack` es null cuando el estado es
// "no-envío" (finalized sin ack local). `admissionArea` viene del snapshot
// congelado en el momento del envío; null si no hay snapshot (envío legacy
// pre-cambio, o entrada "no-envío"). `exam` es null cuando el back ya no lo
// devuelve (>1 día → archivado).
export interface HistorialEntryDetalle {
  readonly examId: string;
  readonly exam: Exam | null;
  readonly ack: SubmissionAck | null;
  readonly marcaciones: AnswersMap;
  readonly admissionArea: AdmissionArea | null;
}

// Lee el detalle de una entrada del historial por examId. Combina lo que
// hay en IDB (ack + snapshot con answers/area) con la metadata del exam si
// viene en `todaysExams` (para poder mostrar nombre + count de preguntas).
//
// Preferencia de lectura de marcaciones:
//   1. `submission-snapshot` (congelado post-submit) — la fuente de verdad
//      para lo que se envió. Sobrevive al clearMarcaciones del post-envío.
//   2. Fallback a `getMarcaciones` (marcaciones activas) — solo para envíos
//      pre-migración a snapshot (o entradas raras donde el snapshot no se
//      persistió). Legacy path.
export class GetHistorialEntryUseCase {
  constructor(private readonly markings: MarkingsStorage) {}

  async execute(examId: string, todaysExams: readonly Exam[]): Promise<HistorialEntryDetalle> {
    const [ack, snapshot, liveMarcaciones] = await Promise.all([
      this.markings.getSubmissionAck(examId),
      this.markings.getSubmissionSnapshot(examId),
      this.markings.getMarcaciones(examId),
    ]);
    const exam = todaysExams.find((e) => e.id === examId) ?? null;

    // El snapshot manda. Fallback a marcaciones activas para compat con
    // envíos previos al agregar snapshot (o casos degradados).
    const marcaciones = snapshot?.answers ?? liveMarcaciones;
    const admissionArea = snapshot?.admissionArea ?? (ack !== null ? DEFAULT_ADMISSION_AREA : null);

    return { examId, exam, ack, marcaciones, admissionArea };
  }
}
