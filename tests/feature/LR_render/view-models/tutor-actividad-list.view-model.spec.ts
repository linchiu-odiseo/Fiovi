import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TutorActividadListViewModel } from '../../../../src/LR_render/view-models/tutor-actividad-list.view-model';
import { GetTutorExamsFinalizadasUseCase } from '../../../../src/L2_application/use-cases/get-tutor-exams-finalizadas.use-case';
import { ArchivarExamenUseCase } from '../../../../src/L2_application/use-cases/archivar-examen.use-case';
import { TutorExam } from '../../../../src/L1_domain/entities/tutor-exam';
import { ExamServerStatus } from '../../../../src/L1_domain/value-objects/exam-server-status';
import { NetworkError } from '../../../../src/L1_domain/errors/network.error';
import { TutorExamForbiddenError } from '../../../../src/L1_domain/errors/tutor-exam-forbidden.error';
import { ExamConflictError } from '../../../../src/L1_domain/errors/exam-conflict.error';
import { VirtualExamNotFoundError } from '../../../../src/L1_domain/errors/virtual-exam-not-found.error';

function buildExam(overrides: Partial<{ recordId: string; finishedAt: Date }> = {}): TutorExam {
  return new TutorExam({
    detailId: `det-${overrides.recordId ?? 'r1'}`,
    recordId: overrides.recordId ?? 'rec-1',
    classroomId: 'cls-A',
    classroomCode: 'A-101',
    classroomName: 'Aula A',
    serverStatus: new ExamServerStatus('finalized'),
    name: 'Simulacro',
    course: 'ÁLGEBRA',
    area: 'Números',
    count: 20,
    duration: 900,
    scheduled: new Date('2026-07-30T14:00:00Z'),
    startedAt: new Date('2026-07-30T14:00:00Z'),
    finishedAt: overrides.finishedAt ?? new Date('2026-07-30T14:15:00Z'),
    openUntil: null,
  });
}

class FakeGetFinalizadas {
  private _next: readonly TutorExam[] | Error = [];
  public calls = 0;
  willResolve(items: readonly TutorExam[]): void {
    this._next = items;
  }
  willReject(err: Error): void {
    this._next = err;
  }
  async execute(): Promise<readonly TutorExam[]> {
    this.calls++;
    if (this._next instanceof Error) throw this._next;
    return this._next;
  }
}

class FakeArchivar {
  public calls: { recordId: string }[] = [];
  private _next: Error | null = null;
  willReject(err: Error): void {
    this._next = err;
  }
  async execute(req: { recordId: string }): Promise<void> {
    this.calls.push(req);
    if (this._next) throw this._next;
  }
}

describe('TutorActividadListViewModel', () => {
  let getFinalizadas: FakeGetFinalizadas;
  let archivar: FakeArchivar;
  let routerNavigate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    getFinalizadas = new FakeGetFinalizadas();
    archivar = new FakeArchivar();
    routerNavigate = vi.fn().mockResolvedValue(true);

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      providers: [
        TutorActividadListViewModel,
        { provide: GetTutorExamsFinalizadasUseCase, useValue: getFinalizadas },
        { provide: ArchivarExamenUseCase, useValue: archivar },
        { provide: Router, useValue: { navigate: routerNavigate } },
      ],
    }).compileComponents();
  });

  function createVm(): TutorActividadListViewModel {
    return TestBed.runInInjectionContext(() => new TutorActividadListViewModel());
  }

  describe('start() / refresh()', () => {
    it('carga y ordena por finishedAt desc', async () => {
      const older = buildExam({ recordId: 'r-old', finishedAt: new Date('2026-07-30T10:00:00Z') });
      const newer = buildExam({ recordId: 'r-new', finishedAt: new Date('2026-07-30T15:00:00Z') });
      getFinalizadas.willResolve([older, newer]);

      const vm = createVm();
      await vm.start();

      expect(getFinalizadas.calls).toBe(1);
      expect(vm.events().map((e) => e.recordId)).toEqual(['r-new', 'r-old']);
      expect(vm.isLoading()).toBe(false);
      expect(vm.loadError()).toBe(false);
    });

    it('NetworkError → loadError=true, events vacía', async () => {
      getFinalizadas.willReject(new NetworkError());
      const vm = createVm();
      await vm.start();

      expect(vm.loadError()).toBe(true);
      expect(vm.events()).toEqual([]);
    });
  });

  describe('archivar(recordId)', () => {
    it('happy path — llama al use case y refresca la lista', async () => {
      getFinalizadas.willResolve([buildExam({ recordId: 'r1' }), buildExam({ recordId: 'r2' })]);
      const vm = createVm();
      await vm.start();

      // Simulamos que después del archive queda solo r2.
      getFinalizadas.willResolve([buildExam({ recordId: 'r2' })]);
      await vm.archivar('r1');

      expect(archivar.calls).toEqual([{ recordId: 'r1' }]);
      // Fue una vez en start + una vez en refresh post-archive.
      expect(getFinalizadas.calls).toBe(2);
      expect(vm.events().map((e) => e.recordId)).toEqual(['r2']);
      expect(vm.archivingId()).toBeNull();
      expect(vm.archiveError()).toBeNull();
    });

    it('marca archivingId durante la operación y lo limpia al terminar', async () => {
      getFinalizadas.willResolve([buildExam({ recordId: 'r1' })]);
      const vm = createVm();
      await vm.start();

      const promise = vm.archivar('r1');
      // Todavía en curso — el use case es async.
      expect(vm.archivingId()).toBe('r1');
      await promise;
      expect(vm.archivingId()).toBeNull();
    });

    it('bloquea archives concurrentes — un segundo llamado se descarta si ya hay uno en curso', async () => {
      getFinalizadas.willResolve([buildExam({ recordId: 'r1' }), buildExam({ recordId: 'r2' })]);
      const vm = createVm();
      await vm.start();

      const first = vm.archivar('r1');
      // El segundo intento no debería llamar al use case ni cambiar archivingId.
      const second = vm.archivar('r2');
      expect(vm.archivingId()).toBe('r1');
      await Promise.all([first, second]);

      expect(archivar.calls).toEqual([{ recordId: 'r1' }]);
    });

    it('ExamConflictError → archiveError con copy de conflicto, no refresca', async () => {
      getFinalizadas.willResolve([buildExam({ recordId: 'r1' })]);
      const vm = createVm();
      await vm.start();
      const callsBeforeArchive = getFinalizadas.calls;

      archivar.willReject(new ExamConflictError('conflict'));
      await vm.archivar('r1');

      expect(vm.archiveError()).toBe('El examen ya fue archivado o todavía no está finalizado.');
      expect(getFinalizadas.calls).toBe(callsBeforeArchive);
      expect(vm.events()).toHaveLength(1);
    });

    it('VirtualExamNotFoundError → copy "ya no está disponible"', async () => {
      getFinalizadas.willResolve([buildExam({ recordId: 'r1' })]);
      const vm = createVm();
      await vm.start();

      archivar.willReject(new VirtualExamNotFoundError('gone'));
      await vm.archivar('r1');

      expect(vm.archiveError()).toBe('Este examen ya no está disponible.');
    });

    it('TutorExamForbiddenError → copy de permiso', async () => {
      getFinalizadas.willResolve([buildExam({ recordId: 'r1' })]);
      const vm = createVm();
      await vm.start();

      archivar.willReject(new TutorExamForbiddenError());
      await vm.archivar('r1');

      expect(vm.archiveError()).toBe('No tenés permiso para archivar este examen.');
    });

    it('NetworkError → copy "Sin conexión"', async () => {
      getFinalizadas.willResolve([buildExam({ recordId: 'r1' })]);
      const vm = createVm();
      await vm.start();

      archivar.willReject(new NetworkError());
      await vm.archivar('r1');

      expect(vm.archiveError()).toBe('Sin conexión. Revisá tu red y reintentá.');
    });

    it('error inesperado → copy genérico', async () => {
      getFinalizadas.willResolve([buildExam({ recordId: 'r1' })]);
      const vm = createVm();
      await vm.start();

      archivar.willReject(new Error('boom'));
      await vm.archivar('r1');

      expect(vm.archiveError()).toBe('Ocurrió un error al archivar el examen. Reintentá.');
    });

    it('dismissArchiveError() limpia el mensaje', async () => {
      getFinalizadas.willResolve([buildExam({ recordId: 'r1' })]);
      const vm = createVm();
      await vm.start();
      archivar.willReject(new NetworkError());
      await vm.archivar('r1');
      expect(vm.archiveError()).not.toBeNull();

      vm.dismissArchiveError();
      expect(vm.archiveError()).toBeNull();
    });
  });

  describe('goToExam()', () => {
    it('navega a /tutor/exams/:recordId con queryParam from=/tutor/actividad', async () => {
      const vm = createVm();
      const exam = buildExam({ recordId: 'r1' });

      vm.goToExam(exam);

      expect(routerNavigate).toHaveBeenCalledWith(['/tutor/exams', 'r1'], {
        queryParams: { from: '/tutor/actividad' },
      });
    });
  });
});
