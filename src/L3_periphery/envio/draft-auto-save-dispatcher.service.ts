// DraftAutoSaveDispatcher — auto-save progresivo de snapshots de marcaciones.
//
// DIFERENCIA CON EnvioRetryDispatcher (design.md D1/D8):
//   - EnvioRetryDispatcher: exactly-once durable. Drena outbox IDB, arranca
//     en APP_INITIALIZER, debe estar vivo desde el bootstrap para colas previas.
//   - DraftAutoSaveDispatcher: best-effort efímero. Sin cola, sin durabilidad,
//     arranca LAZY desde el view-model al primer notificarCambio(). El heartbeat
//     corre en el constructor pero no-op'ea mientras el mapa esté vacío.
//     NO se invoca desde APP_INITIALIZER.
//
// Estado por sessionId (design.md D2): evita que sesiones previas arrastren
// `stopped=true` a una sesión nueva. El alumno puede navegar a /home y abrir
// otro examen; el dispatcher reutiliza la misma instancia sin contaminación.
//
// Backoff exponencial (design.md D11): NetworkError → espera creciente antes
// del próximo intento. Reset en éxito. Cobre deploy-pendiente + caídas transitorias
// bajo la misma rama. Techo: 5 min. Errores duros → stopped=true, sin backoff.

import { Injectable, Signal, signal } from '@angular/core';
import { GuardarDraftUseCase } from '../../L2_application/use-cases/guardar-draft.use-case';
import { NetworkError } from '../../L1_domain/errors/network.error';
import { SimulacroCerradoError } from '../../L1_domain/errors/simulacro-cerrado.error';
import { InvalidPayloadError } from '../../L1_domain/errors/invalid-payload.error';
import { StudentNotEnrolledError } from '../../L1_domain/errors/student-not-enrolled.error';
import { SimulacroNoAsignadoError } from '../../L1_domain/errors/simulacro-no-asignado.error';
import { StudentNotLinkedError } from '../../L1_domain/errors/student-not-linked.error';
import { SessionExpiredError } from '../../L1_domain/errors/session-expired.error';

// Interfaz pública del dispatcher. Implementada tanto por el real como por el
// stub no-op (NoopDraftAutoSaveDispatcher) para que el view-model no conozca
// qué está inyectado.
export interface IDraftAutoSaveDispatcher {
  // `count` es Exam.count del simulacro activo. El dispatcher lo persiste en
  // DraftState y el use case lo necesita para armar el string compacto de
  // longitud fija (design.md D12). El view-model lo conoce desde el Exam
  // cargado y lo pasa en cada notificarCambio (idempotente).
  notificarCambio(sessionId: string, count: number): void;
  cancelarDraftsPendientes(sessionId: string): void;
  // Signal de sessionIds donde el back devolvió 409 SESSION_NOT_ACTIVE.
  // El view-model observa este signal con effect() para disparar el flujo
  // "cerrado" + redirect a /home.
  readonly closedSessions: Signal<readonly string[]>;
}

// Estado interno por sessionId. Ver design.md D2 + D3 + D11 + D12.
interface DraftState {
  count: number; // Exam.count, requerido por el use case para armar el string fijo (D12)
  dirty: boolean;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  lastPostAt: number;
  inflight: boolean;
  stopped: boolean;
  // Backoff (design.md D11):
  retryCount: number; // fallos consecutivos sin éxito (0 = ninguno)
  nextRetryAt: number | null; // timestamp mínimo del próximo intento (null = sin restricción)
}

// Schedule de espera ascendente para fallos retryable (design.md D11).
// Índice = retryCount - 1 (capeado en length-1).
// Reset on success: apenas llega 204, retryCount=0 y nextRetryAt=null.
const BACKOFF_SCHEDULE_MS = [30_000, 60_000, 120_000, 240_000, 300_000] as const;

const DEBOUNCE_MS = 3_000;
const THROTTLE_MS = 10_000;
const HEARTBEAT_MS = 60_000;

// NO providedIn: 'root' — esta clase es instanciada por factory en app.config.ts
// (design.md D7) con el useCase real o el stub NoopDraftAutoSaveDispatcher.
// La factory inyecta GuardarDraftUseCase y decide qué instancia proveer
// según environment.draftEnabled.
export class DraftAutoSaveDispatcher implements IDraftAutoSaveDispatcher {
  private readonly state = new Map<string, DraftState>();

  // Signal mutable internamente; expuesto como readonly al exterior.
  private readonly _closedSessions = signal<readonly string[]>([]);
  readonly closedSessions: Signal<readonly string[]> = this._closedSessions.asReadonly();

  constructor(private readonly useCase: GuardarDraftUseCase) {
    // Heartbeat global. Recorre el mapa en cada tick y dispara fire() solo si
    // hay algo que flushear. Si el mapa está vacío, no-op silencioso.
    setInterval(() => {
      const now = Date.now();
      for (const [sessionId, st] of this.state.entries()) {
        if (
          st.dirty &&
          !st.inflight &&
          !st.stopped &&
          (st.nextRetryAt === null || now >= st.nextRetryAt)
        ) {
          void this.fire(sessionId);
        }
      }
    }, HEARTBEAT_MS);
  }

  // Notifica al dispatcher que hubo un cambio en las marcaciones del sessionId.
  // Crea la entrada en el mapa si no existe (lazy). Persiste `count` en el state
  // (idempotente: si cambió entre llamadas, actualiza). Resetea el debounce.
  notificarCambio(sessionId: string, count: number): void {
    let st = this.state.get(sessionId);
    if (st === undefined) {
      st = {
        count,
        dirty: false,
        debounceTimer: null,
        lastPostAt: 0,
        inflight: false,
        stopped: false,
        retryCount: 0,
        nextRetryAt: null,
      };
      this.state.set(sessionId, st);
    } else {
      // Actualización idempotente del count (defensivo, no debería cambiar
      // mid-sesión; el Exam.count es estable).
      st.count = count;
    }

    st.dirty = true;
    if (st.stopped) return;

    if (st.debounceTimer !== null) {
      clearTimeout(st.debounceTimer);
    }
    st.debounceTimer = setTimeout(() => {
      st.debounceTimer = null;
      this.tryFire(sessionId);
    }, DEBOUNCE_MS);
  }

  // Cancela el debounce pendiente y marca la sesión como stopped. Llamado
  // antes del submit o al destruir el view-model (stop()). Design.md R2/R4:
  // NO toca inflight — el POST en vuelo llega al back; si el submit ya escribió
  // `final` en Redis, el back responde 204 no-op silent. Aceptable por contrato.
  cancelarDraftsPendientes(sessionId: string): void {
    const st = this.state.get(sessionId);
    if (st === undefined) return;
    if (st.debounceTimer !== null) {
      clearTimeout(st.debounceTimer);
      st.debounceTimer = null;
    }
    st.stopped = true;
  }

  // Gate previo a fire(). Evalúa backoff ANTES de throttle (design.md D3/D11):
  //   1. Si nextRetryAt está en el futuro → reagendar al delta restante (backoff).
  //   2. Si lastPostAt + 10s está en el futuro → reagendar al delta restante (throttle).
  //   3. En otro caso → fire().
  private tryFire(sessionId: string): void {
    const st = this.state.get(sessionId);
    if (!st || st.stopped) return;

    const now = Date.now();

    // Gate 1: backoff (D11) — prioridad sobre throttle.
    if (st.nextRetryAt !== null && now < st.nextRetryAt) {
      const delta = st.nextRetryAt - now;
      setTimeout(() => this.tryFire(sessionId), delta);
      return;
    }

    // Gate 2: throttle (D3) — mínimo 10s entre POSTs exitosos.
    const sinceLast = now - st.lastPostAt;
    if (sinceLast < THROTTLE_MS) {
      const delta = THROTTLE_MS - sinceLast;
      setTimeout(() => this.tryFire(sessionId), delta);
      return;
    }

    void this.fire(sessionId);
  }

  // Dispara el POST real. Orden crítico de dirty=false ANTES de leer IDB
  // (design.md D3 Coalesce): si llega un notificarCambio durante el POST,
  // vuelve a poner dirty=true y el próximo ciclo dispara otra ronda.
  private async fire(sessionId: string): Promise<void> {
    const st = this.state.get(sessionId);
    if (!st) return;
    if (st.inflight || !st.dirty || st.stopped) return;

    st.inflight = true;
    st.dirty = false; // CRÍTICO: bajar dirty ANTES de leer IDB (ver Coalesce)

    try {
      await this.useCase.execute({ examId: sessionId, count: st.count });
      // Éxito (204): actualizar lastPostAt y resetear backoff.
      st.lastPostAt = Date.now();
      st.retryCount = 0;
      st.nextRetryAt = null;
    } catch (e) {
      if (e instanceof SimulacroCerradoError) {
        // 409 SESSION_NOT_ACTIVE: parar definitivamente y escalar al view-model.
        st.stopped = true;
        this._closedSessions.update((prev) => [...prev, sessionId]);
      } else if (e instanceof NetworkError) {
        // Retryable (0/429/5xx/timeout/403 genérico/404 sin message): backoff.
        // Restauramos dirty=true para que el heartbeat (o el reagenda de tryFire)
        // pueda disparar el reintento sin depender de un nuevo notificarCambio.
        // Si notificarCambio ya lo subió a true durante el inflight, no pisa nada.
        st.dirty = true;
        st.retryCount += 1;
        st.nextRetryAt = Date.now() + this.backoffDelay(st.retryCount);
        // NO marca stopped.
      } else if (
        e instanceof InvalidPayloadError ||
        e instanceof StudentNotEnrolledError ||
        e instanceof SimulacroNoAsignadoError ||
        e instanceof StudentNotLinkedError ||
        e instanceof SessionExpiredError
      ) {
        // Errores duros de contrato: parar sin escalar. El submit final
        // hablará si el problema persiste. NO usar backoff.
        st.stopped = true;
      }
      // Cualquier otro error desconocido: tratarlo como NetworkError silencioso.
      // (No debería ocurrir con el clasificador actual, pero defensa defensiva.)
    } finally {
      st.inflight = false;
    }
  }

  // Calcula el delay de backoff para retryCount > 0 (design.md D11).
  // BACKOFF_SCHEDULE_MS[min(retryCount-1, 4)]:
  //   1° falla → 30s, 2° → 60s, 3° → 2min, 4° → 4min, 5°+ → 5min (techo).
  // Reset on success garantiza que un hipo de 1 minuto no deja esperas largas
  // pegadas por el resto del examen.
  private backoffDelay(retryCount: number): number {
    if (retryCount <= 0) return 0;
    return BACKOFF_SCHEDULE_MS[Math.min(retryCount - 1, BACKOFF_SCHEDULE_MS.length - 1)];
  }
}

// Stub no-op para cuando DRAFT_ENABLED=false. Implementa la misma interfaz
// pública con métodos vacíos y signal que nunca emite. El view-model llama
// los métodos sin condicional — el provider decide qué instancia inyectar.
// (design.md D7) — también instanciada via factory en app.config.ts.
@Injectable({ providedIn: 'root' })
export class NoopDraftAutoSaveDispatcher implements IDraftAutoSaveDispatcher {
  readonly closedSessions: Signal<readonly string[]> = signal<readonly string[]>([]).asReadonly();

  notificarCambio(_sessionId: string, _count: number): void {
    // no-op
  }

  cancelarDraftsPendientes(_sessionId: string): void {
    // no-op
  }
}
