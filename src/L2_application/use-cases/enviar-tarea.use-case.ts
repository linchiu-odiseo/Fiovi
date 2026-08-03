import { Clock } from '../../L1_domain/ports/clock';
import { IdentityStorage } from '../../L1_domain/ports/identity-storage';
import { MarkingsStorage } from '../../L1_domain/ports/markings-storage';
import { ExamsApi } from '../../L1_domain/ports/exams-api';
import { DEFAULT_ADMISSION_AREA } from '../../L1_domain/value-objects/admission-area';
import { NetworkError } from '../../L1_domain/errors/network.error';
import { SessionExpiredError } from '../../L1_domain/errors/session-expired.error';
import {
  EnviarSimulacroInput,
  EnviarSimulacroOutput,
  responsesFromAnswers,
} from './enviar-simulacro.use-case';

// Envío del alumno en modo "tarea" — usa el endpoint POST /submit-homework
// del backend (INSERT síncrono directo, sin queue BullMQ). Se separa del
// path proctored para no meter branches en el hot path de examen.
//
// Semántica de éxito / queued idéntica a EnviarSimulacroUseCase — la única
// diferencia es la ruta HTTP y las guards del server (openUntil !== null
// AND now < openUntil vs. startedAt + duration).
//
// Reusa `responsesFromAnswers` para el reshape de AnswersMap → responses P#
// (misma forma que el submit clásico).
export class EnviarTareaUseCase {
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
    const admissionArea =
      (await this.storage.getAdmissionArea(input.examId)) ?? DEFAULT_ADMISSION_AREA;

    try {
      const result = await this.api.enviarHomework({
        examId: input.examId,
        code,
        admissionArea,
        responses,
        clientFinishedAt,
      });
      // Orden: snapshot → ack → clear. Ver comentario en EnviarSimulacroUseCase.
      await this.storage.saveSubmissionSnapshot(input.examId, {
        answers,
        admissionArea,
      });
      await this.storage.setSubmissionAck(input.examId, result.ack);
      await this.storage.clearMarcaciones(input.examId);
      return { status: 'enviado', ack: result.ack };
    } catch (err) {
      if (err instanceof NetworkError) {
        // Encolamos con el mismo shape que el submit clásico. El dispatcher
        // de retry ya usa MarkingsStorage.enqueueEnvio; si el back llegara a
        // rechazar la reentrega con 409 HOMEWORK_WINDOW_CLOSED (ventana ya
        // vencida), el dispatcher lo mapea como SimulacroCerradoError.
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
