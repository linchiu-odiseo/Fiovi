import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { TutorExamsListViewModel } from '../../../../src/LR_render/view-models/tutor-exams-list.view-model';
import { GetExamsEnCursoUseCase } from '../../../../src/L2_application/use-cases/get-exams-en-curso.use-case';
import { GetProfileUseCase } from '../../../../src/L2_application/use-cases/get-profile.use-case';
import { GetIdentityUseCase } from '../../../../src/L2_application/use-cases/get-identity.use-case';
import { ExamEnCurso } from '../../../../src/L1_domain/entities/exam-en-curso';
import { NetworkError } from '../../../../src/L1_domain/errors/network.error';
import { ServerTime } from '../../../../src/L1_domain/value-objects/server-time';
import type { ExamsEnCursoResult } from '../../../../src/L1_domain/ports/tutor-navigation-api';

// Reescrito para el nuevo VM (change tutor-aulas-semanas-view): el home ya no
// pega a /tutor/virtual-exams sino a /tutor/exams/en-curso y expone
// `examsEnCurso()` + `inProgressCountFor(classroomId)`. El polling activo se
// postergó a un cambio futuro — este VM hace un fetch único en start().

function buildExam(
  overrides: Partial<{ recordId: string; classroomId: string }> = {},
): ExamEnCurso {
  return new ExamEnCurso({
    id: `id-${overrides.recordId ?? 'r1'}`,
    recordId: overrides.recordId ?? 'rec-1',
    classroomId: overrides.classroomId ?? 'cls-A',
    classroomCode: 'A-101',
    classroomName: 'Aula A',
    name: 'Exam',
    course: 'ÁLGEBRA',
    area: 'Números',
    count: 4,
    duration: 900,
    startedAt: new Date('2026-07-21T14:00:00Z'),
  });
}

class FakeGetExamsEnCurso {
  private _next: ExamsEnCursoResult | Error = {
    serverTime: new ServerTime('2026-07-21T14:35:55.000Z'),
    items: [],
  };
  public calls = 0;

  willResolve(items: readonly ExamEnCurso[]): void {
    this._next = { serverTime: new ServerTime('2026-07-21T14:35:55.000Z'), items };
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

class FakeGetProfile {
  async execute(): Promise<never> {
    // No profile in these tests — throw so the VM catches and skips silently.
    // ProfileNotAvailableError vs NetworkError vs otro no importa acá; los
    // tests de home focused-on `examsEnCurso` no ejercen el flow de perfil.
    throw new NetworkError();
  }
}

class FakeGetIdentity {
  async execute(): Promise<null> {
    return null;
  }
}

describe('TutorExamsListViewModel (home tutor)', () => {
  let getExams: FakeGetExamsEnCurso;
  let getProfile: FakeGetProfile;
  let getIdentity: FakeGetIdentity;

  beforeEach(async () => {
    getExams = new FakeGetExamsEnCurso();
    getProfile = new FakeGetProfile();
    getIdentity = new FakeGetIdentity();

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      providers: [
        TutorExamsListViewModel,
        { provide: GetExamsEnCursoUseCase, useValue: getExams },
        { provide: GetProfileUseCase, useValue: getProfile },
        { provide: GetIdentityUseCase, useValue: getIdentity },
      ],
    }).compileComponents();
  });

  function createVm(): TutorExamsListViewModel {
    return TestBed.runInInjectionContext(() => new TutorExamsListViewModel());
  }

  describe('start()', () => {
    it('llama getExamsEnCurso una vez y popula examsEnCurso()', async () => {
      getExams.willResolve([buildExam({ recordId: 'r1' })]);
      const vm = createVm();

      await vm.start();

      expect(getExams.calls).toBe(1);
      expect(vm.examsEnCurso()).toHaveLength(1);
      expect(vm.hasExamsEnCurso()).toBe(true);
      expect(vm.loading()).toBe(false);
      expect(vm.error()).toBe(false);
    });

    it('NetworkError → error()=true y mantiene lista vacía sin lanzar', async () => {
      getExams.willReject(new NetworkError());
      const vm = createVm();

      await vm.start();

      expect(vm.error()).toBe(true);
      expect(vm.examsEnCurso()).toEqual([]);
      expect(vm.loading()).toBe(false);
    });

    it('llamado dos veces solo dispara el fetch una vez (guard `started`)', async () => {
      getExams.willResolve([]);
      const vm = createVm();

      await vm.start();
      await vm.start();

      expect(getExams.calls).toBe(1);
    });
  });

  describe('inProgressCountFor(classroomId)', () => {
    it('agrupa los items por classroomId — 2 aulas, 3 items totales', async () => {
      getExams.willResolve([
        buildExam({ recordId: 'r1', classroomId: 'cls-A' }),
        buildExam({ recordId: 'r2', classroomId: 'cls-A' }),
        buildExam({ recordId: 'r3', classroomId: 'cls-B' }),
      ]);
      const vm = createVm();
      await vm.start();

      expect(vm.inProgressCountFor('cls-A')).toBe(2);
      expect(vm.inProgressCountFor('cls-B')).toBe(1);
      expect(vm.inProgressCountFor('cls-C-not-existing')).toBe(0);
    });

    it('devuelve 0 cuando no hay exámenes en curso', async () => {
      getExams.willResolve([]);
      const vm = createVm();
      await vm.start();

      expect(vm.inProgressCountFor('any-classroom')).toBe(0);
    });
  });
});
