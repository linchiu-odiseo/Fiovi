import { SessionRefreshScheduler } from '../../../src/L1_domain/ports/session-refresh-scheduler';

/**
 * Fake in-memory del `SessionRefreshScheduler` para tests L2. Registra las
 * llamadas a `schedule(...)` y `cancel(...)` en el orden en que ocurrieron
 * (util para verificar la secuencia login -> schedule, refresh -> re-schedule,
 * logout -> cancel).
 *
 * `setRefreshHandler` guarda el handler pero NUNCA lo dispara automaticamente:
 * los tests que quieren simular "el timer se disparo" llaman `triggerNow()`.
 * Esto evita timers reales en la suite de tests.
 */
export class FakeSessionRefreshScheduler implements SessionRefreshScheduler {
  public readonly scheduleCalls: number[] = [];
  public cancelCalls = 0;
  private handler: (() => Promise<void>) | null = null;

  schedule(expiresAt: number): void {
    this.scheduleCalls.push(expiresAt);
  }

  cancel(): void {
    this.cancelCalls++;
  }

  setRefreshHandler(handler: () => Promise<void>): void {
    this.handler = handler;
  }

  // Test helper: simula que el timer se disparo. Devuelve la promesa del
  // handler para que el test pueda `await` y verificar side effects.
  async triggerNow(): Promise<void> {
    if (!this.handler) throw new Error('FakeSessionRefreshScheduler: handler not set');
    await this.handler();
  }
}
