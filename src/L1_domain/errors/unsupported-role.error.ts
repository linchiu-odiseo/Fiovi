// Se emite cuando el back devuelve una identity con un rol que el cliente
// aún no soporta (hoy: cualquier rol distinto de 'student' o 'tutor').
//
// learnex define más roles (admin, teacher) en su contrato; Fiovi los
// rechaza en el mapper L3 hasta que el producto los incorpore. Es una
// guarda explícita: sin esto, un user admin se loguearía con éxito y
// quedaría atrapado en un loop de redirects al no existir `/admin/home`.
//
// Cuando se agregue soporte para más roles, este error queda obsoleto.
export class UnsupportedRoleError extends Error {
  constructor(
    readonly role: string,
    message = `Role "${role}" is not supported by this client`,
  ) {
    super(message);
    this.name = 'UnsupportedRoleError';
  }
}
