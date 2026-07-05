import { MarkingsStorage } from '../../L1_domain/ports/markings-storage';
import { AdmissionArea, isAdmissionArea } from '../../L1_domain/value-objects/admission-area';
import { InvalidAdmissionAreaError } from '../../L1_domain/errors/invalid-admission-area.error';

export interface SeleccionarAdmissionAreaInput {
  examId: string;
  area: unknown; // Se valida con isAdmissionArea antes de persistir.
}

// Persiste el área de POSTULACIÓN elegida por el alumno en el picker.
// NO confundir con `Exam.area` que es CURSO (Letras/Ciencias/Números).
//
// Defensa en profundidad: el picker de UI ya restringe la elección al set
// de 16 valores, pero el use case revalida para proteger contra bugs del
// componente o payloads inesperados. Si el input no pertenece al set,
// lanza `InvalidAdmissionAreaError` SIN tocar storage.
//
// El use case NO despacha drafts, NO toca identity, NO lee marcaciones.
// El view-model llama `DraftAutoSaveDispatcher.notificarCambio` después
// (mismo hook que post-`marcarRespuesta`) para que el próximo draft
// persista el cambio al back.
export class SeleccionarAdmissionAreaUseCase {
  constructor(private readonly storage: MarkingsStorage) {}

  async execute(input: SeleccionarAdmissionAreaInput): Promise<void> {
    if (!isAdmissionArea(input.area)) {
      throw new InvalidAdmissionAreaError(`Área no reconocida: "${String(input.area)}".`);
    }
    const area: AdmissionArea = input.area;
    await this.storage.setAdmissionArea(input.examId, area);
  }
}
