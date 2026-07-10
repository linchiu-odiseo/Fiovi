import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TutorExamsListViewModel } from '../../../../src/LR_render/view-models/tutor-exams-list.view-model';
import { TutorExamsStore } from '../../../../src/LR_render/state/tutor-exams.store';
import { GetTutorExamsUseCase } from '../../../../src/L2_application/use-cases/get-tutor-exams.use-case';
import { GetProfileUseCase } from '../../../../src/L2_application/use-cases/get-profile.use-case';
import { LogoutUseCase } from '../../../../src/L2_application/use-cases/logout.use-case';
import { GetIdentityUseCase } from '../../../../src/L2_application/use-cases/get-identity.use-case';
import { TutorExam } from '../../../../src/L1_domain/entities/tutor-exam';
import { ExamServerStatus } from '../../../../src/L1_domain/value-objects/exam-server-status';
import { NetworkError } from '../../../../src/L1_domain/errors/network.error';
import { ProfileNotAvailableError } from '../../../../src/L1_domain/errors/profile-not-available.error';
import { TutorProfile, TutorClassroom } from '../../../../src/L1_domain/value-objects/tutor-profile';
import { Role } from '../../../../src/L1_domain/entities/identity';
import { StudentProfile } from '../../../../src/L1_domain/value-objects/student-profile';

class FakeRouter {
  public navigateCalls: unknown[][] = [];
  async navigate(commands: unknown[]): Promise<boolean> {
    this.navigateCalls.push(commands);
    return true;
  }
}

// Helper para simular cambios de visibilidad en jsdom.
const setDocumentVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    configurable: true,
  });
  Object.defineProperty(document, 'hidden', {
    value: state === 'hidden',
    configurable: true,
  });
};

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

class FakeGetTutorExamsUseCase {
  private _next:
    | { kind: 'resolve'; list: readonly TutorExam[] }
    | { kind: 'reject'; error: Error } = { kind: 'resolve', list: [] };
  public callCount = 0;

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

const CLASSROOM_A: TutorClassroom = {
  id: 'cls-a',
  code: 'AULA-A',
  name: 'Matemáticas I',
  modality: 'presencial',
  shift: 'manana',
  campusName: 'Campus Norte',
  cycleId: 'cycle-1',
  cycleName: 'Ciclo 2026-I',
  studentCount: 30,
};

const CLASSROOM_B: TutorClassroom = {
  id: 'cls-b',
  code: 'AULA-B',
  name: 'Física II',
  modality: 'virtual',
  shift: 'tarde',
  campusName: null,
  cycleId: 'cycle-2',
  cycleName: 'Ciclo 2026-II',
  studentCount: 25,
};

class FakeGetProfileUseCase {
  public calls: Role[] = [];
  classrooms: readonly TutorClassroom[] = [];
  async execute(role: Role): Promise<StudentProfile | TutorProfile> {
    this.calls.push(role);
    return {
      id: 'tutor-id',
      code: 'T001',
      firstName: 'Carlos',
      lastName: 'Mendoza',
      email: 'tutor1@example.pe',
      classrooms: this.classrooms,
    };
  }
}

class FakeLogoutUseCase {
  public callCount = 0;
  async execute(): Promise<void> {
    this.callCount++;
  }
}

class FakeGetIdentityUseCase {
  async execute() {
    return null;
  }
}

describe('TutorExamsListViewModel', () => {
  let fakeGetTutorExams: FakeGetTutorExamsUseCase;
  let fakeGetProfile: FakeGetProfileUseCase;
  let fakeLogout: FakeLogoutUseCase;
  let fakeGetIdentity: FakeGetIdentityUseCase;
  let fakeRouter: FakeRouter;
  let store: TutorExamsStore;

  const createVm = (): TutorExamsListViewModel =>
    TestBed.runInInjectionContext(() => new TutorExamsListViewModel());

  beforeEach(async () => {
    fakeGetTutorExams = new FakeGetTutorExamsUseCase();
    fakeGetProfile = new FakeGetProfileUseCase();
    fakeLogout = new FakeLogoutUseCase();
    fakeGetIdentity = new FakeGetIdentityUseCase();
    fakeRouter = new FakeRouter();

    // Default: visible
    setDocumentVisibility('visible');

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      providers: [
        TutorExamsStore,
        { provide: GetTutorExamsUseCase, useValue: fakeGetTutorExams },
        { provide: GetProfileUseCase, useValue: fakeGetProfile },
        { provide: LogoutUseCase, useValue: fakeLogout },
        { provide: GetIdentityUseCase, useValue: fakeGetIdentity },
        { provide: Router, useValue: fakeRouter },
      ],
    }).compileComponents();

    store = TestBed.inject(TutorExamsStore);
  });

  afterEach(() => {
    vi.useRealTimers();
    setDocumentVisibility('visible');
  });

  describe('Scenario: Lista cargada correctamente al iniciar', () => {
    it('exams() contiene la lista, loading() false, error() false tras start exitoso', async () => {
      const exam1 = buildTutorExam({ recordId: 'rec-1' });
      const exam2 = buildTutorExam({ recordId: 'rec-2', detailId: 'det-2' });
      fakeGetTutorExams.willResolve([exam1, exam2]);

      const vm = createVm();
      await vm.start();

      expect(vm.exams()).toEqual([exam1, exam2]);
      expect(vm.loading()).toBe(false);
      expect(vm.error()).toBe(false);
      vm.stop();
    });
  });

  describe('Scenario: Error de red — error Signal activa, polling continúa', () => {
    it('NetworkError → error()=true, exams() sin cambios, polling continúa', async () => {
      const exam1 = buildTutorExam({ recordId: 'rec-1' });
      fakeGetTutorExams.willResolve([exam1]);
      vi.useFakeTimers();

      const vm = createVm();
      await vm.start();
      expect(vm.exams()).toHaveLength(1);
      expect(vm.error()).toBe(false);

      fakeGetTutorExams.willReject(new NetworkError());
      await vi.advanceTimersByTimeAsync(120_000);

      expect(vm.error()).toBe(true);
      // La lista anterior NO se limpia
      expect(vm.exams()).toHaveLength(1);

      // El polling continúa — siguientes ticks van a intentar de nuevo
      const callsAfterError = fakeGetTutorExams.callCount;
      fakeGetTutorExams.willResolve([exam1]);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(fakeGetTutorExams.callCount).toBeGreaterThan(callsAfterError);

      vm.stop();
    });

    it('carga exitosa posterior a un error limpia error()', async () => {
      fakeGetTutorExams.willReject(new NetworkError());

      const vm = createVm();
      await vm.start();
      expect(vm.error()).toBe(true);

      const exam1 = buildTutorExam({ recordId: 'rec-1' });
      fakeGetTutorExams.willResolve([exam1]);
      await vm.refresh();
      expect(vm.error()).toBe(false);
      vm.stop();
    });
  });

  describe('Scenario: Store actualizado tras polling', () => {
    it('carga exitosa llama store.setExams con la lista recibida', async () => {
      const exam1 = buildTutorExam({ recordId: 'rec-1' });
      const exam2 = buildTutorExam({ recordId: 'rec-2', detailId: 'det-2' });
      fakeGetTutorExams.willResolve([exam1, exam2]);

      const vm = createVm();
      await vm.start();

      expect(store.exams()).toHaveLength(2);
      expect(store.findByRecordId('rec-1')).toBe(exam1);
      expect(store.findByRecordId('rec-2')).toBe(exam2);
      vm.stop();
    });
  });

  describe('Scenario: Polling cada 120 s emite nuevo request', () => {
    it('después de 120 000 ms se emite una segunda llamada a GetTutorExamsUseCase.execute()', async () => {
      fakeGetTutorExams.willResolve([]);
      vi.useFakeTimers();
      setDocumentVisibility('visible');

      const vm = createVm();
      await vm.start();
      const callsAfterStart = fakeGetTutorExams.callCount;

      await vi.advanceTimersByTimeAsync(120_000);

      expect(fakeGetTutorExams.callCount).toBe(callsAfterStart + 1);
      vm.stop();
    });
  });

  describe('Scenario: Polling se pausa al ocultar el tab', () => {
    it('visibilityState=hidden → no se emiten más requests HTTP', async () => {
      fakeGetTutorExams.willResolve([]);
      vi.useFakeTimers();
      setDocumentVisibility('visible');

      const vm = createVm();
      await vm.start();
      const callsAfterStart = fakeGetTutorExams.callCount;

      // Ocultar tab
      setDocumentVisibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));

      await vi.advanceTimersByTimeAsync(360_000); // 3 ticks que no deben ocurrir

      expect(fakeGetTutorExams.callCount).toBe(callsAfterStart);
      vm.stop();
    });
  });

  describe('Scenario: Polling se reanuda al volver al tab', () => {
    it('visibilitychange a visible → dispara una carga inmediata y reanuda el intervalo', async () => {
      fakeGetTutorExams.willResolve([]);
      vi.useFakeTimers();

      // Arrancar con tab oculto para que no haya polling
      setDocumentVisibility('hidden');

      const vm = createVm();
      await vm.start();
      const callsWhileHidden = fakeGetTutorExams.callCount;

      // Volver a visible
      setDocumentVisibility('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
      await Promise.resolve();

      // Debe haber disparado una carga inmediata
      expect(fakeGetTutorExams.callCount).toBeGreaterThan(callsWhileHidden);

      // Y reanuda el intervalo a los 120s
      const callsAfterResume = fakeGetTutorExams.callCount;
      await vi.advanceTimersByTimeAsync(120_000);
      expect(fakeGetTutorExams.callCount).toBeGreaterThan(callsAfterResume);

      vm.stop();
    });
  });

  describe('Scenario: VM es local al componente page (NOT providedIn root)', () => {
    it('TutorExamsListViewModel no tiene providedIn en su decorador', () => {
      // El VM es @Injectable() sin providedIn — si lo creamos directamente
      // sin el contexto de TestBed, TypeScript compila pero Angular DI lanza error.
      // Verificamos estructuralmente: la clase no tiene el metadata de 'root'.
      const meta = (TutorExamsListViewModel as unknown as { ɵprov?: { providedIn?: unknown } })
        .ɵprov;
      // Si ɵprov existe y providedIn === 'root', es un singleton global — NO debe ser así.
      expect(meta?.providedIn).not.toBe('root');
    });
  });

  describe('loading() durante la carga', () => {
    it('loading() es true mientras GetTutorExamsUseCase está en vuelo', async () => {
      let resolveExams!: (list: readonly TutorExam[]) => void;
      const suspendedPromise = new Promise<readonly TutorExam[]>((res) => {
        resolveExams = res;
      });
      fakeGetTutorExams.execute = async () => {
        fakeGetTutorExams.callCount++;
        return suspendedPromise;
      };

      const vm = createVm();
      const startPromise = vm.start();
      // Cedemos microtasks para que el VM avance hasta el await
      await Promise.resolve();
      await Promise.resolve();

      expect(vm.loading()).toBe(true);

      resolveExams([]);
      await startPromise;

      expect(vm.loading()).toBe(false);
      vm.stop();
    });
  });

  // ── Nuevos escenarios: profile completo + classrooms + logout ────────────────

  describe('Scenario: classrooms y userCode expuestos desde el perfil', () => {
    it('classrooms() contiene los aulas del perfil después de start()', async () => {
      fakeGetProfile.classrooms = [CLASSROOM_A, CLASSROOM_B];
      fakeGetTutorExams.willResolve([]);

      const vm = createVm();
      await vm.start();

      expect(vm.classrooms()).toEqual([CLASSROOM_A, CLASSROOM_B]);
      vm.stop();
    });

    it('userCode() refleja el código del perfil', async () => {
      fakeGetProfile.classrooms = [];
      fakeGetTutorExams.willResolve([]);

      const vm = createVm();
      await vm.start();

      expect(vm.userCode()).toBe('T001');
      vm.stop();
    });

    it('profileEmail() refleja el email del perfil', async () => {
      fakeGetProfile.classrooms = [];
      fakeGetTutorExams.willResolve([]);

      const vm = createVm();
      await vm.start();

      expect(vm.profileEmail()).toBe('tutor1@example.pe');
      vm.stop();
    });
  });

  describe('Scenario: classroomCount y studentTotal computados', () => {
    it('classroomCount() es el largo del array classrooms', async () => {
      fakeGetProfile.classrooms = [CLASSROOM_A, CLASSROOM_B];
      fakeGetTutorExams.willResolve([]);

      const vm = createVm();
      await vm.start();

      expect(vm.classroomCount()).toBe(2);
      vm.stop();
    });

    it('studentTotal() es la suma de studentCount de todas las aulas', async () => {
      fakeGetProfile.classrooms = [CLASSROOM_A, CLASSROOM_B]; // 30 + 25 = 55
      fakeGetTutorExams.willResolve([]);

      const vm = createVm();
      await vm.start();

      expect(vm.studentTotal()).toBe(55);
      vm.stop();
    });

    it('hasClassrooms() es false cuando classrooms está vacío', async () => {
      fakeGetProfile.classrooms = [];
      fakeGetTutorExams.willResolve([]);

      const vm = createVm();
      await vm.start();

      expect(vm.hasClassrooms()).toBe(false);
      vm.stop();
    });

    it('hasClassrooms() es true cuando hay al menos una aula', async () => {
      fakeGetProfile.classrooms = [CLASSROOM_A];
      fakeGetTutorExams.willResolve([]);

      const vm = createVm();
      await vm.start();

      expect(vm.hasClassrooms()).toBe(true);
      vm.stop();
    });
  });

  describe('Scenario: signOut llama LogoutUseCase y maneja isSigningOut', () => {
    it('signOut() invoca LogoutUseCase.execute()', async () => {
      fakeGetTutorExams.willResolve([]);

      const vm = createVm();
      await vm.start();

      await vm.signOut();

      expect(fakeLogout.callCount).toBe(1);
      vm.stop();
    });

    it('isSigningOut() es false antes de signOut()', async () => {
      fakeGetTutorExams.willResolve([]);

      const vm = createVm();
      await vm.start();

      expect(vm.isSigningOut()).toBe(false);
      vm.stop();
    });

    it('isSigningOut() es false después de signOut() completado', async () => {
      fakeGetTutorExams.willResolve([]);

      const vm = createVm();
      await vm.start();

      await vm.signOut();

      expect(vm.isSigningOut()).toBe(false);
      vm.stop();
    });

    it('llamadas redundantes a signOut() mientras está en vuelo no duplican la ejecución', async () => {
      fakeGetTutorExams.willResolve([]);
      let resolveLogout!: () => void;
      fakeLogout.execute = () =>
        new Promise<void>((res) => {
          fakeLogout.callCount++;
          resolveLogout = res;
        });

      const vm = createVm();
      await vm.start();

      const p1 = vm.signOut();
      const p2 = vm.signOut(); // segunda llamada mientras la primera está pendiente

      resolveLogout();
      await Promise.all([p1, p2]);

      expect(fakeLogout.callCount).toBe(1); // solo una llamada real
      vm.stop();
    });
  });

  describe('Scenario: profileUnavailable cuando ProfileNotAvailableError', () => {
    it('profileUnavailable() es true cuando getProfile lanza ProfileNotAvailableError', async () => {
      fakeGetProfile.execute = async () => {
        throw new ProfileNotAvailableError();
      };
      fakeGetTutorExams.willResolve([]);

      const vm = createVm();
      await vm.start();

      expect(vm.profileUnavailable()).toBe(true);
      vm.stop();
    });
  });
});
