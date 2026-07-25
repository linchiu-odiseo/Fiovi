import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { TutorTasksListViewModel } from '../../../../src/LR_render/view-models/tutor-tasks-list.view-model';
import { GetExamsEnCursoUseCase } from '../../../../src/L2_application/use-cases/get-exams-en-curso.use-case';
import { ExamEnCurso } from '../../../../src/L1_domain/entities/exam-en-curso';
import { NetworkError } from '../../../../src/L1_domain/errors/network.error';
import { ServerTime } from '../../../../src/L1_domain/value-objects/server-time';
import { CLOCK } from '../../../../src/app.config';
import type { Clock } from '../../../../src/L1_domain/ports/clock';
import type { ExamsEnCursoResult } from '../../../../src/L1_domain/ports/tutor-navigation-api';

function buildTarea(overrides: {
  recordId: string;
  classroomId?: string;
  classroomName?: string;
  openUntil: Date;
}): ExamEnCurso {
  return new ExamEnCurso({
    id: `id-${overrides.recordId}`,
    recordId: overrides.recordId,
    classroomId: overrides.classroomId ?? 'cls-A',
    classroomCode: 'A-101',
    classroomName: overrides.classroomName ?? 'Aula A',
    name: `Tarea ${overrides.recordId}`,
    course: 'ÁLGEBRA',
    area: 'Números',
    count: 10,
    duration: 900,
    startedAt: new Date('2026-07-25T12:00:00Z'),
    openUntil: overrides.openUntil,
  });
}

function buildExamen(recordId: string): ExamEnCurso {
  return new ExamEnCurso({
    id: `id-${recordId}`,
    recordId,
    classroomId: 'cls-X',
    classroomCode: 'X-101',
    classroomName: 'Aula X',
    name: `Examen ${recordId}`,
    course: 'HISTORIA',
    area: 'Letras',
    count: 10,
    duration: 900,
    startedAt: new Date('2026-07-25T12:00:00Z'),
    openUntil: null,
  });
}

class FakeGetExamsEnCurso {
  private _next: ExamsEnCursoResult | Error = {
    serverTime: new ServerTime('2026-07-25T14:00:00.000Z'),
    items: [],
  };
  public calls = 0;

  willResolve(items: readonly ExamEnCurso[]): void {
    this._next = { serverTime: new ServerTime('2026-07-25T14:00:00.000Z'), items };
  }

  willReject(err: Error): void {
    this._next = err;
  }

  async execute(): Promise<ExamsEnCursoResult> {
    this.calls++;
    if (this._next instanceof Error) throw this._next;
    return this._next;
  }
}

class FixedClock implements Clock {
  constructor(private readonly fixed: Date) {}
  now(): Date {
    return new Date(this.fixed);
  }
  setServerTime(): void {
    // no-op
  }
}

describe('TutorTasksListViewModel', () => {
  let getExams: FakeGetExamsEnCurso;
  const now = new Date('2026-07-25T18:00:00Z');

  beforeEach(async () => {
    getExams = new FakeGetExamsEnCurso();
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      providers: [
        TutorTasksListViewModel,
        { provide: GetExamsEnCursoUseCase, useValue: getExams },
        { provide: CLOCK, useValue: new FixedClock(now) },
      ],
    }).compileComponents();
  });

  function createVm(): TutorTasksListViewModel {
    return TestBed.runInInjectionContext(() => new TutorTasksListViewModel());
  }

  it('filtra tareas (openUntil !== null) descartando los exámenes clásicos', async () => {
    getExams.willResolve([
      buildTarea({ recordId: 't1', openUntil: new Date('2026-07-28T00:00:00Z') }),
      buildExamen('e1'),
      buildTarea({ recordId: 't2', openUntil: new Date('2026-07-27T00:00:00Z') }),
    ]);
    const vm = createVm();
    await vm.start();

    expect(vm.totalTareas()).toBe(2);
    expect(vm.hasTareas()).toBe(true);
  });

  it('ordena las tareas por deadline más próximo primero', async () => {
    getExams.willResolve([
      buildTarea({ recordId: 't-lejos', openUntil: new Date('2026-07-30T00:00:00Z') }),
      buildTarea({ recordId: 't-cerca', openUntil: new Date('2026-07-26T00:00:00Z') }),
      buildTarea({ recordId: 't-medio', openUntil: new Date('2026-07-28T00:00:00Z') }),
    ]);
    const vm = createVm();
    await vm.start();

    // Solo hay 1 aula (cls-A por default), así que todas caen en un solo grupo.
    expect(vm.grupos()).toHaveLength(1);
    const orden = vm.grupos()[0]!.tareas.map((c) => c.recordId);
    expect(orden).toEqual(['t-cerca', 't-medio', 't-lejos']);
  });

  it('agrupa por classroomId; grupos ordenados por deadline más próximo del primer item', async () => {
    getExams.willResolve([
      buildTarea({
        recordId: 't-A-lejos',
        classroomId: 'cls-A',
        classroomName: 'Aula A',
        openUntil: new Date('2026-07-30T00:00:00Z'),
      }),
      buildTarea({
        recordId: 't-B-cerca',
        classroomId: 'cls-B',
        classroomName: 'Aula B',
        openUntil: new Date('2026-07-26T00:00:00Z'),
      }),
      buildTarea({
        recordId: 't-A-medio',
        classroomId: 'cls-A',
        classroomName: 'Aula A',
        openUntil: new Date('2026-07-28T00:00:00Z'),
      }),
    ]);
    const vm = createVm();
    await vm.start();

    // Grupo B primero (su tarea t-B-cerca cierra antes que la más próxima de A).
    expect(vm.grupos().map((g) => g.classroomId)).toEqual(['cls-B', 'cls-A']);
    // Dentro de A, t-A-medio va antes que t-A-lejos.
    expect(vm.grupos()[1]!.tareas.map((t) => t.recordId)).toEqual(['t-A-medio', 't-A-lejos']);
  });

  it('cards traen countdown humano ("N día(s) H h" para deadlines > 24h)', async () => {
    getExams.willResolve([
      // now: 25 jul 18:00Z → deadline 28 jul 00:00Z = 54 h = 2 días 6 h.
      buildTarea({ recordId: 't1', openUntil: new Date('2026-07-28T00:00:00Z') }),
    ]);
    const vm = createVm();
    await vm.start();

    const card = vm.grupos()[0]!.tareas[0]!;
    expect(card.countdownText).toBe('2 días 6 h');
    expect(card.closeAt?.toISOString()).toBe('2026-07-28T00:00:00.000Z');
  });

  it('lista vacía cuando no hay tareas activas (solo exámenes)', async () => {
    getExams.willResolve([buildExamen('e1'), buildExamen('e2')]);
    const vm = createVm();
    await vm.start();

    expect(vm.hasTareas()).toBe(false);
    expect(vm.grupos()).toEqual([]);
  });

  it('NetworkError → error()=true sin lanzar', async () => {
    getExams.willReject(new NetworkError());
    const vm = createVm();
    await vm.start();

    expect(vm.error()).toBe(true);
    expect(vm.hasTareas()).toBe(false);
  });
});
