import { MarkingsStorage } from '../../L1_domain/ports/markings-storage';
import { ExamsApi } from '../../L1_domain/ports/exams-api';
import { DEFAULT_ADMISSION_AREA } from '../../L1_domain/value-objects/admission-area';
import { NetworkError } from '../../L1_domain/errors/network.error';
import { responsesFromAnswers } from './enviar-simulacro.use-case';

// Lee la cola de envíos pendientes y despacha cada uno con su payload
// original (`code`, `answers`, `clientFinishedAt`) capturado en el primer
// intento. Reglas:
// - 201 → persiste el `ack` devuelto por el server (esto permite que
//   `/home` muestre la card "Enviado · Pendiente de calificación" tras
//   reabrir la app), luego dequeue + clearMarcaciones.
// - `NetworkError` → deja en cola para próximo trigger (no avanza).
// - Cualquier otro error de dominio (4xx) → dequeue + clearMarcaciones y
//   log a consola: el envío no es recuperable, no retreamos indefinido.
//
// El dispatcher L3 invoca este use case al arrancar la app y cuando
// `Connectivity` cambia a online.
export class RetomarEnviosPendientesUseCase {
  constructor(
    private readonly api: ExamsApi,
    private readonly storage: MarkingsStorage,
  ) {}

  async execute(): Promise<void> {
    const pendientes = await this.storage.getEnviosPendientes();
    for (const envio of pendientes) {
      try {
        const result = await this.api.enviar({
          examId: envio.examId,
          code: envio.code,
          // Fallback para entries legacy encoladas antes del rollout de
          // admission-area — el campo es opcional en EnvioPendiente.
          admissionArea: envio.admissionArea ?? DEFAULT_ADMISSION_AREA,
          responses: responsesFromAnswers(envio.answers),
          clientFinishedAt: envio.clientFinishedAt,
        });
        await this.storage.setSubmissionAck(envio.examId, result.ack);
        // Snapshot con las respuestas + área originalmente encoladas — el
        // historial las lee del snapshot, no de las marcaciones activas.
        await this.storage.saveSubmissionSnapshot(envio.examId, {
          answers: envio.answers,
          admissionArea: envio.admissionArea ?? DEFAULT_ADMISSION_AREA,
        });
        await this.storage.dequeueEnvio(envio.examId);
        await this.storage.clearMarcaciones(envio.examId);
      } catch (err) {
        if (err instanceof NetworkError) {
          // Dejar en cola; reintenta en el próximo trigger.
          continue;
        }
        console.warn(`Envío pendiente descartado para ${envio.examId}:`, err);
        await this.storage.dequeueEnvio(envio.examId);
        await this.storage.clearMarcaciones(envio.examId);
      }
    }
  }
}
