import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProgramarAutoEnvioUseCase } from '../../../src/L2_application/use-cases/programar-auto-envio.use-case';
import { EnviarSimulacroUseCase } from '../../../src/L2_application/use-cases/enviar-simulacro.use-case';
import { Exam } from '../../../src/L1_domain/entities/exam';
import { ExamServerStatus } from '../../../src/L1_domain/value-objects/exam-server-status';
import { ServerTime } from '../../../src/L1_domain/value-objects/server-time';
import { SubmissionAck } from '../../../src/L1_domain/value-objects/submission-ack';
import { FakeClock, FakeExamsApi, FakeIdentityStorage, InMemoryMarkingsStorage } from './fakes';

const VALID_HASH = 'a3f5c8d1b2e4f6a8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

// Stub mínimo del EnviarSimulacroUseCase para tests del programador: nos
// importa SOLO si .execute() fue invocado y con qué input. Usamos una
// subclase para preservar el tipo. La implementación real se cubre en
// `enviar-simulacro.use-case.spec.ts`.
class StubEnviarSimulacroUseCase extends EnviarSimulacroUseCase {
  public calls: { examId: string; override?: Date }[] = [];
  private mode: 'resolve' | 'reject' = 'resolve';
  private nextError: Error | null = null;

  constructor() {
    super(
      new FakeExamsApi(),
      new InMemoryMarkingsStorage(),
      new FakeClock(),
      new FakeIdentityStorage(),
    );
  }

  willResolve(): void {
    this.mode = 'resolve';
  }

  willReject(error: Error): void {
    this.mode = 'reject';
    this.nextError = error;
  }

  override async execute(input: {
    examId: string;
    clientFinishedAtOverride?: Date;
  }): Promise<{ status: 'enviado' | 'queued'; ack: SubmissionAck | null }> {
    this.calls.push({
      examId: input.examId,
      override: input.clientFinishedAtOverride,
    });
    if (this.mode === 'reject' && this.nextError !== null) {
      throw this.nextError;
    }
    const submittedAt = input.clientFinishedAtOverride ?? new Date();
    return {
      status: 'enviado',
      ack: new SubmissionAck('ack-1', VALID_HASH, submittedAt),
    };
  }
}

// Cubre `ProgramarAutoEnvioUseCase` (L2):
// - Auto-envío a (started ?? scheduled) + duration*1000 con jitter ±3s.
// - clientFinishedAtOverride = cierre exacto, NO el momento del disparo.
// - El factor en el cálculo del cierre es ×1000 (segundos), NUNCA ×60000.
describe('ProgramarAutoEnvioUseCase', () => {
  let enviar: StubEnviarSimulacroUseCase;
  let clock: FakeClock;
  let useCase: ProgramarAutoEnvioUseCase;

  const NOW_ISO = '2026-06-11T08:00:00.000Z';
  // started 30s antes de now. Con duration 90s, el cierre cae 60s después de now.
  const STARTED_ISO = '2026-06-11T07:59:30.000Z';
  // scheduled 60s antes de started — usado en escenarios de fallback (started null).
  const SCHEDULED_ISO = '2026-06-11T07:58:30.000Z';

  const buildExam = (
    overrides: Partial<{
      started: Date | null;
      scheduled: Date;
      duration: number;
      serverStatusValue: 'scheduled' | 'in_progress' | 'finalized';
    }> = {},
  ): Exam => {
    const statusValue = overrides.serverStatusValue ?? 'in_progress';
    return new Exam({
      id: 'exam-1',
      area: 'Matemática',
      course: null,
      type: 'simulacro',
      name: 'Examen 1',
      count: 20,
      duration: overrides.duration ?? 90,
      scheduled: overrides.scheduled ?? new Date(SCHEDULED_ISO),
      started: 'started' in overrides ? (overrides.started ?? null) : new Date(STARTED_ISO),
      finished: null,
      openUntil: null,
      serverStatus: new ExamServerStatus(statusValue),
    });
  };

  beforeEach(() => {
    enviar = new StubEnviarSimulacroUseCase();
    clock = new FakeClock();
    clock.setServerTime(new ServerTime(NOW_ISO));
    useCase = new ProgramarAutoEnvioUseCase(enviar, clock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('disparo del timer — in_progress con started', () => {
    it('al cumplirse delay (60s + jitter=0), invoca enviar.execute con override = (started + duration*1000)', async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, 'random').mockReturnValue(0.5); // jitter=0
      const exam = buildExam(); // started=NOW-30s, duration=90s → cierre = NOW+60s
      enviar.willResolve();

      useCase.execute({ exam });

      // Aún no llegó el tiempo: 0 calls.
      expect(enviar.calls).toHaveLength(0);

      // Avanzamos 63s para cubrir cualquier jitter posible.
      await vi.advanceTimersByTimeAsync(63_000);

      expect(enviar.calls).toHaveLength(1);
      expect(enviar.calls[0].examId).toBe('exam-1');
      expect(enviar.calls[0].override).toBeInstanceOf(Date);
      // Crítico: override === started + duration*1000 = NOW+60s (NO el momento del disparo).
      const expectedClose = new Date(STARTED_ISO).getTime() + 90 * 1000;
      expect(enviar.calls[0].override?.getTime()).toBe(expectedClose);
    });

    it('cancel() antes del fire NO invoca enviar.execute', async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const exam = buildExam();
      enviar.willResolve();

      const handle = useCase.execute({ exam });
      handle.cancel();

      await vi.advanceTimersByTimeAsync(63_000);

      expect(enviar.calls).toHaveLength(0);
    });

    it('onResult callback se invoca con el resultado del enviar', async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const exam = buildExam();
      enviar.willResolve();
      const results: { status: string; ack: SubmissionAck | null }[] = [];

      useCase.execute({
        exam,
        onResult: (r) => results.push(r),
      });

      await vi.advanceTimersByTimeAsync(63_000);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('enviado');
      // El stub setea ack.submittedAt = override → verificamos que el override
      // recibido por enviar.execute es exactamente started + duration*1000.
      const expectedCloseMs = new Date(STARTED_ISO).getTime() + 90 * 1000;
      expect(results[0].ack?.submittedAt.getTime()).toBe(expectedCloseMs);
    });

    it('onError callback se invoca cuando enviar lanza', async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const exam = buildExam();
      const boom = new Error('boom!');
      enviar.willReject(boom);
      const errors: unknown[] = [];

      useCase.execute({
        exam,
        onError: (e) => errors.push(e),
      });

      await vi.advanceTimersByTimeAsync(63_000);

      expect(errors).toEqual([boom]);
    });
  });

  describe('cierre ya pasó al programar (alumno entró tarde)', () => {
    it('NO programa timer cuando effectiveCloseAt ya quedó en el pasado', async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      // Examen "in_progress" cuyo started+duration cae 5 minutos antes de NOW.
      // El back todavía no procesó el cierre (finished sigue null) pero el
      // reloj cliente ya lo cruzó. NO disparamos auto-envío inmediato.
      const startedAncient = new Date(new Date(NOW_ISO).getTime() - 10 * 60 * 1000);
      const exam = buildExam({
        scheduled: startedAncient,
        started: startedAncient,
        duration: 5 * 60, // 5 min: closeAt = startedAncient + 5min = NOW-5min
      });
      enviar.willResolve();

      const handle = useCase.execute({ exam });

      // Avanzamos tiempo más que suficiente para cubrir cualquier timer.
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);

      expect(enviar.calls).toHaveLength(0);
      expect(() => handle.cancel()).not.toThrow();
    });
  });

  describe('examen aún no activado (started y finished ambos null)', () => {
    // `Exam.effectiveCloseAt()` retorna null cuando no es determinable. El
    // use case NO debe programar timer en ese caso — el polling de /home
    // refrescará la lista cuando el tutor active y se programará entonces.
    it('NO programa timer cuando effectiveCloseAt es null', async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const exam = buildExam({
        scheduled: new Date(SCHEDULED_ISO),
        started: null,
        duration: 180,
        serverStatusValue: 'scheduled',
      });
      enviar.willResolve();

      const handle = useCase.execute({ exam });

      // Avanzamos hora suficiente para cubrir cualquier delay imaginable —
      // si hubo timer programado, dispararía dentro de este lapso.
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);

      // 0 invocaciones: el use case detectó null y devolvió handle no-op.
      expect(enviar.calls).toHaveLength(0);
      // cancel() del handle no-op no debe explotar.
      expect(() => handle.cancel()).not.toThrow();
    });
  });

  describe('factor ×1000 (segundos, NO minutos)', () => {
    // GUARDIÁN crítico contra regresión a ×60_000 (la fórmula vieja de
    // Fase 2 cuando `duration` venía en minutos). Si alguien revierte
    // a ×60_000, este test falla en segundos.
    it('duration=60 (segundos) con started=NOW dispara a NOW+60s — NO NOW+3600s', async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const exam = buildExam({
        started: new Date(NOW_ISO),
        scheduled: new Date(NOW_ISO),
        duration: 60,
      });
      enviar.willResolve();

      useCase.execute({ exam });

      // Si fuera ×60_000, el delay sería 3600_000ms. Confirmamos que a los
      // 59999ms aún no disparó y a los 60000ms sí.
      await vi.advanceTimersByTimeAsync(59_999);
      expect(enviar.calls).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(enviar.calls).toHaveLength(1);

      // Override exacto = started + 60_000ms (NO + 3_600_000ms).
      const expected = new Date(NOW_ISO).getTime() + 60_000;
      expect(enviar.calls[0].override?.getTime()).toBe(expected);
    });
  });

  describe('jitter', () => {
    // El jitter es: (Math.random() * 2 - 1) * 3000.
    //   X=0.5 → jitter = 0
    //   X=1.0 → jitter = +3000
    //   X=0.0 → jitter = -3000
    // Con exam donde started=NOW-30s y duration=90 → cierre = NOW+60s.
    // Verificamos el delay efectivo por cuándo el timer dispara.

    it('Math.random=0.5 → jitter=0, delay = 60_000ms exactos', async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const exam = buildExam();
      enviar.willResolve();

      useCase.execute({ exam });

      await vi.advanceTimersByTimeAsync(59_999);
      expect(enviar.calls).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(enviar.calls).toHaveLength(1);
    });

    it('Math.random=1.0 → jitter=+3000, delay = 63_000ms', async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, 'random').mockReturnValue(1.0);
      const exam = buildExam();
      enviar.willResolve();

      useCase.execute({ exam });

      await vi.advanceTimersByTimeAsync(62_999);
      expect(enviar.calls).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(enviar.calls).toHaveLength(1);
    });

    it('Math.random=0.0 → jitter=-3000, delay = 57_000ms', async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, 'random').mockReturnValue(0.0);
      const exam = buildExam();
      enviar.willResolve();

      useCase.execute({ exam });

      await vi.advanceTimersByTimeAsync(56_999);
      expect(enviar.calls).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(enviar.calls).toHaveLength(1);
    });
  });
});
