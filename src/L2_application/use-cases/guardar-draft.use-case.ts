// Use case puro para auto-save. NO toca queue, NO persiste ack, NO borra
// marcaciones. Errores se propagan; el `DraftAutoSaveDispatcher` los clasifica
// para decidir cuál escala al view-model.
//
// Resuelve el snapshot actual de marcaciones → reshape a STRING COMPACTO →
// delega al port ExamsApi.guardarDraft (POST /draft, 204 No Content).
//
// Asimetría intencional con EnviarSimulacroUseCase (que arma dict
// `Record<"P<n>", Letter>` para el /submit con hash y 201). Ver design.md D12
// de `draft-auto-save`: optimización de RAM de Redis ~9× vs dict, coordinada
// con learnex antes del deploy del endpoint.
import { IdentityStorage } from '../../L1_domain/ports/identity-storage';
import { AnswersMap, MarkingsStorage } from '../../L1_domain/ports/markings-storage';
import { DraftRequest, ExamsApi } from '../../L1_domain/ports/exams-api';
import { DEFAULT_ADMISSION_AREA } from '../../L1_domain/value-objects/admission-area';
import { SessionExpiredError } from '../../L1_domain/errors/session-expired.error';

export class GuardarDraftUseCase {
  constructor(
    private readonly api: ExamsApi,
    private readonly markingsStorage: MarkingsStorage,
    private readonly identityStorage: IdentityStorage,
  ) {}

  async execute({ examId, count }: { examId: string; count: number }): Promise<void> {
    const identity = await this.identityStorage.read();
    // Defensivo: identity nula (sesión expirada) o sin codigo (tutor stub que
    // no debería llegar acá) → no tocamos storage ni api.
    if (identity === null || identity.codigo === null) {
      throw new SessionExpiredError();
    }
    const code = identity.codigo;

    const answers = await this.markingsStorage.getMarcaciones(examId);
    const responses = this.toResponsesString(answers, count);
    // Área de POSTULACIÓN: null en storage = alumno nunca eligió expresamente.
    // El default vive acá — NO se persiste — para preservar la distinción
    // (design.md D3 de `add-admission-area`).
    const admissionArea =
      (await this.markingsStorage.getAdmissionArea(examId)) ?? DEFAULT_ADMISSION_AREA;

    const req: DraftRequest = { examId, code, admissionArea, responses };
    await this.api.guardarDraft(req);
  }

  // Reshape de AnswersMap interno al STRING COMPACTO del contrato learnex:
  // - Array de `count` posiciones pre-llenado con '-' (sin marcar).
  // - Para cada (pregunta, letra) con letra no-null, sobrescribe posición
  //   `parseInt(pregunta) - 1` (1-indexed → 0-indexed) si está en rango.
  // - Marcas fuera de rango [0, count) se ignoran silenciosamente (defensivo).
  // - `join('')` produce el string final.
  // Edge: count = 0 retorna "" (válido por contrato server zod `^[A-E-]*$`).
  private toResponsesString(answers: AnswersMap, count: number): string {
    const arr = new Array<string>(count).fill('-');
    for (const [pregunta, letra] of Object.entries(answers)) {
      if (letra === null) continue;
      const idx = Number.parseInt(pregunta, 10) - 1;
      if (idx >= 0 && idx < count) {
        arr[idx] = letra;
      }
    }
    return arr.join('');
  }
}
