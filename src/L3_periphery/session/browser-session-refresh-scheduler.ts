import { Injectable } from '@angular/core';
import { SessionRefreshScheduler } from '../../L1_domain/ports/session-refresh-scheduler';

/**
 * Ventana antes de `expiresAt` para disparar el refresh proactivo. 60s cubre
 * la latencia tipica del roundtrip a `POST /auth/refresh` y deja margen para
 * un reintento reactivo por parte del interceptor si el proactivo falla, sin
 * llegar a que el JWT expire realmente en el bucle 401.
 *
 * Alineado con `NEXT_PUBLIC_REFRESH_BEFORE_MS=60000` que usa web-tenant en el
 * `.env` de learnex, para que ambos frontends refresquen en el mismo momento
 * relativo del ciclo de vida del token.
 */
const REFRESH_LEAD_TIME_MS = 60_000;

/**
 * Impl L3 del scheduler proactivo de refresh. Usa un unico `setTimeout` global
 * (no accepta multiples timers concurrentes): cada `schedule(...)` cancela el
 * anterior y agenda uno nuevo. Este modelo asume que hay UNA identidad activa
 * por app (no multi-user simultaneo), lo cual matchea el flow de Fiovi.
 *
 * El handler (funcion que ejecuta el refresh) se wire una vez en el bootstrap
 * via `setRefreshHandler`. Sin handler seteado, el trigger es un no-op (log
 * warn) — util para tests que no necesitan simular el refresh real.
 *
 * @Injectable providedIn:'root' porque el timer debe ser global a la app:
 * multiples instancias competirian por disparar el mismo refresh y causar
 * bursts contra `/auth/refresh` (lo opuesto a lo que este scheduler existe
 * para evitar).
 */
@Injectable({ providedIn: 'root' })
export class BrowserSessionRefreshScheduler implements SessionRefreshScheduler {
  private timerHandle: ReturnType<typeof setTimeout> | null = null;
  private handler: (() => Promise<void>) | null = null;

  setRefreshHandler(handler: () => Promise<void>): void {
    this.handler = handler;
  }

  schedule(expiresAt: number): void {
    this.cancel();
    // Si el JWT ya vencio (o esta dentro del lead time), agendamos en 0ms:
    // no bloqueamos el thread, pero el refresh sale en el proximo tick.
    // Esto sucede al arrancar la app con una identity persistida cuya cookie
    // estuvo hibernando (device dormido); queremos refresh inmediato pero no
    // sincrono, para no cargar al bootstrap.
    const delayMs = Math.max(0, expiresAt - Date.now() - REFRESH_LEAD_TIME_MS);
    this.timerHandle = setTimeout(() => {
      this.timerHandle = null;
      void this.trigger();
    }, delayMs);
  }

  cancel(): void {
    if (this.timerHandle !== null) {
      clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }
  }

  private async trigger(): Promise<void> {
    if (this.handler === null) {
      // Bootstrap incompleto: alguien llamo schedule() antes de que el
      // APP_INITIALIZER wire el handler. No es fatal — el interceptor
      // reactivo cachea el proximo 401. Log para diagnosticar.
      console.warn('SessionRefreshScheduler.trigger: handler not set; skipping proactive refresh');
      return;
    }
    try {
      // Contrato del handler: exitoso -> el use case re-agenda con nuevo
      // expiresAt via schedule(). Fallado con RefreshFailedError -> el use
      // case dispara logout (que llama cancel()). NetworkError u otros ->
      // no re-agendamos; el interceptor reactivo tomara el proximo 401.
      await this.handler();
    } catch (err) {
      console.warn(
        'SessionRefreshScheduler: proactive refresh failed; reactive interceptor will handle next 401',
        err,
      );
    }
  }
}
