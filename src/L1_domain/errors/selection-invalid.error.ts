// Error que se lanza cuando el flow del selector de tenants no puede
// completarse: `selectionToken` expiró, slug elegido no está en la lista
// pre-autenticada, o el backend rechazó la selección por cualquier motivo
// (400/401/403/404). El caller (view-model) muestra un mensaje genérico y
// redirige al user de vuelta a /login para reintentar.
export class SelectionInvalidError extends Error {
  constructor(message = 'La selección expiró o es inválida') {
    super(message);
    this.name = 'SelectionInvalidError';
  }
}
