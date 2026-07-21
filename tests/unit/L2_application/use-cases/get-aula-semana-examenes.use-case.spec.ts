import { describe, it, expect, beforeEach } from 'vitest';
import { GetAulaSemanaExamenesUseCase } from '../../../../src/L2_application/use-cases/get-aula-semana-examenes.use-case';
import {
  TutorNavigationApi,
  type AulaSemanaExamenesResult,
  type AulaSemanasResult,
  type ExamsEnCursoResult,
} from '../../../../src/L1_domain/ports/tutor-navigation-api';
import { AulaSemanaExamGrupo } from '../../../../src/L1_domain/entities/aula-semana-exam-grupo';
import { Clock } from '../../../../src/L1_domain/ports/clock';
import { ServerTime } from '../../../../src/L1_domain/value-objects/server-time';

class FakeApi implements TutorNavigationApi {
  private _next: AulaSemanaExamenesResult | null = null;
  private _calls: { classroomId: string; periodId: string }[] = [];

  seed(result: AulaSemanaExamenesResult): void {
    this._next = result;
  }

  calls() {
    return this._calls;
  }

  async getAulaSemanas(): Promise<AulaSemanasResult> {
    throw new Error('not used');
  }

  async getAulaSemanaExamenes(
    classroomId: string,
    periodId: string,
  ): Promise<AulaSemanaExamenesResult> {
    this._calls.push({ classroomId, periodId });
    if (!this._next) throw new Error('FakeApi not seeded');
    return this._next;
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
const PERIOD_ID = 'period-uuid-1';

function buildResult(): AulaSemanaExamenesResult {
  return {
    serverTime: new ServerTime('2026-07-21T14:35:55.000Z'),
    week: {
      periodId: PERIOD_ID,
      name: 'Semana 5',
      startDate: '2026-04-13',
      endDate: '2026-04-17',
    },
    classroom: { id: CLASSROOM_ID, code: 'A-101', name: 'Aula Test' },
    cursos: [
      new AulaSemanaExamGrupo({
        courseId: 'course-1',
        course: 'ÁLGEBRA',
        area: 'Números',
        examenes: [],
      }),
    ],
  };
}

describe('GetAulaSemanaExamenesUseCase', () => {
  let api: FakeApi;
  let clock: SpyClock;
  let useCase: GetAulaSemanaExamenesUseCase;

  beforeEach(() => {
    api = new FakeApi();
    clock = new SpyClock();
    useCase = new GetAulaSemanaExamenesUseCase(api, clock);
  });

  it('reenvía ambos params al port y devuelve el result', async () => {
    api.seed(buildResult());
    const result = await useCase.execute(CLASSROOM_ID, PERIOD_ID);
    expect(api.calls()).toEqual([{ classroomId: CLASSROOM_ID, periodId: PERIOD_ID }]);
    expect(result.week.periodId).toBe(PERIOD_ID);
  });

  it('ancla el Clock con el serverTime del response', async () => {
    api.seed(buildResult());
    await useCase.execute(CLASSROOM_ID, PERIOD_ID);
    expect(clock.lastAnchor()?.value.toISOString()).toBe('2026-07-21T14:35:55.000Z');
  });
});
