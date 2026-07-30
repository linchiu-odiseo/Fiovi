import { ExamsApi, MySubmission } from '../../L1_domain/ports/exams-api';
import { MarkingsStorage } from '../../L1_domain/ports/markings-storage';
import { DEFAULT_ADMISSION_AREA } from '../../L1_domain/value-objects/admission-area';

// Consulta el back por la fila de submission del alumno para una sesión,
// y — si existe — la persiste en IDB como ack + snapshot para que el
// historial y el detalle la muestren sin necesidad de otro round-trip.
//
// Retorna:
//   - `MySubmission` cuando el back devuelve 200 (con `source`).
//   - `null` cuando el back devuelve 404 (no hay entrega del alumno).
//
// Propaga NetworkError sin persistir nada.
//
// La persistencia es idempotente: si el ack local ya existía con el mismo
// hash, el put lo sobrescribe con el mismo shape. Se agrega el snapshot para
// que el detalle del historial pueda mostrar las respuestas guardadas por el
// server (post-finalize) aunque el device nunca haya visto esas marcaciones.
export class GetMySubmissionUseCase {
  constructor(
    private readonly api: ExamsApi,
    private readonly markings: MarkingsStorage,
  ) {}

  async execute(examId: string): Promise<MySubmission | null> {
    const result = await this.api.getMySubmission(examId);
    if (result === null) return null;

    // Persistir en IDB: ack + snapshot. El snapshot guarda respuestas + area
    // exactas de la BD, que son las que el grader va a evaluar.
    await this.markings.setSubmissionAck(examId, result.ack);
    await this.markings.saveSubmissionSnapshot(examId, {
      answers: result.responses,
      admissionArea: result.admissionArea ?? DEFAULT_ADMISSION_AREA,
    });

    return result;
  }
}
