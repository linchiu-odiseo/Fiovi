export class AccountNotActiveError extends Error {
  constructor(message = 'Tu cuenta no está activa. Contacta a tu institución para activarla.') {
    super(message);
    this.name = 'AccountNotActiveError';
  }
}
