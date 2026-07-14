// El backend retornó 409 Conflict para un virtual exam: el examen ya cambió
// de estado (otro tutor actuó antes) o el set de alumnos está congelado /
// un alumno ya entregó y no puede removerse.
// L3 lo emite cuando classifyTutorError recibe status 409.
export class ExamConflictError extends Error {
  constructor(
    message = 'El examen ya cambió de estado. Actualizá la pantalla e intentá de nuevo.',
  ) {
    super(message);
    this.name = 'ExamConflictError';
  }
}
