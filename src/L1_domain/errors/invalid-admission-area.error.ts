// El área de postulación no pertenece al set cerrado de 16 valores
// (ver AdmissionArea VO). Se lanza en dos lugares:
//   1) SeleccionarAdmissionAreaUseCase cuando el input del UI no pasa
//      isAdmissionArea (defensa en profundidad — el picker ya restringe
//      la elección, pero el use case revalida).
//   2) HttpExamsApi (submit y draft) al mapear 400 con body.message
//      === "INVALID_ADMISSION_AREA".
// La UI muestra un mensaje genérico de "área inválida"; el alumno vuelve
// a abrir el picker y elige.
export class InvalidAdmissionAreaError extends Error {
  constructor(message = 'El área de postulación es inválida.') {
    super(message);
    this.name = 'InvalidAdmissionAreaError';
  }
}
