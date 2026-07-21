import { describe, it, expect, beforeEach } from 'vitest';
import { GetAulaSemanasUseCase } from '../../../../src/L2_application/use-cases/get-aula-semanas.use-case';
import {
  TutorNavigationApi,
  type AulaSemanasResult,
  type AulaSemanaExamenesResult,
  type ExamsEnCursoResult,
} from '../../../../src/L1_domain/ports/tutor-navigation-api';
import { AulaSemana } from '../../../../src/L1_domain/entities/aula-semana';
import { Clock } from '../../../../src/L1_domain/ports/clock';
import { ServerTime } from '../../../../src/L1_domain/value-objects/server-time';

// Fake minimal del port — solo el método que este use case usa.
class FakeApi implements TutorNavigationApi {
  private _next: AulaSemanasResult | null = null;
  private _calls: string[] = [];

  seed(result: AulaSemanasResult): void {
    this._next = result;
  }

  calls(): readonly string[] {
    return this._calls;
  }

  async getAulaSemanas(classroomId: string): Promise<AulaSemanasResult> {
    this._calls.push(classroomId);
    if (!this._next) throw new Error('FakeApi not seeded');
    return this._next;
  }

  async getAulaSemanaExamenes(): Promise<AulaSemanaExamenesResult> {
    throw new Error('not used');
  }

  async getExamsEnCurso(): Promise<ExamsEnCursoResult> {
    throw new Error('not used');
  }
}

class SpyClock implements Clock {
  private _lastAnchor: ServerTime | null = null;

  now(): Date {
    return new Date(0);
  }

  setServerTime(serverTime: ServerTime): void {
    this._lastAnchor = serverTime;
  }

  lastAnchor(): ServerTime | null {
    return this._lastAnchor;
  }
}

const CLASSROOM_ID = 'classroom-uuid-1';

function buildResult(): AulaSemanasResult {
  return {
    serverTime: new ServerTime('2026-07-21T14:35:55.000Z'),
    cycle: { id: 'cy-1', name: 'Ciclo Test' },
    classroom: { id: CLASSROOM_ID, code: 'A-101', name: 'Aula Test' },
    semanas: [
      new AulaSemana({
        periodId: 'p-1',
        name: 'Semana 1',
        order: 1,
        startDate: '2026-03-16',
        endDate: '2026-03-20',
        examCount: 4,
        byStatus: { scheduled: 4, in_progress: 0, finalized: 0 },
      }),
    ],
  };
}

describe('GetAulaSemanasUseCase', () => {
  let api: FakeApi;
  let clock: SpyClock;
  let useCase: GetAulaSemanasUseCase;

  beforeEach(() => {
    api = new FakeApi();
    clock = new SpyClock();
    useCase = new GetAulaSemanasUseCase(api, clock);
  });

  it('llama al port con classroomId y devuelve el result', async () => {
    api.seed(buildResult());
    const result = await useCase.execute(CLASSROOM_ID);
    expect(api.calls()).toEqual([CLASSROOM_ID]);
    expect(result.classroom.id).toBe(CLASSROOM_ID);
    expect(result.semanas.length).toBe(1);
  });

  it('ancla el Clock con el serverTime del response', async () => {
    api.seed(buildResult());
    await useCase.execute(CLASSROOM_ID);
    expect(clock.lastAnchor()?.value.toISOString()).toBe('2026-07-21T14:35:55.000Z');
  });

  it('propaga el error si el port falla y NO ancla el reloj', async () => {
    // sin seed → FakeApi lanza
    await expect(useCase.execute(CLASSROOM_ID)).rejects.toThrow('FakeApi not seeded');
    expect(clock.lastAnchor()).toBeNull();
  });
});
