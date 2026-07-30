import { Clock } from '../../L1_domain/ports/clock';
import { IdentityStorage } from '../../L1_domain/ports/identity-storage';
import { AnswersMap, MarkingsStorage } from '../../L1_domain/ports/markings-storage';
import { ExamsApi } from '../../L1_domain/ports/exams-api';
import { DEFAULT_ADMISSION_AREA } from '../../L1_domain/value-objects/admission-area';
import { SubmissionAck } from '../../L1_domain/value-objects/submission-ack';
import { NetworkError } from '../../L1_domain/errors/network.error';
import { SessionExpiredError } from '../../L1_domain/errors/session-expired.error';

export interface EnviarSimulacroInput {
  examId: string;
  // Override opcional del timestamp. ProgramarAutoEnvioUseCase lo usa para
  // forzar `clientFinishedAt = exam window end` exacto, independientemente
  // de cuándo el timer dispare por el jitter. Caso normal (botón Enviar):
  // se omite y el clock server-anchored manda.
  clientFinishedAtOverride?: Date;
}

export interface EnviarSimulacroOutput {
  status: 'enviado' | 'queued';
  // Ack solo presente en el path síncrono exitoso. En `queued` queda null
  // hasta que `RetomarEnviosPendientesUseCase` cierre el ciclo cuando vuelva
  // la red — ese use case persiste el ack directamente en storage sin
  // notificar al view-model.
  ack: SubmissionAck | null;
}

// Reshape de AnswersMap interno a `responses` del contrato learnex:
// - Omite las preguntas con valor `null` (el back solo quiere las marcadas).
// - Prefija las keys con "P" (`"1"` → `"P1"`).
// Exportada para que `RetomarEnviosPendientesUseCase` reuse la misma lógica.
export function responsesFromAnswers(
  answers: AnswersMap,
): Record<string, 'A' | 'B' | 'C' | 'D' | 'E'> {
  const out: Record<string, 'A' | 'B' | 'C' | 'D' | 'E'> = {};
  for (const [pregunta, letra] of Object.entries(answers)) {
    if (letra === null) continue;
    out[`P${pregunta}`] = letra;
  }
  return out;
}

// Envía las marcaciones al backend. Decisión deliberada de UX:
// - Éxito 201 → persiste el ack en storage, borra marcaciones locales,
//   retorna `{ status: 'enviado', ack }`. El view-model muestra el modal
//   de comprobante.
// - `NetworkError` (red caída, 429, 5xx) → encola en `MarkingsStorage` con
//   el payload completo (`code`, `answers`, `clientFinishedAt`) y retorna
//   `{ status: 'queued', ack: null }`. El alumno ve el banner amarillo.
//   El dispatcher reintenta automático al volver `Connectivity.isOnline`.
// - Identity ausente o sin `codigo` (alumno sin DNI ligado a la sesión, o
//   sesión expiró entre el GET de la lista y el POST) → `SessionExpiredError`
//   antes de tocar el adapter.
// - Cualquier otro error de dominio propaga sin tocar storage.
export class EnviarSimulacroUseCase {
  constructor(
    private readonly api: ExamsApi,
    private readonly storage: MarkingsStorage,
    private readonly clock: Clock,
    private readonly identityStorage: IdentityStorage,
  ) {}

  async execute(input: EnviarSimulacroInput): Promise<EnviarSimulacroOutput> {
    const identity = await this.identityStorage.read();
    if (identity === null || identity.codigo === null) {
      throw new SessionExpiredError();
    }
    const code = identity.codigo;

    const ts = input.clientFinishedAtOverride ?? this.clock.now();
    const clientFinishedAt = ts.toISOString();
    const answers = await this.storage.getMarcaciones(input.examId);
    const responses = responsesFromAnswers(answers);
    // Área de POSTULACIÓN: null en storage = alumno nunca eligió expresamente.
    // El default vive acá — NO se persiste — para preservar la distinción
    // (design.md D3 de `add-admission-area`).
    const admissionArea =
      (await this.storage.getAdmissionArea(input.examId)) ?? DEFAULT_ADMISSION_AREA;

    try {
      const result = await this.api.enviar({
        examId: input.examId,
        code,
        admissionArea,
        responses,
        clientFinishedAt,
      });
      // Orden: snapshot → ack → clear.
      // El ack es la señal de "está enviado" para el historial-list. Si
      // crashea entre snapshot y ack, la próxima app abre sin ack local
      // → el alumno puede reintentar el envío con las marcaciones live
      // (que aún no fueron limpiadas). Si crashea entre ack y clear, el
      // historial lee el snapshot ya persistido; sin snapshot solo pasaría
      // si crasheara entre snapshot y ack (imposible por await).
      await this.storage.saveSubmissionSnapshot(input.examId, {
        answers,
        admissionArea,
      });
      await this.storage.setSubmissionAck(input.examId, result.ack);
      await this.storage.clearMarcaciones(input.examId);
      return { status: 'enviado', ack: result.ack };
    } catch (err) {
      if (err instanceof NetworkError) {
        await this.storage.enqueueEnvio({
          examId: input.examId,
          code,
          admissionArea,
          answers,
          clientFinishedAt,
        });
        return { status: 'queued', ack: null };
      }
      throw err;
    }
  }
}
