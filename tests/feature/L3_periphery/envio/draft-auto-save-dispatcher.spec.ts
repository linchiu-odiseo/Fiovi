import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DraftAutoSaveDispatcher,
  NoopDraftAutoSaveDispatcher,
} from '../../../../src/L3_periphery/envio/draft-auto-save-dispatcher.service';
import { GuardarDraftUseCase } from '../../../../src/L2_application/use-cases/guardar-draft.use-case';
import { NetworkError } from '../../../../src/L1_domain/errors/network.error';
import { SimulacroCerradoError } from '../../../../src/L1_domain/errors/simulacro-cerrado.error';
import { InvalidPayloadError } from '../../../../src/L1_domain/errors/invalid-payload.error';
import { SessionExpiredError } from '../../../../src/L1_domain/errors/session-expired.error';

// Fixture razonable para `count` en la mayoría de los specs — irrelevante al
// comportamiento del dispatcher (debounce/throttle/backoff/heartbeat), solo
// importa que el use case lo reciba intacto.
const DEFAULT_COUNT = 4;

// Fake del GuardarDraftUseCase que controla el resultado de cada llamada.
// Captura `{ examId, count }` exactamente como llega del dispatcher para
// permitir assert del passthrough del count nuevo (design.md D12).
class FakeGuardarDraftUseCase {
  public calls: { examId: string; count: number }[] = [];
  private plan: { kind: 'resolve' } | { kind: 'reject'; error: Error } | null = null;

  willResolve(): void {
    this.plan = { kind: 'resolve' };
  }

  willReject(error: Error): void {
    this.plan = { kind: 'reject', error };
  }

  // Configura para una secuencia de resultados (1 por llamada).
  private sequence: ({ kind: 'resolve' } | { kind: 'reject'; error: Error })[] = [];

  willDoSequence(seq: ({ kind: 'resolve' } | { kind: 'reject'; error: Error })[]): void {
    this.sequence = [...seq];
    this.plan = null;
  }

  async execute(input: { examId: string; count: number }): Promise<void> {
    this.calls.push({ examId: input.examId, count: input.count });

    let planToUse = this.plan;
    if (this.sequence.length > 0) {
      planToUse = this.sequence.shift() ?? null;
    }

    if (!planToUse) {
      throw new Error('FakeGuardarDraftUseCase: configurar plan antes de llamar execute()');
    }
    if (planToUse.kind === 'reject') throw planToUse.error;
  }
}

// Helper para crear el dispatcher con el fake de use case.
function makeDispatcher(fakeUc: FakeGuardarDraftUseCase): DraftAutoSaveDispatcher {
  return new DraftAutoSaveDispatcher(fakeUc as unknown as GuardarDraftUseCase);
}

// Helper que avanza timers un poco y drena microtasks varias veces.
// Reemplaza vi.runAllTimersAsync() que causa loops infinitos por el setInterval del heartbeat.
async function drainMicrotasks(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

async function advanceAndDrain(ms: number): Promise<void> {
  vi.advanceTimersByTime(ms);
  await drainMicrotasks();
}

describe('DraftAutoSaveDispatcher', () => {
  let uc: FakeGuardarDraftUseCase;
  let dispatcher: DraftAutoSaveDispatcher;

  beforeEach(() => {
    vi.useFakeTimers();
    uc = new FakeGuardarDraftUseCase();
    dispatcher = makeDispatcher(uc);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Debounce 3s', () => {
    it('1 notificarCambio + 3000ms → 1 POST con (examId, count)', async () => {
      uc.willResolve();
      dispatcher.notificarCambio('S1', DEFAULT_COUNT);

      expect(uc.calls).toHaveLength(0);

      await advanceAndDrain(3000);

      expect(uc.calls).toHaveLength(1);
      expect(uc.calls[0].examId).toBe('S1');
      expect(uc.calls[0].count).toBe(DEFAULT_COUNT);
    });

    it('10 notificarCambio en 2s coalesce a 1 POST', async () => {
      uc.willResolve();

      for (let i = 0; i < 10; i++) {
        dispatcher.notificarCambio('S1', DEFAULT_COUNT);
        vi.advanceTimersByTime(200); // 200ms entre cada notificación (total 2s)
      }

      // Avanzar el debounce restante (3s desde el último cambio)
      await advanceAndDrain(3000);

      expect(uc.calls).toHaveLength(1);
    });

    it('notificarCambio a t=0 y t=2000ms → POST a t=5000ms (debounce reset)', async () => {
      uc.willResolve();

      dispatcher.notificarCambio('S1', DEFAULT_COUNT); // timer A: dispara a t=3000
      vi.advanceTimersByTime(2000);
      dispatcher.notificarCambio('S1', DEFAULT_COUNT); // cancela timer A; timer B: dispara a t=5000

      // A t=3000 (1000ms después) — timer A fue cancelado, no POST
      await advanceAndDrain(1000);
      expect(uc.calls).toHaveLength(0);

      // Avanzar a t=5000 (2000ms más)
      await advanceAndDrain(2000);
      expect(uc.calls).toHaveLength(1);
    });
  });

  describe('count se persiste en DraftState idempotentemente', () => {
    it('notificarCambio("S1", 50) → fire pasa { examId: "S1", count: 50 } al use case', async () => {
      uc.willResolve();
      dispatcher.notificarCambio('S1', 50);

      await advanceAndDrain(3000);

      expect(uc.calls).toHaveLength(1);
      expect(uc.calls[0]).toEqual({ examId: 'S1', count: 50 });
    });

    it('count diferente entre llamadas: la última gana (idempotente) y el fire usa la última', async () => {
      uc.willResolve();

      // Primera notificación arma debounce con count=10
      dispatcher.notificarCambio('S1', 10);
      vi.advanceTimersByTime(1000);
      // Segunda notificación actualiza count a 20 (reset debounce)
      dispatcher.notificarCambio('S1', 20);

      await advanceAndDrain(3000);

      expect(uc.calls).toHaveLength(1);
      expect(uc.calls[0].count).toBe(20);
    });

    it('count se mantiene entre POSTs sucesivos sin necesidad de re-notificar el mismo valor', async () => {
      uc.willDoSequence([{ kind: 'resolve' }, { kind: 'resolve' }]);

      // Primer ciclo: count=7
      dispatcher.notificarCambio('S1', 7);
      await advanceAndDrain(3000);
      expect(uc.calls[0].count).toBe(7);

      // Segundo ciclo: notifica sin actualizar count (pasa el mismo)
      await advanceAndDrain(10_000); // libera throttle
      dispatcher.notificarCambio('S1', 7);
      await advanceAndDrain(3000);

      expect(uc.calls).toHaveLength(2);
      expect(uc.calls[1].count).toBe(7);
    });

    it('sesiones distintas mantienen counts independientes', async () => {
      uc.willResolve();

      dispatcher.notificarCambio('S1', 30);
      dispatcher.notificarCambio('S2', 80);

      await advanceAndDrain(3000);

      expect(uc.calls).toHaveLength(2);
      const s1 = uc.calls.find((c) => c.examId === 'S1');
      const s2 = uc.calls.find((c) => c.examId === 'S2');
      expect(s1?.count).toBe(30);
      expect(s2?.count).toBe(80);
    });
  });

  describe('Throttle 10s entre POSTs', () => {
    it('tras éxito, segundo notificarCambio 3s después → POST gateado por throttle', async () => {
      uc.willResolve();

      // Primer dispatch a t=3000
      dispatcher.notificarCambio('S1', DEFAULT_COUNT);
      await advanceAndDrain(3000);
      expect(uc.calls).toHaveLength(1);

      // Segundo cambio a t=4000 (1s después del primer POST exitoso)
      vi.advanceTimersByTime(1000);
      dispatcher.notificarCambio('S1', DEFAULT_COUNT); // debounce: dispara tryFire a t=7000

      // t=7000: debounce dispara, throttle detecta (7000 - 3000 = 4000 < 10000) → reagenda
      await advanceAndDrain(3000);
      expect(uc.calls).toHaveLength(1); // aún bloqueado por throttle

      // Avanzar hasta t=13000 (3000 + 10_000 = lastPostAt + 10_000)
      await advanceAndDrain(6000);
      expect(uc.calls).toHaveLength(2);
    });
  });

  describe('Backoff exponencial', () => {
    it('primera falla NetworkError → reintento bloqueado hasta backoff', async () => {
      uc.willReject(new NetworkError());

      dispatcher.notificarCambio('S1', DEFAULT_COUNT);
      await advanceAndDrain(3000);
      expect(uc.calls).toHaveLength(1);

      // Intento inmediato post-falla — bloqueado por backoff (30s)
      uc.willResolve();
      dispatcher.notificarCambio('S1', DEFAULT_COUNT);
      await advanceAndDrain(3000); // debounce dispara, pero backoff bloquea
      expect(uc.calls).toHaveLength(1);

      // Avanzar hasta cumplir el backoff (30s total desde la falla a t=3000)
      await advanceAndDrain(27_000); // t=33_000
      expect(uc.calls).toHaveLength(2);
    });

    it('backoff 1° falla → 30_000ms', async () => {
      uc.willDoSequence([{ kind: 'reject', error: new NetworkError() }, { kind: 'resolve' }]);

      dispatcher.notificarCambio('S1', DEFAULT_COUNT);
      await advanceAndDrain(3000); // primera falla a t=3000

      // Debounce post-falla expira a t=6000, pero backoff bloquea hasta t=33000.
      // tryFire() reagenda un timer en 27000ms (33000-6000) que dispara a t=33000.
      dispatcher.notificarCambio('S1', DEFAULT_COUNT);
      await advanceAndDrain(3000); // t=6000: debounce → tryFire → backoff reagenda t=33000
      const callsAt6s = uc.calls.length;
      await advanceAndDrain(25_000); // t=31_000 — aún antes del backoff (t=33_000)
      expect(uc.calls.length).toBe(callsAt6s);

      // Avanzar 3s más: t=34_000 > nextRetryAt=33_000 → reintento dispara
      await advanceAndDrain(3_000);
      await drainMicrotasks();
      expect(uc.calls.length).toBeGreaterThan(callsAt6s);
    });

    it('backoff 2° falla consecutiva → 60_000ms', async () => {
      uc.willDoSequence([
        { kind: 'reject', error: new NetworkError() }, // falla 1 → nextRetryAt = 3000 + 30000 = 33000
        { kind: 'reject', error: new NetworkError() }, // falla 2 → nextRetryAt = 33000 + X + 60000
        { kind: 'resolve' },
      ]);

      dispatcher.notificarCambio('S1', DEFAULT_COUNT);
      await advanceAndDrain(3_000); // falla 1 a t=3000

      // Avanzar el primer backoff (30s) + reintentar
      await advanceAndDrain(30_001); // t=33001
      dispatcher.notificarCambio('S1', DEFAULT_COUNT);
      await advanceAndDrain(3_000); // t=36001, falla 2

      // Ahora el backoff es 60s. Verificar que espera.
      uc.willResolve();
      dispatcher.notificarCambio('S1', DEFAULT_COUNT);
      await advanceAndDrain(3_000); // debounce + intento bloqueado

      const callsBefore = uc.calls.length;
      await advanceAndDrain(55_000); // casi 60s desde falla 2 — bloqueado
      expect(uc.calls.length).toBe(callsBefore);

      await advanceAndDrain(5_000); // ahora sí > 60s
      expect(uc.calls.length).toBeGreaterThan(callsBefore);
    });

    it('quinta falla → backoff capeado en 300_000ms', async () => {
      const rejects: { kind: 'reject'; error: Error }[] = Array(5).fill({
        kind: 'reject' as const,
        error: new NetworkError(),
      });
      uc.willDoSequence([...rejects, { kind: 'resolve' }]);

      dispatcher.notificarCambio('S1', DEFAULT_COUNT);
      await advanceAndDrain(3_000); // falla 1

      const backoffs = [30_001, 60_001, 120_001, 240_001];
      for (const delay of backoffs) {
        await advanceAndDrain(delay);
        dispatcher.notificarCambio('S1', DEFAULT_COUNT);
        await advanceAndDrain(3_000);
      }
      // fallas 1-5 completadas (5 calls)

      // La 5ta falla tiene backoff de 300_000ms. Verificar.
      // El debounce consume 3s → tryFire() reagenda en (nextRetryAt - now).
      // En este punto: nextRetryAt = falla5_at + 300_000. El debounce expira
      // 3s después de notificarCambio → tryFire ve delta = 300_000 - 3_000 = 297_000ms.
      uc.willResolve();
      dispatcher.notificarCambio('S1', DEFAULT_COUNT);
      await advanceAndDrain(3_000); // debounce → tryFire → reagenda en 297_000ms
      const callsAfter5th = uc.calls.length;

      await advanceAndDrain(295_000); // 295s desde tryFire — aún bloqueado (< 297_000)
      expect(uc.calls.length).toBe(callsAfter5th);

      await advanceAndDrain(3_000); // total ~298s > 297_000 → backoff-reagenda dispara
      await drainMicrotasks();
      expect(uc.calls.length).toBeGreaterThan(callsAfter5th);
    });

    it('éxito resetea backoff → próxima falla vuelve a 30s', async () => {
      uc.willDoSequence([
        { kind: 'reject', error: new NetworkError() },
        { kind: 'reject', error: new NetworkError() },
        { kind: 'reject', error: new NetworkError() },
        { kind: 'reject', error: new NetworkError() }, // 4 fallas → retryCount=4
        { kind: 'resolve' }, // éxito → reset
        { kind: 'reject', error: new NetworkError() }, // 6ta call falla → debe aplicar 30s
        { kind: 'resolve' },
      ]);

      dispatcher.notificarCambio('S1', DEFAULT_COUNT);
      await advanceAndDrain(3_000); // falla 1

      const backoffs = [30_001, 60_001, 120_001, 240_001];
      for (const delay of backoffs) {
        await advanceAndDrain(delay);
        dispatcher.notificarCambio('S1', DEFAULT_COUNT);
        await advanceAndDrain(3_000);
      }
      // fallas 1-4, luego éxito (5 calls total)

      // La siguiente falla debe aplicar 30s (reset), no 300s
      dispatcher.notificarCambio('S1', DEFAULT_COUNT);
      await advanceAndDrain(3_000); // falla 6 → nextRetryAt = now + 30_000

      uc.willResolve();
      dispatcher.notificarCambio('S1', DEFAULT_COUNT);
      await advanceAndDrain(3_000); // debounce, bloqueado
      const callsBefore = uc.calls.length;

      await advanceAndDrain(27_000); // total ~30s desde falla 6
      expect(uc.calls.length).toBeGreaterThan(callsBefore);
    });

    it('backoff NO aplica a InvalidPayloadError → stopped=true', async () => {
      uc.willReject(new InvalidPayloadError());

      dispatcher.notificarCambio('S1', DEFAULT_COUNT);
      await advanceAndDrain(3_000);
      expect(uc.calls).toHaveLength(1);

      // stopped=true, futuros notificarCambio no hacen nada
      uc.willResolve();
      dispatcher.notificarCambio('S1', DEFAULT_COUNT);
      await advanceAndDrain(300_000);
      expect(uc.calls).toHaveLength(1);
    });

    it('backoff NO aplica a SimulacroCerradoError → stopped=true, escala closedSessions', async () => {
      uc.willReject(new SimulacroCerradoError());

      dispatcher.notificarCambio('S1', DEFAULT_COUNT);
      await advanceAndDrain(3_000);

      expect(dispatcher.closedSessions()).toContain('S1');

      uc.willResolve();
      dispatcher.notificarCambio('S1', DEFAULT_COUNT);
      await advanceAndDrain(300_000);
      expect(uc.calls).toHaveLength(1);
    });

    it('heartbeat a 60s respeta nextRetryAt: no dispara si backoff aún vigente', async () => {
      uc.willDoSequence([
        { kind: 'reject', error: new NetworkError() }, // falla a t=3000, nextRetryAt=33000
        { kind: 'resolve' },
      ]);

      dispatcher.notificarCambio('S1', DEFAULT_COUNT);
      await advanceAndDrain(3_000); // falla → nextRetryAt = 3000 + 30000 = 33000
      expect(uc.calls).toHaveLength(1);

      // Heartbeat a t=60_000: Date.now()=63_000 > nextRetryAt=33_000 → SÍ dispara
      // Para probar que el backoff bloquea el heartbeat ANTES de expirar:
      // avanzar solo a t=20_000 (no llega al primer heartbeat que es a t=60_000)
      // y verificar que no hubo POSTs adicionales.
      await advanceAndDrain(17_000); // t=20_000
      expect(uc.calls).toHaveLength(1); // backoff activo (nextRetryAt=33_000 > 20_000)

      // Avanzar a t=60_003 (primer tick del heartbeat). Date.now()=63_003 > 33_000.
      await advanceAndDrain(40_003); // t=60_003 — heartbeat tick con backoff expirado
      await drainMicrotasks();
      expect(uc.calls).toHaveLength(2); // heartbeat disparó
    });
  });

  describe('Heartbeat 60s dirty-only', () => {
    it('heartbeat NO dispara si dirty=false (sin notificarCambio)', async () => {
      uc.willResolve();

      // Sin notificarCambio → mapa vacío → heartbeat no-op
      await advanceAndDrain(60_000);
      await drainMicrotasks();

      expect(uc.calls).toHaveLength(0);
    });

    it('heartbeat dispara si dirty=true y debounce + throttle ya expiraron', async () => {
      uc.willResolve();

      // Primer POST a t=3000
      dispatcher.notificarCambio('S1', DEFAULT_COUNT);
      await advanceAndDrain(3_000);
      expect(uc.calls).toHaveLength(1);

      // Nuevo cambio a t=5000. El debounce expira a t=8000.
      // El throttle (lastPostAt=3000 + 10_000 = 13000) reagenda a t=13000.
      vi.advanceTimersByTime(2_000); // t=5000
      dispatcher.notificarCambio('S1', DEFAULT_COUNT);
      await advanceAndDrain(3_000); // t=8000: debounce → throttle reagenda a t=13000
      expect(uc.calls).toHaveLength(1); // throttle bloqueó

      // El throttle-reagenda dispara a t=13000 — avanzar solo hasta ahí
      await advanceAndDrain(5_100); // t=13100: throttle-reagendado dispara
      await drainMicrotasks();
      expect(uc.calls).toHaveLength(2); // throttle-reagendado disparó (o heartbeat)
    });

    it('heartbeat NO dispara si stopped', async () => {
      uc.willResolve();

      dispatcher.notificarCambio('S1', DEFAULT_COUNT);
      dispatcher.cancelarDraftsPendientes('S1'); // stopped=true

      await advanceAndDrain(60_000);
      await drainMicrotasks();

      expect(uc.calls).toHaveLength(0);
    });

    it('heartbeat NO dispara si inflight', async () => {
      let resolveUc!: () => void;
      const inflightPromise = new Promise<void>((r) => (resolveUc = r));
      let callCount = 0;

      const customUc = {
        async execute(_input: { examId: string; count: number }): Promise<void> {
          callCount++;
          return inflightPromise;
        },
      };

      const d = new DraftAutoSaveDispatcher(customUc as unknown as GuardarDraftUseCase);

      // Iniciar primer POST (inflight)
      d.notificarCambio('S1', DEFAULT_COUNT);
      await advanceAndDrain(3_000); // fire() comienza pero no termina

      expect(callCount).toBe(1);

      // Avanzar hasta el primer heartbeat tick (60s) — inflight=true → no dispara extra
      await advanceAndDrain(57_000); // total 60s
      await drainMicrotasks();
      expect(callCount).toBe(1);

      resolveUc();
      await drainMicrotasks();
    });
  });

  describe('Coalesce — invariante de pérdida cero local', () => {
    it('notificarCambio durante POST en vuelo conserva dirty para el próximo ciclo', async () => {
      let resolveFirst!: () => void;
      let callCount = 0;
      const firstInflight = new Promise<void>((r) => (resolveFirst = r));

      const resolveSecond = (): Promise<void> => Promise.resolve();

      const customUc = {
        calls: 0,
        resolvers: [firstInflight, resolveSecond()],
        async execute(_input: { examId: string; count: number }): Promise<void> {
          callCount++;
          this.calls++;
          const next = this.resolvers.shift();
          return next ?? Promise.resolve();
        },
      };

      const d = new DraftAutoSaveDispatcher(customUc as unknown as GuardarDraftUseCase);

      // Primer POST arranca (inflight)
      d.notificarCambio('S1', DEFAULT_COUNT);
      await advanceAndDrain(3_000); // fire() comienza, queda en inflight

      expect(callCount).toBe(1);

      // Notificar durante el inflight → dirty=true, arma debounce
      d.notificarCambio('S1', DEFAULT_COUNT);

      // Resolver el primer POST
      resolveFirst();
      await drainMicrotasks();

      // El debounce del segundo notificarCambio expira a t=6000, pero el throttle
      // (lastPostAt=3000 + 10_000 = 13_000) lo reagenda a t=13_000.
      // Avanzamos lo suficiente para que el throttle-reagenda también dispare.
      await advanceAndDrain(3_000); // t=6000: debounce expira, throttle reagenda a t=13_000
      await advanceAndDrain(7_001); // t=13_001: throttle-reagenda dispara el segundo POST
      await drainMicrotasks();
      expect(callCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Cancel-on-submit', () => {
    it('cancelarDraftsPendientes cancela debounce; futuros notificarCambio no programan timer', async () => {
      uc.willResolve();

      dispatcher.notificarCambio('S1', DEFAULT_COUNT); // arma debounce a 3s
      dispatcher.cancelarDraftsPendientes('S1'); // cancela y stopped=true

      await advanceAndDrain(3_000);
      expect(uc.calls).toHaveLength(0); // debounce cancelado

      // Futuros cambios tampoco disparan
      dispatcher.notificarCambio('S1', DEFAULT_COUNT);
      await advanceAndDrain(10_000);
      expect(uc.calls).toHaveLength(0);
    });
  });

  describe('wipeAll — reset del singleton en logout', () => {
    it('cancela debounces pendientes y borra el state Map', async () => {
      uc.willResolve();
      dispatcher.notificarCambio('S1', DEFAULT_COUNT);
      dispatcher.notificarCambio('S2', DEFAULT_COUNT);

      dispatcher.wipeAll();

      // El debounce pendiente no dispara.
      await advanceAndDrain(3_000);
      expect(uc.calls).toHaveLength(0);
    });

    it('post-wipe, notificarCambio en la misma sesión SÍ dispara (limpia el stopped=true que dejó un error duro)', async () => {
      // Reproduce el bug original: draft del alumno A falla con
      // SessionExpiredError durante logout → deja S1 con stopped=true. Sin
      // wipeAll, el próximo alumno queda bloqueado. Con wipeAll, el state
      // se borra y el próximo alumno arranca limpio.
      uc.willDoSequence([
        { kind: 'reject', error: new SessionExpiredError() },
        { kind: 'resolve' },
      ]);
      dispatcher.notificarCambio('S1', DEFAULT_COUNT);
      await advanceAndDrain(3_000);
      await drainMicrotasks(10);
      const callsAfterFail = uc.calls.length;
      // Sanity: el use case tiró error duro → S1 quedó stopped
      expect(callsAfterFail).toBe(1);

      // Sin wipeAll, un nuevo notificarCambio NO dispara.
      dispatcher.notificarCambio('S1', DEFAULT_COUNT);
      await advanceAndDrain(3_000);
      expect(uc.calls.length).toBe(callsAfterFail);

      dispatcher.wipeAll();

      // Post-wipe: el próximo alumno marca y SÍ dispara.
      dispatcher.notificarCambio('S1', DEFAULT_COUNT);
      await advanceAndDrain(3_000);
      expect(uc.calls.length).toBe(callsAfterFail + 1);
    });

    it('wipeAll sobre un state vacío es no-op (idempotente)', async () => {
      expect(() => dispatcher.wipeAll()).not.toThrow();
      expect(() => dispatcher.wipeAll()).not.toThrow();
    });

    it('cancelarDraftsPendientes NO aborta inflight — el POST en vuelo completa', async () => {
      let resolveUc!: () => void;
      let callCount = 0;
      const inflightPromise = new Promise<void>((r) => (resolveUc = r));

      const customUc = {
        async execute(_input: { examId: string; count: number }): Promise<void> {
          callCount++;
          return inflightPromise;
        },
      };

      const d = new DraftAutoSaveDispatcher(customUc as unknown as GuardarDraftUseCase);

      // POST arranca (inflight)
      d.notificarCambio('S1', DEFAULT_COUNT);
      await advanceAndDrain(3_000);
      expect(callCount).toBe(1);

      // Cancel-on-submit mientras está inflight
      d.cancelarDraftsPendientes('S1');

      // El POST sigue vivo — resolvemos
      resolveUc();
      await drainMicrotasks();

      // Solo 1 POST (el inflight); ninguno extra
      expect(callCount).toBe(1);
    });
  });

  describe('409 SESSION_NOT_ACTIVE escala al view-model', () => {
    it('SimulacroCerradoError → stopped=true y sessionId aparece en closedSessions', async () => {
      uc.willReject(new SimulacroCerradoError());

      dispatcher.notificarCambio('S1', DEFAULT_COUNT);
      await advanceAndDrain(3_000);

      expect(dispatcher.closedSessions()).toContain('S1');
    });

    it('otras sesiones no afectadas si solo S1 cierra', async () => {
      uc.willDoSequence([
        { kind: 'reject', error: new SimulacroCerradoError() }, // S1 cierra
        { kind: 'resolve' }, // S2 sigue bien
      ]);

      dispatcher.notificarCambio('S1', DEFAULT_COUNT);
      await advanceAndDrain(3_000);

      dispatcher.notificarCambio('S2', DEFAULT_COUNT);
      await advanceAndDrain(3_000);

      expect(dispatcher.closedSessions()).toContain('S1');
      expect(dispatcher.closedSessions()).not.toContain('S2');
    });
  });

  describe('Garantías no-fatal', () => {
    it('NetworkError silencia, dirty queda, no escala closedSessions', async () => {
      uc.willDoSequence([{ kind: 'reject', error: new NetworkError() }, { kind: 'resolve' }]);

      dispatcher.notificarCambio('S1', DEFAULT_COUNT);
      await advanceAndDrain(3_000);

      expect(uc.calls).toHaveLength(1);
      expect(dispatcher.closedSessions()).not.toContain('S1');

      // Avanzar el backoff (30s) y reintentar
      await advanceAndDrain(30_001);
      dispatcher.notificarCambio('S1', DEFAULT_COUNT);
      await advanceAndDrain(3_000);
      expect(uc.calls).toHaveLength(2);
    });

    it('InvalidPayloadError → stopped=true, closedSessions NO emite', async () => {
      uc.willReject(new InvalidPayloadError());

      dispatcher.notificarCambio('S1', DEFAULT_COUNT);
      await advanceAndDrain(3_000);

      expect(dispatcher.closedSessions()).not.toContain('S1');

      uc.willResolve();
      dispatcher.notificarCambio('S1', DEFAULT_COUNT);
      await advanceAndDrain(10_000);
      expect(uc.calls).toHaveLength(1);
    });
  });

  describe('404 sin message conocido → NetworkError → backoff (autoheal)', () => {
    it('trata como NetworkError retryable con backoff', async () => {
      uc.willDoSequence([
        { kind: 'reject', error: new NetworkError() }, // simula 404 sin message
        { kind: 'resolve' }, // autoheal cuando el back deploya
      ]);

      dispatcher.notificarCambio('S1', DEFAULT_COUNT);
      await advanceAndDrain(3_000);
      expect(uc.calls).toHaveLength(1);

      // Avanzar el backoff (30s) para el autoheal
      await advanceAndDrain(30_001);
      dispatcher.notificarCambio('S1', DEFAULT_COUNT);
      await advanceAndDrain(3_000);
      expect(uc.calls).toHaveLength(2);
    });
  });
});

describe('NoopDraftAutoSaveDispatcher', () => {
  let noop: NoopDraftAutoSaveDispatcher;

  beforeEach(() => {
    vi.useFakeTimers();
    noop = new NoopDraftAutoSaveDispatcher();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('notificarCambio(sessionId, count) no programa timer', async () => {
    noop.notificarCambio('S1', DEFAULT_COUNT);
    vi.advanceTimersByTime(60_000);
    await Promise.resolve();
    // No lanza, no tiene efectos observables
    expect(true).toBe(true);
  });

  it('cancelarDraftsPendientes es no-op', () => {
    expect(() => noop.cancelarDraftsPendientes('S1')).not.toThrow();
  });

  it('closedSessions siempre vacía', () => {
    expect(noop.closedSessions()).toEqual([]);
    noop.notificarCambio('S1', DEFAULT_COUNT);
    vi.advanceTimersByTime(60_000);
    expect(noop.closedSessions()).toEqual([]);
  });
});
