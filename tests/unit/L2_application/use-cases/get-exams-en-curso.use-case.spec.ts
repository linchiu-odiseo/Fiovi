import { describe, it, expect, beforeEach } from 'vitest';
import { GetExamsEnCursoUseCase } from '../../../../src/L2_application/use-cases/get-exams-en-curso.use-case';
import {
  TutorNavigationApi,
  type AulaSemanaExamenesResult,
  type AulaSemanasResult,
  type ExamsEnCursoResult,
} from '../../../../src/L1_domain/ports/tutor-navigation-api';
import { ExamEnCurso } from '../../../../src/L1_domain/entities/exam-en-curso';
import { Clock } from '../../../../src/L1_domain/ports/clock';
import { ServerTime } from '../../../../src/L1_domain/value-objects/server-time';

class FakeApi implements TutorNavigationApi {
  private _next: ExamsEnCursoResult | null = null;
  private _calls = 0;

  seed(result: ExamsEnCursoResult): void {
    this._next = result;
  }

  callCount(): number {
    return this._calls;
  }

  async getAulaSemanas(): Promise<AulaSemanasResult> {
    throw new Error('not used');
  }

  async getAulaSemanaExamenes(): Promise<AulaSemanaExamenesResult> {
    throw new Error('not used');
  }

  async getExamsEnCurso(): Promise<ExamsEnCursoResult> {
    this._calls++;
    if (!this._next) throw new Error('FakeApi not seeded');
    return this._next;
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

function buildItem(classroomId: string): ExamEnCurso {
  return new ExamEnCurso({
    id: 'ex-1',
    recordId: 'rec-1',
    classroomId,
    classroomCode: 'A-101',
    classroomName: 'Aula Test',
    name: 'Exam',
    course: 'ÁLGEBRA',
    area: 'Números',
    count: 4,
    duration: 900,
    startedAt: new Date('2026-07-21T14:00:00Z'),
    openUntil: null,
  });
}

describe('GetExamsEnCursoUseCase', () => {
  let api: FakeApi;
  let clock: SpyClock;
  let useCase: GetExamsEnCursoUseCase;

  beforeEach(() => {
    api = new FakeApi();
    clock = new SpyClock();
    useCase = new GetExamsEnCursoUseCase(api, clock);
  });

  it('devuelve items del port y ancla el Clock con serverTime', async () => {
    api.seed({
      serverTime: new ServerTime('2026-07-21T14:35:55.000Z'),
      items: [buildItem('cls-1'), buildItem('cls-2')],
    });
    const result = await useCase.execute();
    expect(api.callCount()).toBe(1);
    expect(result.items).toHaveLength(2);
    expect(clock.lastAnchor()?.value.toISOString()).toBe('2026-07-21T14:35:55.000Z');
  });

  it('devuelve items vacíos sin lanzar cuando el tutor no tiene aulas', async () => {
    api.seed({
      serverTime: new ServerTime('2026-07-21T14:35:55.000Z'),
      items: [],
    });
    const result = await useCase.execute();
    expect(result.items).toEqual([]);
    // El anclaje sigue ocurriendo aunque no haya items — mismo pattern GetTodaysExamsUseCase.
    expect(clock.lastAnchor()).not.toBeNull();
  });
});
