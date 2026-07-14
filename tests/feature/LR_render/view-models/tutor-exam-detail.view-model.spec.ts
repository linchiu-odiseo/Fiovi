import { describe, it, expect, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { TutorExamDetailViewModel } from '../../../../src/LR_render/view-models/tutor-exam-detail.view-model';
import { TutorExamsStore } from '../../../../src/LR_render/state/tutor-exams.store';
import { GetTutorExamsUseCase } from '../../../../src/L2_application/use-cases/get-tutor-exams.use-case';
import { GetTutorExamDetailUseCase } from '../../../../src/L2_application/use-cases/get-tutor-exam-detail.use-case';
import { ListClassroomStudentsUseCase } from '../../../../src/L2_application/use-cases/list-classroom-students.use-case';
import { IniciarExamenUseCase } from '../../../../src/L2_application/use-cases/iniciar-examen.use-case';
import { FinalizarExamenUseCase } from '../../../../src/L2_application/use-cases/finalizar-examen.use-case';
import { ActualizarAlumnosHabilitadosUseCase } from '../../../../src/L2_application/use-cases/actualizar-alumnos-habilitados.use-case';
import { TutorExam } from '../../../../src/L1_domain/entities/tutor-exam';
import { TutorExamDetail } from '../../../../src/L1_domain/value-objects/tutor-exam-detail';
import { ClassroomStudent } from '../../../../src/L1_domain/value-objects/classroom-student';
import { ExamServerStatus } from '../../../../src/L1_domain/value-objects/exam-server-status';
import { NetworkError } from '../../../../src/L1_domain/errors/network.error';
import { ExamConflictError } from '../../../../src/L1_domain/errors/exam-conflict.error';
import { ExamPreconditionError } from '../../../../src/L1_domain/errors/exam-precondition.error';
import { FinalizeResult } from '../../../../src/L1_domain/ports/tutor-exams-api';

// ─── helpers ─────────────────────────────────────────────────────────────────

function buildTutorExam(
  overrides: Partial<ConstructorParameters<typeof TutorExam>[0]> = {},
): TutorExam {
  return new TutorExam({
    detailId: 'det-1',
    recordId: 'rec-1',
    classroomId: 'cls-1',
    serverStatus: new ExamServerStatus('scheduled'),
    name: 'Examen de Matemáticas',
    course: 'Álgebra',
    area: 'Matemáticas',
    count: 20,
    duration: 60,
    scheduled: new Date('2026-06-01T10:00:00Z'),
    startedAt: null,
    finishedAt: null,
    ...overrides,
  });
}

function buildDetail(overrides: Partial<TutorExamDetail> = {}): TutorExamDetail {
  return {
    id: 'det-1',
    recordId: 'rec-1',
    status: new ExamServerStatus('scheduled'),
    name: 'Examen de Matemáticas',
    course: 'Álgebra',
    area: 'Matemáticas',
    count: 20,
    duration: 60,
    enabledStudentIds: ['s-1', 's-2'],
    startedAt: null,
    finishedAt: null,
    createdAt: new Date('2026-06-01T10:00:00Z'),
    ...overrides,
  };
}

function buildStudent(overrides: Partial<ClassroomStudent> = {}): ClassroomStudent {
  return {
    studentId: 's-1',
    studentCode: 'CODE001',
    firstName: 'Ana',
    lastName: 'García',
    enabled: true,
    hasSubmitted: false,
    ...overrides,
  };
}

// ─── fakes ───────────────────────────────────────────────────────────────────

class FakeGetTutorExamsUseCase {
  callCount = 0;
  private _next:
    | { kind: 'resolve'; list: readonly TutorExam[] }
    | { kind: 'reject'; error: Error } = { kind: 'resolve', list: [] };

  willResolve(list: readonly TutorExam[]) {
    this._next = { kind: 'resolve', list };
  }
  willReject(error: Error) {
    this._next = { kind: 'reject', error };
  }
  async execute(): Promise<readonly TutorExam[]> {
    this.callCount++;
    if (this._next.kind === 'reject') throw this._next.error;
    return this._next.list;
  }
}

class FakeGetTutorExamDetailUseCase {
  callCount = 0;
  private _next: { kind: 'resolve'; detail: TutorExamDetail } | { kind: 'reject'; error: Error } = {
    kind: 'resolve',
    detail: buildDetail(),
  };

  willResolve(detail: TutorExamDetail) {
    this._next = { kind: 'resolve', detail };
  }
  willReject(error: Error) {
    this._next = { kind: 'reject', error };
  }
  async execute(_req: { recordId: string }): Promise<TutorExamDetail> {
    this.callCount++;
    if (this._next.kind === 'reject') throw this._next.error;
    return this._next.detail;
  }
}

class FakeListClassroomStudentsUseCase {
  callCount = 0;
  private _next:
    | { kind: 'resolve'; students: readonly ClassroomStudent[] }
    | { kind: 'reject'; error: Error } = { kind: 'resolve', students: [] };

  willResolve(students: readonly ClassroomStudent[]) {
    this._next = { kind: 'resolve', students };
  }
  willReject(error: Error) {
    this._next = { kind: 'reject', error };
  }
  async execute(_req: {
    classroomId: string;
    virtualExamDetailId: string;
  }): Promise<readonly ClassroomStudent[]> {
    this.callCount++;
    if (this._next.kind === 'reject') throw this._next.error;
    return this._next.students;
  }
}

class FakeIniciarExamenUseCase {
  callCount = 0;
  private _next: { kind: 'resolve' } | { kind: 'reject'; error: Error } = {
    kind: 'resolve',
  };

  willResolve() {
    this._next = { kind: 'resolve' };
  }
  willReject(error: Error) {
    this._next = { kind: 'reject', error };
  }
  async execute(_req: { recordId: string }): Promise<void> {
    this.callCount++;
    if (this._next.kind === 'reject') throw this._next.error;
  }
}

class FakeFinalizarExamenUseCase {
  callCount = 0;
  private _next: { kind: 'resolve'; result: FinalizeResult } | { kind: 'reject'; error: Error } = {
    kind: 'resolve',
    result: { transitioned: true },
  };

  willResolve(result: FinalizeResult) {
    this._next = { kind: 'resolve', result };
  }
  willReject(error: Error) {
    this._next = { kind: 'reject', error };
  }
  async execute(_req: { recordId: string }): Promise<FinalizeResult> {
    this.callCount++;
    if (this._next.kind === 'reject') throw this._next.error;
    return this._next.result;
  }
}

class FakeActualizarAlumnosHabilitadosUseCase {
  callCount = 0;
  lastCall: { recordId: string; enabledStudentIds: readonly string[] } | null = null;
  private _next: { kind: 'resolve' } | { kind: 'reject'; error: Error } = {
    kind: 'resolve',
  };

  willResolve() {
    this._next = { kind: 'resolve' };
  }
  willReject(error: Error) {
    this._next = { kind: 'reject', error };
  }
  async execute(req: { recordId: string; enabledStudentIds: readonly string[] }): Promise<void> {
    this.callCount++;
    this.lastCall = req;
    if (this._next.kind === 'reject') throw this._next.error;
  }
}

// ─── test setup ──────────────────────────────────────────────────────────────

function setup(recordId = 'rec-1') {
  const fakeGetList = new FakeGetTutorExamsUseCase();
  const fakeGetDetail = new FakeGetTutorExamDetailUseCase();
  const fakeListStudents = new FakeListClassroomStudentsUseCase();
  const fakeIniciar = new FakeIniciarExamenUseCase();
  const fakeFinalizar = new FakeFinalizarExamenUseCase();
  const fakeActualizar = new FakeActualizarAlumnosHabilitadosUseCase();

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      TutorExamsStore,
      { provide: GetTutorExamsUseCase, useValue: fakeGetList },
      { provide: GetTutorExamDetailUseCase, useValue: fakeGetDetail },
      { provide: ListClassroomStudentsUseCase, useValue: fakeListStudents },
      { provide: IniciarExamenUseCase, useValue: fakeIniciar },
      { provide: FinalizarExamenUseCase, useValue: fakeFinalizar },
      { provide: ActualizarAlumnosHabilitadosUseCase, useValue: fakeActualizar },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: { get: () => recordId } } },
      },
    ],
  });

  const store = TestBed.inject(TutorExamsStore);
  const vm = TestBed.runInInjectionContext(() => new TutorExamDetailViewModel());

  return {
    vm,
    store,
    fakeGetList,
    fakeGetDetail,
    fakeListStudents,
    fakeIniciar,
    fakeFinalizar,
    fakeActualizar,
  };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('TutorExamDetailViewModel', () => {
  // ── Store resolution ────────────────────────────────────────────────────────

  describe('Scenario: Store poblado → classroomId resuelto sin request extra', () => {
    it('no llama GetTutorExamsUseCase cuando el store ya tiene el exam', async () => {
      const { vm, store, fakeGetList, fakeGetDetail, fakeListStudents } = setup('rec-1');

      const exam = buildTutorExam({ recordId: 'rec-1', classroomId: 'cls-1' });
      store.setExams([exam]);

      fakeGetDetail.willResolve(buildDetail());
      fakeListStudents.willResolve([buildStudent()]);

      await vm.load();

      expect(fakeGetList.callCount).toBe(0);
    });

    it('usa el classroomId del store directamente (warm path)', async () => {
      const { vm, store, fakeGetDetail, fakeListStudents, fakeGetList } = setup('rec-1');

      const exam = buildTutorExam({ recordId: 'rec-1', classroomId: 'cls-warm' });
      store.setExams([exam]);

      fakeGetDetail.willResolve(buildDetail());
      fakeListStudents.willResolve([]);

      await vm.load();

      // ListClassroomStudents was called with the classroomId from the store
      expect(fakeListStudents.callCount).toBe(1);
      expect(fakeGetList.callCount).toBe(0);
    });
  });

  describe('Scenario: Store vacío en deep-link → refetch list resuelve classroomId', () => {
    it('store vacío → llama GetTutorExamsUseCase una vez para hidratar', async () => {
      const { vm, store, fakeGetList, fakeGetDetail, fakeListStudents } = setup('rec-1');

      expect(store.findByRecordId('rec-1')).toBeNull();

      const exam = buildTutorExam({ recordId: 'rec-1', classroomId: 'cls-1' });
      fakeGetList.willResolve([exam]);
      fakeGetDetail.willResolve(buildDetail());
      fakeListStudents.willResolve([]);

      await vm.load();

      expect(fakeGetList.callCount).toBe(1);
    });

    it('refetch hidrata el store', async () => {
      const { vm, store, fakeGetList, fakeGetDetail, fakeListStudents } = setup('rec-1');

      const exam = buildTutorExam({ recordId: 'rec-1', classroomId: 'cls-1' });
      fakeGetList.willResolve([exam]);
      fakeGetDetail.willResolve(buildDetail());
      fakeListStudents.willResolve([]);

      await vm.load();

      // Store was hydrated
      expect(store.findByRecordId('rec-1')).toBe(exam);
    });
  });

  describe('Scenario: recordId no encontrado ni en store ni en refetch → error', () => {
    it('error() es truthy cuando el recordId no existe en ningún lado', async () => {
      const { vm, fakeGetList } = setup('rec-xxx');

      // refetch returns list without rec-xxx
      fakeGetList.willResolve([buildTutorExam({ recordId: 'rec-other' })]);

      await vm.load();

      expect(vm.error()).toBeTruthy();
    });
  });

  // ── Signals on successful load ──────────────────────────────────────────────

  describe('Scenario: Carga exitosa popula detail y students', () => {
    it('detail(), students(), loading()=false, error()=null tras carga exitosa', async () => {
      const { vm, store, fakeGetDetail, fakeListStudents } = setup('rec-1');

      store.setExams([buildTutorExam({ recordId: 'rec-1', classroomId: 'cls-1' })]);

      const detail = buildDetail({ enabledStudentIds: ['s-1', 's-2'] });
      const students = [buildStudent(), buildStudent({ studentId: 's-2', studentCode: 'CODE002' })];

      fakeGetDetail.willResolve(detail);
      fakeListStudents.willResolve(students);

      await vm.load();

      expect(vm.detail()).not.toBeNull();
      expect(vm.students()).toHaveLength(2);
      expect(vm.loading()).toBe(false);
      expect(vm.error()).toBeNull();
    });
  });

  describe('Scenario: enabledStudentIds inicializa desde detail.enabledStudentIds', () => {
    it('enabledStudentIds() refleja detail.enabledStudentIds tras carga', async () => {
      const { vm, store, fakeGetDetail, fakeListStudents } = setup('rec-1');

      store.setExams([buildTutorExam({ recordId: 'rec-1', classroomId: 'cls-1' })]);
      fakeGetDetail.willResolve(buildDetail({ enabledStudentIds: ['s-1', 's-2'] }));
      fakeListStudents.willResolve([]);

      await vm.load();

      expect(vm.enabledStudentIds()).toEqual(['s-1', 's-2']);
    });
  });

  // ── Iniciar button guard ────────────────────────────────────────────────────

  describe('Scenario: Botón Iniciar habilitado solo con scheduled y ≥1 alumno habilitado', () => {
    it('canIniciar() es true con status=scheduled y enabledStudentIds.length>0', async () => {
      const { vm, store, fakeGetDetail, fakeListStudents } = setup('rec-1');

      store.setExams([
        buildTutorExam({
          recordId: 'rec-1',
          classroomId: 'cls-1',
          serverStatus: new ExamServerStatus('scheduled'),
        }),
      ]);
      fakeGetDetail.willResolve(
        buildDetail({ status: new ExamServerStatus('scheduled'), enabledStudentIds: ['s-1'] }),
      );
      fakeListStudents.willResolve([buildStudent({ studentId: 's-1' })]);

      await vm.load();

      expect(vm.canIniciar()).toBe(true);
    });
  });

  describe('Scenario: Botón Iniciar deshabilitado si 0 alumnos habilitados (D5)', () => {
    it('canIniciar() es false cuando enabledStudentIds está vacío', async () => {
      const { vm, store, fakeGetDetail, fakeListStudents } = setup('rec-1');

      store.setExams([
        buildTutorExam({
          recordId: 'rec-1',
          classroomId: 'cls-1',
          serverStatus: new ExamServerStatus('scheduled'),
        }),
      ]);
      fakeGetDetail.willResolve(
        buildDetail({ status: new ExamServerStatus('scheduled'), enabledStudentIds: [] }),
      );
      fakeListStudents.willResolve([]);

      await vm.load();

      expect(vm.canIniciar()).toBe(false);
    });

    it('NO llama IniciarExamenUseCase si canIniciar() es false', async () => {
      const { vm, store, fakeGetDetail, fakeListStudents, fakeIniciar } = setup('rec-1');

      store.setExams([
        buildTutorExam({
          recordId: 'rec-1',
          classroomId: 'cls-1',
          serverStatus: new ExamServerStatus('scheduled'),
        }),
      ]);
      fakeGetDetail.willResolve(
        buildDetail({ status: new ExamServerStatus('scheduled'), enabledStudentIds: [] }),
      );
      fakeListStudents.willResolve([]);

      await vm.load();

      // Attempt to iniciar with empty students → should be a no-op
      await vm.iniciar();

      expect(fakeIniciar.callCount).toBe(0);
    });
  });

  describe('Scenario: Botón Iniciar NO aparece si status es in_progress o finalized', () => {
    it('canIniciar() es false cuando status es in_progress', async () => {
      const { vm, store, fakeGetDetail, fakeListStudents } = setup('rec-1');

      store.setExams([
        buildTutorExam({
          recordId: 'rec-1',
          classroomId: 'cls-1',
          serverStatus: new ExamServerStatus('in_progress'),
        }),
      ]);
      fakeGetDetail.willResolve(
        buildDetail({ status: new ExamServerStatus('in_progress'), enabledStudentIds: ['s-1'] }),
      );
      fakeListStudents.willResolve([buildStudent()]);

      await vm.load();

      expect(vm.canIniciar()).toBe(false);
    });

    it('canIniciar() es false cuando status es finalized', async () => {
      const { vm, store, fakeGetDetail, fakeListStudents } = setup('rec-1');

      store.setExams([
        buildTutorExam({
          recordId: 'rec-1',
          classroomId: 'cls-1',
          serverStatus: new ExamServerStatus('finalized'),
        }),
      ]);
      fakeGetDetail.willResolve(
        buildDetail({ status: new ExamServerStatus('finalized'), enabledStudentIds: ['s-1'] }),
      );
      fakeListStudents.willResolve([buildStudent()]);

      await vm.load();

      expect(vm.canIniciar()).toBe(false);
    });
  });

  // ── Iniciar success ─────────────────────────────────────────────────────────

  describe('Scenario: Iniciar exitoso → status pasa a in_progress', () => {
    it('iniciar() exitoso: recarga detail, actionError() es null', async () => {
      const { vm, store, fakeGetDetail, fakeListStudents, fakeIniciar } = setup('rec-1');

      store.setExams([
        buildTutorExam({
          recordId: 'rec-1',
          classroomId: 'cls-1',
          serverStatus: new ExamServerStatus('scheduled'),
        }),
      ]);
      fakeGetDetail.willResolve(
        buildDetail({ status: new ExamServerStatus('scheduled'), enabledStudentIds: ['s-1'] }),
      );
      fakeListStudents.willResolve([buildStudent()]);
      fakeIniciar.willResolve();

      await vm.load();

      // Reload will return in_progress
      const detailAfter = buildDetail({
        status: new ExamServerStatus('in_progress'),
        enabledStudentIds: ['s-1'],
      });
      fakeGetDetail.willResolve(detailAfter);

      await vm.iniciar();

      expect(fakeIniciar.callCount).toBe(1);
      expect(vm.actionError()).toBeNull();
      // detail was reloaded
      expect(fakeGetDetail.callCount).toBeGreaterThan(1);
    });

    it('store.upsert es llamado tras iniciar exitoso', async () => {
      const { vm, store, fakeGetDetail, fakeListStudents, fakeIniciar } = setup('rec-1');

      const exam = buildTutorExam({
        recordId: 'rec-1',
        classroomId: 'cls-1',
        serverStatus: new ExamServerStatus('scheduled'),
      });
      store.setExams([exam]);
      fakeGetDetail.willResolve(
        buildDetail({ status: new ExamServerStatus('scheduled'), enabledStudentIds: ['s-1'] }),
      );
      fakeListStudents.willResolve([buildStudent()]);
      fakeIniciar.willResolve();

      await vm.load();

      const upsertSpy = vi.spyOn(store, 'upsert');
      const detailAfter = buildDetail({
        status: new ExamServerStatus('in_progress'),
        enabledStudentIds: ['s-1'],
      });
      fakeGetDetail.willResolve(detailAfter);

      await vm.iniciar();

      expect(upsertSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ── Finalizar button guard ──────────────────────────────────────────────────

  describe('Scenario: Botón Finalizar habilitado solo con in_progress', () => {
    it('canFinalizar() es true con status=in_progress', async () => {
      const { vm, store, fakeGetDetail, fakeListStudents } = setup('rec-1');

      store.setExams([
        buildTutorExam({
          recordId: 'rec-1',
          classroomId: 'cls-1',
          serverStatus: new ExamServerStatus('in_progress'),
        }),
      ]);
      fakeGetDetail.willResolve(buildDetail({ status: new ExamServerStatus('in_progress') }));
      fakeListStudents.willResolve([]);

      await vm.load();

      expect(vm.canFinalizar()).toBe(true);
    });

    it('canFinalizar() es false con status=scheduled', async () => {
      const { vm, store, fakeGetDetail, fakeListStudents } = setup('rec-1');

      store.setExams([buildTutorExam({ recordId: 'rec-1', classroomId: 'cls-1' })]);
      fakeGetDetail.willResolve(buildDetail({ status: new ExamServerStatus('scheduled') }));
      fakeListStudents.willResolve([]);

      await vm.load();

      expect(vm.canFinalizar()).toBe(false);
    });

    it('canFinalizar() es false con status=finalized', async () => {
      const { vm, store, fakeGetDetail, fakeListStudents } = setup('rec-1');

      store.setExams([
        buildTutorExam({
          recordId: 'rec-1',
          classroomId: 'cls-1',
          serverStatus: new ExamServerStatus('finalized'),
        }),
      ]);
      fakeGetDetail.willResolve(buildDetail({ status: new ExamServerStatus('finalized') }));
      fakeListStudents.willResolve([]);

      await vm.load();

      expect(vm.canFinalizar()).toBe(false);
    });
  });

  // ── Finalizar results ───────────────────────────────────────────────────────

  describe('Scenario: Finalizar con transitioned:true — éxito normal', () => {
    it('transitioned:true → actionError()=null, detail recargado', async () => {
      const { vm, store, fakeGetDetail, fakeListStudents, fakeFinalizar } = setup('rec-1');

      store.setExams([
        buildTutorExam({
          recordId: 'rec-1',
          classroomId: 'cls-1',
          serverStatus: new ExamServerStatus('in_progress'),
        }),
      ]);
      fakeGetDetail.willResolve(buildDetail({ status: new ExamServerStatus('in_progress') }));
      fakeListStudents.willResolve([]);
      fakeFinalizar.willResolve({ transitioned: true });

      await vm.load();

      const callsBefore = fakeGetDetail.callCount;
      fakeGetDetail.willResolve(buildDetail({ status: new ExamServerStatus('finalized') }));

      await vm.finalizar();

      expect(vm.actionError()).toBeNull();
      expect(fakeGetDetail.callCount).toBeGreaterThan(callsBefore);
    });
  });

  describe('Scenario: Finalizar con transitioned:false — idempotente, no es error', () => {
    it('transitioned:false → actionError()=null (no error), detail recargado', async () => {
      const { vm, store, fakeGetDetail, fakeListStudents, fakeFinalizar } = setup('rec-1');

      store.setExams([
        buildTutorExam({
          recordId: 'rec-1',
          classroomId: 'cls-1',
          serverStatus: new ExamServerStatus('in_progress'),
        }),
      ]);
      fakeGetDetail.willResolve(buildDetail({ status: new ExamServerStatus('in_progress') }));
      fakeListStudents.willResolve([]);
      fakeFinalizar.willResolve({ transitioned: false });

      await vm.load();

      const callsBefore = fakeGetDetail.callCount;
      await vm.finalizar();

      expect(vm.actionError()).toBeNull();
      expect(fakeGetDetail.callCount).toBeGreaterThan(callsBefore);
    });
  });

  describe('store.upsert llamado tras finalizar exitoso', () => {
    it('store.upsert invocado después de finalizar con transitioned:true', async () => {
      const { vm, store, fakeGetDetail, fakeListStudents, fakeFinalizar } = setup('rec-1');

      const exam = buildTutorExam({
        recordId: 'rec-1',
        classroomId: 'cls-1',
        serverStatus: new ExamServerStatus('in_progress'),
      });
      store.setExams([exam]);
      fakeGetDetail.willResolve(buildDetail({ status: new ExamServerStatus('in_progress') }));
      fakeListStudents.willResolve([]);
      fakeFinalizar.willResolve({ transitioned: true });

      await vm.load();

      const upsertSpy = vi.spyOn(store, 'upsert');
      fakeGetDetail.willResolve(buildDetail({ status: new ExamServerStatus('finalized') }));

      await vm.finalizar();

      expect(upsertSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ── Checkbox logic ──────────────────────────────────────────────────────────

  describe('Scenario: Checkbox de alumno con hasSubmitted deshabilitado (D5)', () => {
    it('isCheckboxDisabled() es true para alumno con hasSubmitted=true', async () => {
      const { vm, store, fakeGetDetail, fakeListStudents } = setup('rec-1');

      store.setExams([buildTutorExam({ recordId: 'rec-1', classroomId: 'cls-1' })]);
      fakeGetDetail.willResolve(buildDetail());
      fakeListStudents.willResolve([buildStudent({ studentId: 's-1', hasSubmitted: true })]);

      await vm.load();

      const submitted = vm.students().find((s) => s.studentId === 's-1')!;
      expect(vm.isCheckboxDisabled(submitted)).toBe(true);
    });

    it('isCheckboxDisabled() es false para alumno sin entregar y examen no finalizado', async () => {
      const { vm, store, fakeGetDetail, fakeListStudents } = setup('rec-1');

      store.setExams([buildTutorExam({ recordId: 'rec-1', classroomId: 'cls-1' })]);
      fakeGetDetail.willResolve(buildDetail({ status: new ExamServerStatus('scheduled') }));
      fakeListStudents.willResolve([buildStudent({ studentId: 's-2', hasSubmitted: false })]);

      await vm.load();

      const student = vm.students().find((s) => s.studentId === 's-2')!;
      expect(vm.isCheckboxDisabled(student)).toBe(false);
    });
  });

  describe('Scenario: Checkboxes deshabilitados en modo finalized (D5)', () => {
    it('isCheckboxDisabled() es true para cualquier alumno cuando status=finalized', async () => {
      const { vm, store, fakeGetDetail, fakeListStudents } = setup('rec-1');

      store.setExams([
        buildTutorExam({
          recordId: 'rec-1',
          classroomId: 'cls-1',
          serverStatus: new ExamServerStatus('finalized'),
        }),
      ]);
      fakeGetDetail.willResolve(buildDetail({ status: new ExamServerStatus('finalized') }));
      fakeListStudents.willResolve([
        buildStudent({ studentId: 's-1', hasSubmitted: false }),
        buildStudent({ studentId: 's-2', hasSubmitted: false }),
      ]);

      await vm.load();

      for (const student of vm.students()) {
        expect(vm.isCheckboxDisabled(student)).toBe(true);
      }
    });
  });

  describe('Scenario: Marcar alumno habilitado — PATCH exitoso', () => {
    it('toggleStudent("s-3") agrega s-3 a enabledStudentIds y llama ActualizarAlumnosHabilitados', async () => {
      const { vm, store, fakeGetDetail, fakeListStudents, fakeActualizar } = setup('rec-1');

      store.setExams([buildTutorExam({ recordId: 'rec-1', classroomId: 'cls-1' })]);
      fakeGetDetail.willResolve(buildDetail({ enabledStudentIds: ['s-1', 's-2'] }));
      fakeListStudents.willResolve([
        buildStudent({ studentId: 's-1' }),
        buildStudent({ studentId: 's-2' }),
        buildStudent({ studentId: 's-3', enabled: false }),
      ]);
      fakeActualizar.willResolve();

      await vm.load();

      await vm.toggleStudent('s-3');

      expect(vm.enabledStudentIds()).toContain('s-3');
      expect(fakeActualizar.callCount).toBe(1);
      expect(fakeActualizar.lastCall?.enabledStudentIds).toContain('s-3');
    });

    it('PATCH exitoso → actionError()=null', async () => {
      const { vm, store, fakeGetDetail, fakeListStudents, fakeActualizar } = setup('rec-1');

      store.setExams([buildTutorExam({ recordId: 'rec-1', classroomId: 'cls-1' })]);
      fakeGetDetail.willResolve(buildDetail({ enabledStudentIds: ['s-1'] }));
      fakeListStudents.willResolve([buildStudent({ studentId: 's-1' })]);
      fakeActualizar.willResolve();

      await vm.load();
      await vm.toggleStudent('s-2');

      expect(vm.actionError()).toBeNull();
    });
  });

  describe('Scenario: PATCH falla — enabledStudentIds se revierte', () => {
    it('ExamConflictError → enabledStudentIds vuelve al valor anterior', async () => {
      const { vm, store, fakeGetDetail, fakeListStudents, fakeActualizar } = setup('rec-1');

      store.setExams([buildTutorExam({ recordId: 'rec-1', classroomId: 'cls-1' })]);
      fakeGetDetail.willResolve(buildDetail({ enabledStudentIds: ['s-1', 's-2'] }));
      fakeListStudents.willResolve([
        buildStudent({ studentId: 's-1' }),
        buildStudent({ studentId: 's-2' }),
        buildStudent({ studentId: 's-3', enabled: false }),
      ]);
      fakeActualizar.willReject(new ExamConflictError());

      await vm.load();

      const before = [...vm.enabledStudentIds()];
      await vm.toggleStudent('s-3');

      expect(vm.enabledStudentIds()).toEqual(before);
    });

    it('PATCH falla → actionError() tiene copy en español', async () => {
      const { vm, store, fakeGetDetail, fakeListStudents, fakeActualizar } = setup('rec-1');

      store.setExams([buildTutorExam({ recordId: 'rec-1', classroomId: 'cls-1' })]);
      fakeGetDetail.willResolve(buildDetail({ enabledStudentIds: ['s-1'] }));
      fakeListStudents.willResolve([buildStudent()]);
      fakeActualizar.willReject(new ExamConflictError());

      await vm.load();
      await vm.toggleStudent('s-3');

      expect(vm.actionError()).not.toBeNull();
    });
  });

  // ── Error copy by action ────────────────────────────────────────────────────

  describe('Scenario: Copy para iniciar × ExamPreconditionError (422)', () => {
    it('actionError() contiene mensaje sobre configuración/alumnos habilitados', async () => {
      const { vm, store, fakeGetDetail, fakeListStudents, fakeIniciar } = setup('rec-1');

      store.setExams([
        buildTutorExam({
          recordId: 'rec-1',
          classroomId: 'cls-1',
          serverStatus: new ExamServerStatus('scheduled'),
        }),
      ]);
      fakeGetDetail.willResolve(
        buildDetail({ status: new ExamServerStatus('scheduled'), enabledStudentIds: ['s-1'] }),
      );
      fakeListStudents.willResolve([buildStudent()]);
      fakeIniciar.willReject(new ExamPreconditionError());

      await vm.load();
      await vm.iniciar();

      const msg = vm.actionError();
      expect(msg).not.toBeNull();
      // Should mention configuration or students (not body.message)
      expect(msg).toMatch(/no se puede iniciar|configurá|alumno|clave/i);
    });
  });

  describe('Scenario: Copy para iniciar × ExamConflictError (409)', () => {
    it('actionError() contiene mensaje sobre el estado actual del examen', async () => {
      const { vm, store, fakeGetDetail, fakeListStudents, fakeIniciar } = setup('rec-1');

      store.setExams([
        buildTutorExam({
          recordId: 'rec-1',
          classroomId: 'cls-1',
          serverStatus: new ExamServerStatus('scheduled'),
        }),
      ]);
      fakeGetDetail.willResolve(
        buildDetail({ status: new ExamServerStatus('scheduled'), enabledStudentIds: ['s-1'] }),
      );
      fakeListStudents.willResolve([buildStudent()]);
      fakeIniciar.willReject(new ExamConflictError());

      await vm.load();
      await vm.iniciar();

      const msg = vm.actionError();
      expect(msg).not.toBeNull();
      expect(msg).toMatch(/estado|cambió|curso|finalizado/i);
    });
  });

  describe('Scenario: Copy para finalizar × ExamPreconditionError (422)', () => {
    it('actionError() indica que el examen debe iniciarse primero', async () => {
      const { vm, store, fakeGetDetail, fakeListStudents, fakeFinalizar } = setup('rec-1');

      store.setExams([
        buildTutorExam({
          recordId: 'rec-1',
          classroomId: 'cls-1',
          serverStatus: new ExamServerStatus('in_progress'),
        }),
      ]);
      fakeGetDetail.willResolve(buildDetail({ status: new ExamServerStatus('in_progress') }));
      fakeListStudents.willResolve([]);
      fakeFinalizar.willReject(new ExamPreconditionError());

      await vm.load();
      await vm.finalizar();

      const msg = vm.actionError();
      expect(msg).not.toBeNull();
      expect(msg).toMatch(/no se puede finalizar|iniciálo|no fue iniciado|inicialo/i);
    });
  });

  describe('Scenario: Copy para finalizar × NetworkError', () => {
    it('actionError() menciona falta de conexión y NOT es null', async () => {
      const { vm, store, fakeGetDetail, fakeListStudents, fakeFinalizar } = setup('rec-1');

      store.setExams([
        buildTutorExam({
          recordId: 'rec-1',
          classroomId: 'cls-1',
          serverStatus: new ExamServerStatus('in_progress'),
        }),
      ]);
      fakeGetDetail.willResolve(buildDetail({ status: new ExamServerStatus('in_progress') }));
      fakeListStudents.willResolve([]);
      fakeFinalizar.willReject(new NetworkError());

      await vm.load();
      await vm.finalizar();

      const msg = vm.actionError();
      expect(msg).not.toBeNull();
      expect(msg).toMatch(/sin conexión|red|reintentá/i);
    });
  });

  describe('Scenario: Copy para habilitar × ExamConflictError (409)', () => {
    it('actionError() referencia al conflicto con un alumno o set congelado', async () => {
      const { vm, store, fakeGetDetail, fakeListStudents, fakeActualizar } = setup('rec-1');

      store.setExams([buildTutorExam({ recordId: 'rec-1', classroomId: 'cls-1' })]);
      fakeGetDetail.willResolve(buildDetail({ enabledStudentIds: ['s-1'] }));
      fakeListStudents.willResolve([buildStudent()]);
      fakeActualizar.willReject(new ExamConflictError());

      await vm.load();
      await vm.toggleStudent('s-3');

      const msg = vm.actionError();
      expect(msg).not.toBeNull();
      expect(msg).toMatch(/alumnos|congelado|entregó|cambiar/i);
    });
  });

  describe('Scenario: Acción exitosa limpia actionError', () => {
    it('actionError() vuelve a null tras acción exitosa que sigue a un error previo', async () => {
      const { vm, store, fakeGetDetail, fakeListStudents, fakeActualizar } = setup('rec-1');

      store.setExams([buildTutorExam({ recordId: 'rec-1', classroomId: 'cls-1' })]);
      fakeGetDetail.willResolve(buildDetail({ enabledStudentIds: ['s-1'] }));
      fakeListStudents.willResolve([buildStudent()]);

      await vm.load();

      // Trigger an error first
      fakeActualizar.willReject(new ExamConflictError());
      await vm.toggleStudent('s-3');
      expect(vm.actionError()).not.toBeNull();

      // Now succeed
      fakeActualizar.willResolve();
      await vm.toggleStudent('s-3');
      expect(vm.actionError()).toBeNull();
    });
  });

  describe('Scenario: Clasificador por tipo de error, NOT por body.message', () => {
    it('actionError usa instanceof ExamPreconditionError, no comparación de strings', async () => {
      const { vm, store, fakeGetDetail, fakeListStudents, fakeIniciar } = setup('rec-1');

      store.setExams([
        buildTutorExam({
          recordId: 'rec-1',
          classroomId: 'cls-1',
          serverStatus: new ExamServerStatus('scheduled'),
        }),
      ]);
      fakeGetDetail.willResolve(
        buildDetail({ status: new ExamServerStatus('scheduled'), enabledStudentIds: ['s-1'] }),
      );
      fakeListStudents.willResolve([buildStudent()]);
      // ExamPreconditionError with no message to prove we don't rely on body.message
      fakeIniciar.willReject(new ExamPreconditionError('mensaje_del_backend'));

      await vm.load();
      await vm.iniciar();

      // The actionError should be our predefined Spanish copy, NOT the backend message
      const msg = vm.actionError();
      expect(msg).not.toBeNull();
      expect(msg).not.toContain('mensaje_del_backend');
    });
  });

  // ── Network error + retry (D3) ──────────────────────────────────────────────

  describe('Scenario: Error de red en carga inicial → estado de error con botón reintentar', () => {
    it('NetworkError en GetTutorExamDetail → error()="network"', async () => {
      const { vm, store, fakeGetDetail, fakeListStudents } = setup('rec-1');

      store.setExams([buildTutorExam({ recordId: 'rec-1', classroomId: 'cls-1' })]);
      fakeGetDetail.willReject(new NetworkError());
      fakeListStudents.willResolve([]);

      await vm.load();

      expect(vm.error()).toBe('network');
    });
  });

  describe('Scenario: Reintentar dispara nueva carga', () => {
    it('retry() invoca la carga de nuevo; en éxito error()=null', async () => {
      const { vm, store, fakeGetDetail, fakeListStudents } = setup('rec-1');

      store.setExams([buildTutorExam({ recordId: 'rec-1', classroomId: 'cls-1' })]);
      fakeGetDetail.willReject(new NetworkError());
      fakeListStudents.willResolve([]);

      await vm.load();
      expect(vm.error()).toBe('network');

      const callsBefore = fakeGetDetail.callCount;
      fakeGetDetail.willResolve(buildDetail());
      await vm.retry();

      expect(fakeGetDetail.callCount).toBeGreaterThan(callsBefore);
      expect(vm.error()).toBeNull();
    });
  });

  describe('Scenario: VM NOT encola acciones fallidas (D3)', () => {
    it('IniciarExamenUseCase rechaza con NetworkError → no escribe en IDB ni outbox', async () => {
      const { vm, store, fakeGetDetail, fakeListStudents, fakeIniciar } = setup('rec-1');

      store.setExams([
        buildTutorExam({
          recordId: 'rec-1',
          classroomId: 'cls-1',
          serverStatus: new ExamServerStatus('scheduled'),
        }),
      ]);
      fakeGetDetail.willResolve(
        buildDetail({ status: new ExamServerStatus('scheduled'), enabledStudentIds: ['s-1'] }),
      );
      fakeListStudents.willResolve([buildStudent()]);
      fakeIniciar.willReject(new NetworkError());

      await vm.load();
      await vm.iniciar();

      // actionError set but nothing queued
      expect(vm.actionError()).not.toBeNull();
      // Structural check: ViewModel has no IDB/outbox reference (verified by absence of those imports)
      expect(typeof (vm as unknown as { enqueueEnvio?: unknown }).enqueueEnvio).toBe('undefined');
    });
  });

  // ── Local provider ──────────────────────────────────────────────────────────

  describe('Scenario: VM es local al componente page (NOT providedIn root)', () => {
    it('TutorExamDetailViewModel no tiene providedIn en su decorador', () => {
      const meta = (TutorExamDetailViewModel as unknown as { ɵprov?: { providedIn?: unknown } })
        .ɵprov;
      expect(meta?.providedIn).not.toBe('root');
    });
  });
});
