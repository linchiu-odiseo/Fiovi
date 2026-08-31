/**
 * Scheduler proactivo del refresh de sesion. Encapsula el timer que dispara
 * `POST /auth/refresh` unos segundos antes de que expire el access token,
 * evitando el patron 401 -> refresh -> retry que ejercitaba el interceptor
 * reactivo en `credentials.interceptor.ts` post-expiracion.
 *
 * Motivacion: con 1000 alumnos activos que loguearon en un rango corto (ej.
 * inicio de examen a las 08:00), el JWT expira para todos casi al mismo tiempo.
 * El interceptor reactivo dispara refresh masivo cuando cada alumno hace su
 * proxima accion, generando un burst en `POST /auth/refresh`. El scheduler
 * proactivo distribuye ese trabajo en el tiempo (refresh al minuto 19 desde
 * el login, no al minuto 20+X cuando el usuario clickea) y elimina la latencia
 * percibida del 401 -> refresh -> retry.
 *
 * Contrato:
 *   - `schedule(expiresAt)`: cancela cualquier timer previo y agenda un nuevo
 *     refresh para (expiresAt - lead time). Si el delay resultante es <=0,
 *     dispara refresh inmediato en el proximo tick.
 *   - `cancel()`: cancela el timer pendiente (idempotente). Usado por logout.
 *   - `setRefreshHandler(fn)`: wire de la funcion que dispara el refresh
 *     real (tipicamente `() => RefreshIdentityUseCase.execute()`). Se llama
 *     UNA VEZ en el bootstrap; permite romper el ciclo DI scheduler <->
 *     use case sin lazy inject.
 *
 * Errores del handler:
 *   - Si el handler propaga `RefreshFailedError`, el use case ya dispara
 *     `LogoutUseCase.execute()` (que a su vez llama `cancel()`).
 *   - Si propaga `NetworkError` u otro, el scheduler NO reintenta ni re-agenda;
 *     la proxima accion del usuario cae en el interceptor reactivo del 401.
 */
export interface SessionRefreshScheduler {
  schedule(expiresAt: number): void;
  cancel(): void;
  setRefreshHandler(handler: () => Promise<void>): void;
}
