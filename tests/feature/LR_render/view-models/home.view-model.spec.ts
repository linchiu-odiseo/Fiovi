import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Component } from '@angular/core';
import { HomePageViewModel } from '../../../../src/LR_render/view-models/home.view-model';
import { GetIdentityUseCase } from '../../../../src/L2_application/use-cases/get-identity.use-case';
import { GetProfileUseCase } from '../../../../src/L2_application/use-cases/get-profile.use-case';
import { GetTodaysExamsUseCase } from '../../../../src/L2_application/use-cases/get-todays-exams.use-case';
import { LogoutUseCase } from '../../../../src/L2_application/use-cases/logout.use-case';
import { CLOCK, MARKINGS_STORAGE } from '../../../../src/app.config';
import { Identity, Role } from '../../../../src/L1_domain/entities/identity';
import { StudentProfile } from '../../../../src/L1_domain/value-objects/student-profile';
import { TutorProfile } from '../../../../src/L1_domain/value-objects/tutor-profile';
import { Exam } from '../../../../src/L1_domain/entities/exam';
import { ExamServerStatus } from '../../../../src/L1_domain/value-objects/exam-server-status';
import { ServerTime } from '../../../../src/L1_domain/value-objects/server-time';
import { SubmissionAck } from '../../../../src/L1_domain/value-objects/submission-ack';
import { NetworkError } from '../../../../src/L1_domain/errors/network.error';
import { SessionExpiredError } from '../../../../src/L1_domain/errors/session-expired.error';
import { ProfileNotAvailableError } from '../../../../src/L1_domain/errors/profile-not-available.error';
import { OfflineStorageUnavailableError } from '../../../../src/L1_domain/errors/offline-storage-unavailable.error';
import { ExamsPermissionRevokedError } from '../../../../src/L1_domain/errors/exams-permission-revoked.error';
import { StudentNotLinkedError } from '../../../../src/L1_domain/errors/student-not-linked.error';
import { Clock } from '../../../../src/L1_domain/ports/clock';
import {
  AlternativaValue,
  AnswersMap,
  EnvioPendiente,
  MarkingsStorage,
} from '../../../../src/L1_domain/ports/markings-storage';

// Stubs de ruta para que provideRouter no se queje cuando el VM navega.
@Component({ template: '' })
class LoginStub {}

function buildIdentity(role: 'student' | 'tutor' = 'student'): Identity {
  const email = role === 'student' ? '79507732@vonex.edu.pe' : 'tutor1@vonex.pe';
  const codigo = role === 'student' ? '79507732' : null;
  return new Identity('user-id', 'tenant-id', 'vonex', email, codigo, [role], Date.now() + 900_000);
}

const buildStudentProfile = (overrides: Partial<StudentProfile> = {}): StudentProfile => ({
  id: 'student-id',
  code: '79507732',
  firstName: 'Gabriel',
  lastName: 'Acuña Acuña',
  area: null,
  ...overrides,
});

class FakeGetIdentityUseCase {
  private next: Identity | null = buildIdentity('student');

  willReturn(i: Identity | null) {
    this.next = i;
  }

  async execute(): Promise<Identity | null> {
    return this.next;
  }
}

// Soporta los modos: resolve inmediato, reject inmediato y suspender (para
// observar profileLoading=true mientras la promesa está en vuelo).
class FakeGetProfileUseCase {
  private mode: 'resolve' | 'reject' | 'suspend' = 'resolve';
  private resolved: StudentProfile | TutorProfile = buildStudentProfile();
  private rejected: Error = new Error('not configured');
  private pending: Promise<StudentProfile | TutorProfile> | null = null;
  private resolvePending: ((p: StudentProfile | TutorProfile) => void) | null = null;
  private rejectPending: ((e: Error) => void) | null = null;
  public calls: Role[] = [];

  willResolveStudent(profile: Partial<StudentProfile> = {}) {
    this.mode = 'resolve';
    this.resolved = buildStudentProfile(profile);
  }

  willReject(err: Error) {
    this.mode = 'reject';
    this.rejected = err;
  }

  willSuspend() {
    this.mode = 'suspend';
    this.pending = new Promise<StudentProfile | TutorProfile>((resolve, reject) => {
      this.resolvePending = resolve;
      this.rejectPending = reject;
    });
  }

  resolveNow(profile: Partial<StudentProfile> = {}) {
    this.resolvePending?.(buildStudentProfile(profile));
    this.pending = null;
    this.resolvePending = null;
    this.rejectPending = null;
  }

  rejectNow(err: Error) {
    this.rejectPending?.(err);
    this.pending = null;
    this.resolvePending = null;
    this.rejectPending = null;
  }

  async execute(role: Role): Promise<StudentProfile | TutorProfile> {
    this.calls.push(role);
    if (this.mode === 'suspend' && this.pending) {
      return await this.pending;
    }
    if (this.mode === 'reject') throw this.rejected;
    return this.resolved;
  }
}

class FakeGetTodaysExamsUseCase {
  private next: { kind: 'resolve'; list: readonly Exam[] } | { kind: 'reject'; error: Error } = {
    kind: 'resolve',
    list: [],
  };
  public callCount = 0;

  willResolve(list: readonly Exam[]) {
    this.next = { kind: 'resolve', list };
  }
  willReject(error: Error) {
    this.next = { kind: 'reject', error };
  }

  async execute(): Promise<readonly Exam[]> {
    this.callCount++;
    if (this.next.kind === 'reject') throw this.next.error;
    return this.next.list;
  }
}

class FakeLogoutUseCase {
  public callCount = 0;
  async execute(): Promise<void> {
    this.callCount++;
  }
}

class FakeClock implements Clock {
  private current: Date = new Date('2026-06-11T10:00:00Z');

  setNow(d: Date) {
    this.current = d;
  }
  now(): Date {
    return this.current;
  }
  setServerTime(_st: ServerTime): void {
    /* no-op */
  }
}

// Por defecto `getSubmissionAck` retorna null (sin ack persistido).
// Sobreescribible vía `seedAck(examId, ack)` con un SubmissionAck real para
// tests que activan el card-state `enviado`.
class FakeMarkingsStorage implements MarkingsStorage {
  private next: { kind: 'resolve'; list: EnvioPendiente[] } | { kind: 'reject'; error: Error } = {
    kind: 'resolve',
    list: [],
  };
  private acks = new Map<string, SubmissionAck>();

  willResolveEnviosPendientes(list: EnvioPendiente[] = []) {
    this.next = { kind: 'resolve', list };
  }
  willRejectEnviosPendientes(error: Error) {
    this.next = { kind: 'reject', error };
  }
  seedAck(examId: string, ack: SubmissionAck) {
    this.acks.set(examId, ack);
  }

  async getEnviosPendientes(): Promise<EnvioPendiente[]> {
    if (this.next.kind === 'reject') throw this.next.error;
    return this.next.list;
  }
  async getSubmissionAck(examId: string): Promise<SubmissionAck | null> {
    return this.acks.get(examId) ?? null;
  }
  async setSubmissionAck(examId: string, ack: SubmissionAck): Promise<void> {
    this.acks.set(examId, ack);
  }
  async setMarcacion(
    _examId: string,
    _pregunta: number,
    _alternativa: AlternativaValue,
  ): Promise<void> {
    /* no-op */
  }
  async getMarcaciones(_examId: string): Promise<AnswersMap> {
    return {};
  }
  async clearMarcaciones(_examId: string): Promise<void> {
    /* no-op */
  }
  async enqueueEnvio(_envio: EnvioPendiente): Promise<void> {
    /* no-op */
  }
  async dequeueEnvio(_examId: string): Promise<void> {
    /* no-op */
  }
  async getAdmissionArea(_examId: string): Promise<null> {
    return null;
  }
  async setAdmissionArea(_examId: string, _area: unknown): Promise<void> {
    /* no-op */
  }
  async wipeUserScope(): Promise<void> {
    /* no-op */
  }
}

// Hash sha256 hex válido (64 chars) para construir SubmissionAck en tests.
const VALID_HASH = 'a3f5c8d1b2e4f6a8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

const buildAck = (id = 'ack-1', submittedIso = '2026-06-11T11:30:00.000Z'): SubmissionAck =>
  new SubmissionAck(id, VALID_HASH, new Date(submittedIso));

const buildExam = (
  id: string,
  serverStatusValue: 'scheduled' | 'in_progress' | 'finalized',
  overrides: Partial<{
    area: string | null;
    course: string | null;
    duration: number;
    scheduled: Date;
    started: Date | null;
    finished: Date | null;
  }> = {},
): Exam => {
  const inProgress = serverStatusValue === 'in_progress';
  const finalized = serverStatusValue === 'finalized';
  return new Exam({
    id,
    area: 'area' in overrides ? (overrides.area ?? null) : 'Matemática',
    course: 'course' in overrides ? (overrides.course ?? null) : 'Aritmética',
    type: 'simulacro',
    name: `Examen ${id}`,
    count: 20,
    duration: overrides.duration ?? 7200,
    scheduled: overrides.scheduled ?? new Date('2026-06-11T10:00:00Z'),
    started:
      'started' in overrides
        ? (overrides.started ?? null)
        : inProgress || finalized
          ? new Date('2026-06-11T10:00:05Z')
          : null,
    finished:
      'finished' in overrides
        ? (overrides.finished ?? null)
        : finalized
          ? new Date('2026-06-11T12:00:00Z')
          : null,
    openUntil: null,
    serverStatus: new ExamServerStatus(serverStatusValue),
  });
};

// Helper para setear visibility en jsdom (el getter es de solo-lectura por default).
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

describe('HomePageViewModel', () => {
  let fakeGetIdentity: FakeGetIdentityUseCase;
  let fakeGetProfile: FakeGetProfileUseCase;
  let fakeGetTodaysExams: FakeGetTodaysExamsUseCase;
  let fakeLogout: FakeLogoutUseCase;
  let fakeClock: FakeClock;
  let fakeMarkings: FakeMarkingsStorage;

  // Instanciamos el VM dentro del contexto de inyección para que inject()
  // resuelva contra el TestBed providers.
  const createVm = (): HomePageViewModel =>
    TestBed.runInInjectionContext(() => new HomePageViewModel());

  beforeEach(async () => {
    fakeGetIdentity = new FakeGetIdentityUseCase();
    fakeGetProfile = new FakeGetProfileUseCase();
    fakeGetTodaysExams = new FakeGetTodaysExamsUseCase();
    fakeLogout = new FakeLogoutUseCase();
    fakeClock = new FakeClock();
    fakeMarkings = new FakeMarkingsStorage();

    // Default: visible. Cada test que necesite hidden lo cambia explícito.
    setDocumentVisibility('visible');

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'login', component: LoginStub }]),
        { provide: GetIdentityUseCase, useValue: fakeGetIdentity },
        { provide: GetProfileUseCase, useValue: fakeGetProfile },
        { provide: GetTodaysExamsUseCase, useValue: fakeGetTodaysExams },
        { provide: LogoutUseCase, useValue: fakeLogout },
        { provide: CLOCK, useValue: fakeClock },
        { provide: MARKINGS_STORAGE, useValue: fakeMarkings },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    setDocumentVisibility('visible');
  });

  describe('loadUserProfile() — identity + profile', () => {
    it('identity válida + profile exitoso → userEmail, userName, userDni seteados', async () => {
      fakeGetIdentity.willReturn(buildIdentity('student'));
      fakeGetProfile.willResolveStudent({
        firstName: 'Gabriel',
        lastName: 'Acuña Acuña',
        code: '79507732',
      });
      fakeGetTodaysExams.willResolve([]);

      const vm = createVm();
      await vm.start();
      await Promise.resolve();
      await Promise.resolve();

      expect(vm.userEmail()).toBe('79507732@vonex.edu.pe');
      expect(vm.userName()).toBe('Gabriel Acuña Acuña');
      expect(vm.userDni()).toBe('79507732');
      expect(vm.profileUnavailable()).toBe(false);
      vm.stop();
    });

    it('ProfileNotAvailableError → profileUnavailable=true, userName y userDni null', async () => {
      fakeGetIdentity.willReturn(buildIdentity('student'));
      fakeGetProfile.willReject(new ProfileNotAvailableError());
      fakeGetTodaysExams.willResolve([]);

      const vm = createVm();
      await vm.start();
      await Promise.resolve();
      await Promise.resolve();

      expect(vm.profileUnavailable()).toBe(true);
      expect(vm.userEmail()).toBe('79507732@vonex.edu.pe');
      expect(vm.userName()).toBeNull();
      expect(vm.userDni()).toBeNull();
      vm.stop();
    });

    it('sin identity (caso defensivo) → userEmail null y NO se llama a getProfile', async () => {
      fakeGetIdentity.willReturn(null);
      fakeGetTodaysExams.willResolve([]);

      const vm = createVm();
      await vm.start();
      await Promise.resolve();
      await Promise.resolve();

      expect(vm.userEmail()).toBeNull();
      expect(fakeGetProfile.calls).toEqual([]);
      vm.stop();
    });
  });

  describe('start() — pre-check de IndexedDB', () => {
    it('marca offlineStorageBlocked=true cuando el pre-check rechaza con OfflineStorageUnavailableError', async () => {
      fakeMarkings.willRejectEnviosPendientes(
        new OfflineStorageUnavailableError('IDB unavailable'),
      );
      fakeGetTodaysExams.willResolve([]);

      const vm = createVm();
      await vm.start();

      expect(vm.offlineStorageBlocked()).toBe(true);
      vm.stop();
    });
  });

  describe('start() + primer fetch', () => {
    it('después del primer fetch exitoso, exams() tiene la lista y isLoading() es false', async () => {
      const list = [buildExam('exam-1', 'in_progress'), buildExam('exam-2', 'scheduled')];
      fakeGetTodaysExams.willResolve(list);

      const vm = createVm();
      await vm.start();

      expect(vm.exams()).toEqual(list);
      expect(vm.isLoading()).toBe(false);
      expect(vm.serverError()).toBeNull();
      expect(vm.lastRefreshAt()).not.toBeNull();
      vm.stop();
    });
  });

  describe('refresh() — clasificación de errores', () => {
    it('SessionExpiredError setea serverError=session-expired y navega a /login', async () => {
      fakeGetTodaysExams.willResolve([]);
      const vm = createVm();
      await vm.start();

      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      fakeGetTodaysExams.willReject(new SessionExpiredError());
      await vm.refresh();

      expect(vm.serverError()).toBe('session-expired');
      expect(navigateSpy).toHaveBeenCalledWith(['/login']);
      vm.stop();
    });

    it('NetworkError setea serverError=network sin navegar', async () => {
      fakeGetTodaysExams.willResolve([]);
      const vm = createVm();
      await vm.start();

      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      fakeGetTodaysExams.willReject(new NetworkError());
      await vm.refresh();

      expect(vm.serverError()).toBe('network');
      expect(navigateSpy).not.toHaveBeenCalled();
      vm.stop();
    });

    it('ExamsPermissionRevokedError → invoca LogoutUseCase exactamente 1 vez y limpia exams', async () => {
      fakeGetTodaysExams.willResolve([buildExam('exam-1', 'in_progress')]);
      const vm = createVm();
      await vm.start();
      expect(vm.exams()).toHaveLength(1);

      fakeGetTodaysExams.willReject(new ExamsPermissionRevokedError());
      await vm.refresh();
      // Cedemos microtask para que el `void this.logoutUseCase.execute()` corra.
      await Promise.resolve();
      await Promise.resolve();

      expect(fakeLogout.callCount).toBe(1);
      expect(vm.exams()).toEqual([]);
      vm.stop();
    });

    it('StudentNotLinkedError → studentNotLinked()=true y exams vacío sin error', async () => {
      fakeGetTodaysExams.willResolve([buildExam('exam-1', 'in_progress')]);
      const vm = createVm();
      await vm.start();

      fakeGetTodaysExams.willReject(new StudentNotLinkedError());
      await vm.refresh();

      expect(vm.studentNotLinked()).toBe(true);
      expect(vm.exams()).toEqual([]);
      expect(vm.serverError()).toBeNull();
      vm.stop();
    });

    it('happy path tras StudentNotLinkedError limpia el flag studentNotLinked', async () => {
      fakeGetTodaysExams.willResolve([]);
      const vm = createVm();
      await vm.start();

      fakeGetTodaysExams.willReject(new StudentNotLinkedError());
      await vm.refresh();
      expect(vm.studentNotLinked()).toBe(true);

      fakeGetTodaysExams.willResolve([buildExam('exam-1', 'in_progress')]);
      await vm.refresh();
      expect(vm.studentNotLinked()).toBe(false);
      vm.stop();
    });
  });

  describe('cards() — composición de estado por (serverStatus, ack)', () => {
    it('serverStatus=scheduled (sin ack) → estado="pendiente", not clickable', async () => {
      fakeGetTodaysExams.willResolve([buildExam('exam-sch', 'scheduled')]);
      const vm = createVm();
      await vm.start();

      const card = vm.cards()[0];
      expect(card.estado).toBe('pendiente');
      expect(card.clickable).toBe(false);
      vm.stop();
    });

    it('serverStatus=in_progress + ack=null → estado="abierto", clickable', async () => {
      fakeGetTodaysExams.willResolve([buildExam('exam-open', 'in_progress')]);
      const vm = createVm();
      await vm.start();

      const card = vm.cards()[0];
      expect(card.estado).toBe('abierto');
      expect(card.clickable).toBe(true);
      vm.stop();
    });

    // Scenario "in_progress con ack → enviado" del spec exam-marking.
    it('serverStatus=in_progress + ack persistido → estado="enviado", primaryText con HH:MM del ack.submittedAt', async () => {
      fakeMarkings.seedAck('exam-ip-ack', buildAck('ack-1', '2026-06-11T11:30:00.000Z'));
      fakeGetTodaysExams.willResolve([buildExam('exam-ip-ack', 'in_progress')]);
      const vm = createVm();
      await vm.start();

      const card = vm.cards()[0];
      expect(card.estado).toBe('enviado');
      expect(card.clickable).toBe(false);
      // primaryText usa ack.submittedAt — NO exam.effectiveCloseAt.
      const submittedAt = new Date('2026-06-11T11:30:00.000Z');
      const hh = String(submittedAt.getHours()).padStart(2, '0');
      const mm = String(submittedAt.getMinutes()).padStart(2, '0');
      expect(card.primaryText).toBe(`Enviado · ${hh}:${mm}`);
      vm.stop();
    });

    // Scenario "finalized con ack → enviado" del spec exam-marking.
    it('serverStatus=finalized + ack persistido → estado="enviado"', async () => {
      fakeMarkings.seedAck('exam-fin-ack', buildAck('ack-2'));
      fakeGetTodaysExams.willResolve([buildExam('exam-fin-ack', 'finalized')]);
      const vm = createVm();
      await vm.start();

      const card = vm.cards()[0];
      expect(card.estado).toBe('enviado');
      expect(card.clickable).toBe(false);
      vm.stop();
    });

    it('serverStatus=finalized + ack=null → estado="cerrado", not clickable', async () => {
      fakeGetTodaysExams.willResolve([buildExam('exam-closed', 'finalized')]);
      const vm = createVm();
      await vm.start();

      const card = vm.cards()[0];
      expect(card.estado).toBe('cerrado');
      expect(card.clickable).toBe(false);
      vm.stop();
    });

    // Scenario "secondaryText en estado enviado" del spec exam-marking.
    it('estado=enviado → secondaryText = "Pendiente de calificación" (reemplaza fallback area/course)', async () => {
      fakeMarkings.seedAck('exam-ip-ack', buildAck('ack-1'));
      fakeGetTodaysExams.willResolve([buildExam('exam-ip-ack', 'in_progress')]);
      const vm = createVm();
      await vm.start();

      expect(vm.cards()[0].secondaryText).toBe('Pendiente de calificación');
      vm.stop();
    });
  });

  describe('cards() — secondaryText fallback area ?? course ?? "—"', () => {
    it('area presente → muestra el area en secondaryText', async () => {
      fakeGetTodaysExams.willResolve([
        buildExam('exam-1', 'in_progress', { area: 'Razonamiento', course: null }),
      ]);
      const vm = createVm();
      await vm.start();

      expect(vm.cards()[0].secondaryText).toContain('Razonamiento');
      vm.stop();
    });

    it('area null + course presente → fallback a course', async () => {
      fakeGetTodaysExams.willResolve([
        buildExam('exam-1', 'in_progress', { area: null, course: 'Matemática' }),
      ]);
      const vm = createVm();
      await vm.start();

      expect(vm.cards()[0].secondaryText).toContain('Matemática');
      vm.stop();
    });

    it('area y course null → fallback al guion "—"', async () => {
      fakeGetTodaysExams.willResolve([
        buildExam('exam-1', 'in_progress', { area: null, course: null }),
      ]);
      const vm = createVm();
      await vm.start();

      expect(vm.cards()[0].secondaryText).toContain('—');
      vm.stop();
    });
  });

  describe('polling cada 120s', () => {
    it('después de 120s desde start(), invoca getTodaysExams.execute() una segunda vez', async () => {
      fakeGetTodaysExams.willResolve([]);
      vi.useFakeTimers();
      setDocumentVisibility('visible');

      const vm = createVm();
      await vm.start();
      const callsAfterStart = fakeGetTodaysExams.callCount;

      await vi.advanceTimersByTimeAsync(120_000);

      expect(fakeGetTodaysExams.callCount).toBe(callsAfterStart + 1);
      vm.stop();
    });

    it('NO arranca polling si la pestaña no está visible al momento de start()', async () => {
      fakeGetTodaysExams.willResolve([]);
      setDocumentVisibility('hidden');
      vi.useFakeTimers();

      const vm = createVm();
      await vm.start();
      const callsAfterStart = fakeGetTodaysExams.callCount;

      await vi.advanceTimersByTimeAsync(360_000);

      expect(fakeGetTodaysExams.callCount).toBe(callsAfterStart);
      vm.stop();
    });
  });

  describe('degradación graceful: dos exámenes in_progress', () => {
    it('emite console.warn con count + primer id cuando vienen 2 in_progress simultáneos', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      fakeGetTodaysExams.willResolve([
        buildExam('exam-A', 'in_progress'),
        buildExam('exam-B', 'in_progress'),
      ]);

      const vm = createVm();
      await vm.start();

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const message = warnSpy.mock.calls[0][0] as string;
      expect(message).toContain('2');
      expect(message).toContain('exam-A');
      vm.stop();
    });

    it('NO emite warn cuando hay un único examen in_progress', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      fakeGetTodaysExams.willResolve([
        buildExam('exam-A', 'in_progress'),
        buildExam('exam-B', 'scheduled'),
      ]);

      const vm = createVm();
      await vm.start();

      expect(warnSpy).not.toHaveBeenCalled();
      vm.stop();
    });
  });
});
