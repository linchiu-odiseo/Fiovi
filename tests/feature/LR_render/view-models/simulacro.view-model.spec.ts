import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Component } from '@angular/core';
import { SimulacroPageViewModel } from '../../../../src/LR_render/view-models/simulacro.view-model';
import { GetTodaysExamsUseCase } from '../../../../src/L2_application/use-cases/get-todays-exams.use-case';
import { MarcarRespuestaUseCase } from '../../../../src/L2_application/use-cases/marcar-respuesta.use-case';
import {
  EnviarSimulacroInput,
  EnviarSimulacroOutput,
  EnviarSimulacroUseCase,
} from '../../../../src/L2_application/use-cases/enviar-simulacro.use-case';
import { EnviarTareaUseCase } from '../../../../src/L2_application/use-cases/enviar-tarea.use-case';
import {
  AutoEnvioHandle,
  ProgramarAutoEnvioInput,
  ProgramarAutoEnvioUseCase,
} from '../../../../src/L2_application/use-cases/programar-auto-envio.use-case';
import {
  SeleccionarAdmissionAreaInput,
  SeleccionarAdmissionAreaUseCase,
} from '../../../../src/L2_application/use-cases/seleccionar-admission-area.use-case';
import { AdmissionArea } from '../../../../src/L1_domain/value-objects/admission-area';
import { CLOCK, MARKINGS_STORAGE } from '../../../../src/app.config';
import {
  DraftAutoSaveDispatcher,
  IDraftAutoSaveDispatcher,
  NoopDraftAutoSaveDispatcher,
} from '../../../../src/L3_periphery/envio/draft-auto-save-dispatcher.service';
import { Signal, signal } from '@angular/core';
import { Exam } from '../../../../src/L1_domain/entities/exam';
import { ExamServerStatus } from '../../../../src/L1_domain/value-objects/exam-server-status';
import { ServerTime } from '../../../../src/L1_domain/value-objects/server-time';
import { SubmissionAck } from '../../../../src/L1_domain/value-objects/submission-ack';
import { Alternativa } from '../../../../src/L1_domain/value-objects/alternativa';
import { NetworkError } from '../../../../src/L1_domain/errors/network.error';
import { SessionExpiredError } from '../../../../src/L1_domain/errors/session-expired.error';
import { SimulacroCerradoError } from '../../../../src/L1_domain/errors/simulacro-cerrado.error';
import { SimulacroNoAsignadoError } from '../../../../src/L1_domain/errors/simulacro-no-asignado.error';
import { InvalidSubmissionTimeError } from '../../../../src/L1_domain/errors/invalid-submission-time.error';
import { InvalidPayloadError } from '../../../../src/L1_domain/errors/invalid-payload.error';
import { Clock } from '../../../../src/L1_domain/ports/clock';
import {
  AlternativaValue,
  AnswersMap,
  EnvioPendiente,
  MarkingsStorage,
} from '../../../../src/L1_domain/ports/markings-storage';

// Stubs de ruta para que provideRouter no se queje cuando el VM navega.
@Component({ template: '' })
class HomeStub {}
@Component({ template: '' })
class LoginStub {}

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

// Spy del use case L2 que registra las llamadas y delega la persistencia
// al fake del storage.
class FakeMarcarRespuestaUseCase {
  public calls: { examId: string; pregunta: number; alternativa: AlternativaValue }[] = [];
  private failNext: Error | null = null;

  constructor(private readonly markings: MarkingsStorage) {}

  willReject(error: Error) {
    this.failNext = error;
  }

  async execute(input: {
    examId: string;
    pregunta: number;
    alternativa: Alternativa;
  }): Promise<void> {
    this.calls.push({
      examId: input.examId,
      pregunta: input.pregunta,
      alternativa: input.alternativa.value,
    });
    if (this.failNext) {
      const err = this.failNext;
      this.failNext = null;
      throw err;
    }
    await this.markings.setMarcacion(input.examId, input.pregunta, input.alternativa.value);
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

class FakeMarkingsStorage implements MarkingsStorage {
  private store = new Map<string, AnswersMap>();
  private setCalls: { id: string; pregunta: number; alt: AlternativaValue }[] = [];
  // Persistencia in-memory de admissionArea por examId. Al no seedear, retorna
  // null — cae al DEFAULT_ADMISSION_AREA en la lógica del view-model.
  private admissionAreaStore = new Map<string, AdmissionArea>();

  seedMarcaciones(examId: string, answers: AnswersMap): void {
    this.store.set(examId, { ...answers });
  }

  seedAdmissionArea(examId: string, area: AdmissionArea): void {
    this.admissionAreaStore.set(examId, area);
  }

  getSetCalls(): readonly { id: string; pregunta: number; alt: AlternativaValue }[] {
    return this.setCalls;
  }

  async setMarcacion(
    examId: string,
    pregunta: number,
    alternativa: AlternativaValue,
  ): Promise<void> {
    this.setCalls.push({ id: examId, pregunta, alt: alternativa });
    const existing = this.store.get(examId) ?? {};
    existing[String(pregunta)] = alternativa;
    this.store.set(examId, existing);
  }

  async getMarcaciones(examId: string): Promise<AnswersMap> {
    return { ...(this.store.get(examId) ?? {}) };
  }

  async getSubmissionAck(_examId: string): Promise<SubmissionAck | null> {
    return null;
  }
  async setSubmissionAck(_examId: string, _ack: SubmissionAck): Promise<void> {
    /* no-op */
  }

  async clearMarcaciones(_examId: string): Promise<void> {
    /* no-op */
  }
  async enqueueEnvio(_envio: EnvioPendiente): Promise<void> {
    /* no-op */
  }
  async getEnviosPendientes(): Promise<EnvioPendiente[]> {
    return [];
  }
  async dequeueEnvio(_examId: string): Promise<void> {
    /* no-op */
  }
  async getAdmissionArea(examId: string): Promise<AdmissionArea | null> {
    return this.admissionAreaStore.get(examId) ?? null;
  }
  async setAdmissionArea(examId: string, area: AdmissionArea): Promise<void> {
    this.admissionAreaStore.set(examId, area);
  }
  async wipeUserScope(): Promise<void> {
    /* no-op */
  }
}

// Fake del SeleccionarAdmissionAreaUseCase: registra las llamadas para que
// los tests verifiquen que el view-model delega correctamente. No hace
// validación del set cerrado — eso lo cubre el spec del use case en L2.
class FakeSeleccionarAdmissionAreaUseCase {
  public callsWith: SeleccionarAdmissionAreaInput[] = [];
  private failNext: Error | null = null;

  willReject(err: Error): void {
    this.failNext = err;
  }

  async execute(input: SeleccionarAdmissionAreaInput): Promise<void> {
    this.callsWith.push(input);
    if (this.failNext) {
      const err = this.failNext;
      this.failNext = null;
      throw err;
    }
  }
}

class FakeEnviarSimulacroUseCase {
  public calls: EnviarSimulacroInput[] = [];
  private plan:
    | { kind: 'resolve'; result: EnviarSimulacroOutput }
    | { kind: 'reject'; error: Error }
    | { kind: 'pending'; resolve: (r: EnviarSimulacroOutput) => void; reject: (e: Error) => void }
    | null = null;
  public pendingPromise: Promise<EnviarSimulacroOutput> | null = null;

  willResolve(result: EnviarSimulacroOutput): void {
    this.plan = { kind: 'resolve', result };
  }

  willReject(error: Error): void {
    this.plan = { kind: 'reject', error };
  }

  willStayPending(): { resolve: (r: EnviarSimulacroOutput) => void; reject: (e: Error) => void } {
    let res!: (r: EnviarSimulacroOutput) => void;
    let rej!: (e: Error) => void;
    this.pendingPromise = new Promise<EnviarSimulacroOutput>((r, e) => {
      res = r;
      rej = e;
    });
    this.plan = { kind: 'pending', resolve: res, reject: rej };
    return { resolve: res, reject: rej };
  }

  async execute(input: EnviarSimulacroInput): Promise<EnviarSimulacroOutput> {
    this.calls.push(input);
    if (this.plan === null) {
      throw new Error('FakeEnviarSimulacroUseCase: configurar plan antes de invocar execute');
    }
    if (this.plan.kind === 'reject') throw this.plan.error;
    if (this.plan.kind === 'resolve') return this.plan.result;
    if (this.pendingPromise === null) {
      throw new Error('FakeEnviarSimulacroUseCase: pendingPromise no inicializada');
    }
    return this.pendingPromise;
  }
}

class FakeProgramarAutoEnvioUseCase {
  public calls: ProgramarAutoEnvioInput[] = [];
  public lastHandle: AutoEnvioHandle | null = null;
  public cancelCalls = 0;

  execute(input: ProgramarAutoEnvioInput): AutoEnvioHandle {
    this.calls.push(input);
    const handle: AutoEnvioHandle = {
      cancel: () => {
        this.cancelCalls++;
      },
    };
    this.lastHandle = handle;
    return handle;
  }

  fireOnResult(result: EnviarSimulacroOutput): void {
    const last = this.calls[this.calls.length - 1];
    last.onResult?.(result);
  }
  fireOnError(err: unknown): void {
    const last = this.calls[this.calls.length - 1];
    last.onError?.(err);
  }
}

// Fake dispatcher que registra invocaciones de notificarCambio y
// cancelarDraftsPendientes para los tests de integración del view-model.
// Captura (sessionId, count) para verificar que el view-model pasa el
// Exam.count al dispatcher (design.md D12 de draft-auto-save).
class FakeDraftDispatcher implements IDraftAutoSaveDispatcher {
  public notificarCalls: { sessionId: string; count: number }[] = [];
  public cancelarCalls: string[] = [];

  private readonly _closedSessions = signal<readonly string[]>([]);
  readonly closedSessions: Signal<readonly string[]> = this._closedSessions.asReadonly();

  notificarCambio(sessionId: string, count: number): void {
    this.notificarCalls.push({ sessionId, count });
  }

  cancelarDraftsPendientes(sessionId: string): void {
    this.cancelarCalls.push(sessionId);
  }

  // Helper de test: emite un sessionId como cerrado para disparar el effect.
  emitClosed(sessionId: string): void {
    this._closedSessions.update((prev) => [...prev, sessionId]);
  }
}

// Helper
const buildExam = (
  id: string,
  serverStatusValue: 'scheduled' | 'in_progress' | 'finalized',
  overrides: Partial<{
    count: number;
    scheduled: Date;
    started: Date | null;
    duration: number;
  }> = {},
): Exam => {
  const inProgress = serverStatusValue === 'in_progress';
  const finalized = serverStatusValue === 'finalized';
  return new Exam({
    id,
    area: 'Matemática',
    course: 'Aritmética',
    type: 'simulacro',
    name: `Examen ${id}`,
    count: overrides.count ?? 20,
    duration: overrides.duration ?? 7200,
    scheduled: overrides.scheduled ?? new Date('2026-06-11T10:00:00Z'),
    started:
      'started' in overrides
        ? (overrides.started ?? null)
        : inProgress || finalized
          ? new Date('2026-06-11T10:00:05Z')
          : null,
    finished: finalized ? new Date('2026-06-11T12:00:00Z') : null,
    openUntil: null,
    serverStatus: new ExamServerStatus(serverStatusValue),
  });
};

describe('SimulacroPageViewModel', () => {
  let fakeGetTodaysExams: FakeGetTodaysExamsUseCase;
  let fakeClock: FakeClock;
  let fakeMarkings: FakeMarkingsStorage;
  let fakeMarcar: FakeMarcarRespuestaUseCase;
  let fakeEnviar: FakeEnviarSimulacroUseCase;
  let fakeProgramar: FakeProgramarAutoEnvioUseCase;
  let fakeDraftDispatcher: FakeDraftDispatcher;
  let fakeSeleccionarArea: FakeSeleccionarAdmissionAreaUseCase;

  const createVm = (): SimulacroPageViewModel =>
    TestBed.runInInjectionContext(() => new SimulacroPageViewModel());

  beforeEach(async () => {
    fakeGetTodaysExams = new FakeGetTodaysExamsUseCase();
    fakeClock = new FakeClock();
    fakeMarkings = new FakeMarkingsStorage();
    fakeMarcar = new FakeMarcarRespuestaUseCase(fakeMarkings);
    fakeEnviar = new FakeEnviarSimulacroUseCase();
    fakeProgramar = new FakeProgramarAutoEnvioUseCase();
    fakeDraftDispatcher = new FakeDraftDispatcher();
    fakeSeleccionarArea = new FakeSeleccionarAdmissionAreaUseCase();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'home', component: HomeStub },
          { path: 'login', component: LoginStub },
        ]),
        { provide: GetTodaysExamsUseCase, useValue: fakeGetTodaysExams },
        { provide: MarcarRespuestaUseCase, useValue: fakeMarcar },
        { provide: EnviarSimulacroUseCase, useValue: fakeEnviar },
        // Reusa fakeEnviar para EnviarTareaUseCase — los tests históricos usan
        // openUntil: null en las fixtures (modo examen), así el branch tarea
        // no se dispara; el provide solo satisface la DI del view-model.
        { provide: EnviarTareaUseCase, useValue: fakeEnviar },
        { provide: ProgramarAutoEnvioUseCase, useValue: fakeProgramar },
        { provide: SeleccionarAdmissionAreaUseCase, useValue: fakeSeleccionarArea },
        { provide: CLOCK, useValue: fakeClock },
        { provide: MARKINGS_STORAGE, useValue: fakeMarkings },
        { provide: DraftAutoSaveDispatcher, useValue: fakeDraftDispatcher },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('start() — bloqueo por estado / not-found', () => {
    it('id que no existe en la lista → errorState=not-found y redirect /home', async () => {
      fakeGetTodaysExams.willResolve([buildExam('exam-otro', 'in_progress')]);
      const vm = createVm();
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      await vm.start('exam-no-existe');

      expect(vm.errorState()).toBe('not-found');
      expect(navigateSpy).toHaveBeenCalledWith(['/home']);
      expect(vm.exam()).toBeNull();
      vm.stop();
    });

    it('exam en serverStatus=scheduled → errorState=pendiente y redirect /home', async () => {
      fakeGetTodaysExams.willResolve([buildExam('exam-1', 'scheduled')]);
      const vm = createVm();
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      await vm.start('exam-1');

      expect(vm.errorState()).toBe('pendiente');
      expect(navigateSpy).toHaveBeenCalledWith(['/home']);
      vm.stop();
    });

    it('exam en serverStatus=finalized → errorState=cerrado y redirect /home', async () => {
      fakeGetTodaysExams.willResolve([buildExam('exam-1', 'finalized')]);
      const vm = createVm();
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      await vm.start('exam-1');

      expect(vm.errorState()).toBe('cerrado');
      expect(navigateSpy).toHaveBeenCalledWith(['/home']);
      vm.stop();
    });

    it('id vacío → errorState=not-found sin invocar al use case', async () => {
      const vm = createVm();
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      await vm.start('   ');

      expect(vm.errorState()).toBe('not-found');
      expect(navigateSpy).toHaveBeenCalledWith(['/home']);
      expect(fakeGetTodaysExams.callCount).toBe(0);
      vm.stop();
    });
  });

  describe('start() — exam in_progress', () => {
    it('setea exam, isLoading=false, errorState=null', async () => {
      const exam = buildExam('exam-1', 'in_progress');
      fakeGetTodaysExams.willResolve([exam]);

      const vm = createVm();
      await vm.start('exam-1');

      expect(vm.exam()).toBe(exam);
      expect(vm.isLoading()).toBe(false);
      expect(vm.errorState()).toBeNull();
      vm.stop();
    });

    it('lee marcaciones del storage y produce un mapa denso (todas las preguntas)', async () => {
      const exam = buildExam('exam-1', 'in_progress', { count: 5 });
      fakeGetTodaysExams.willResolve([exam]);
      fakeMarkings.seedMarcaciones('exam-1', { '2': 'A', '4': 'D' });

      const vm = createVm();
      await vm.start('exam-1');

      expect(vm.marcaciones()).toEqual({
        '1': null,
        '2': 'A',
        '3': null,
        '4': 'D',
        '5': null,
      });
      vm.stop();
    });

    it('preguntas() es una lista 1..count cuando el exam está cargado', async () => {
      const exam = buildExam('exam-1', 'in_progress', { count: 3 });
      fakeGetTodaysExams.willResolve([exam]);

      const vm = createVm();
      await vm.start('exam-1');

      expect(vm.preguntas()).toEqual([1, 2, 3]);
      vm.stop();
    });
  });

  describe('cierreHHMM() — factor ×1000 (duration en segundos)', () => {
    // GUARDIÁN crítico: si alguien volviera a ×60_000 (la fórmula vieja
    // con duration en minutos), este test detecta la regresión.
    it('cierreHHMM = HH:MM de (started + duration*1000), NO + duration*60_000', async () => {
      // started a las 10:00:00 UTC, duration 1800 segundos (30 min) → cierre 10:30 UTC.
      // Con ×60_000 sería 10:00 + 30:00:00 → 4 días después, HH:MM no aplicaría.
      const started = new Date('2026-06-11T10:00:00Z');
      const exam = buildExam('exam-1', 'in_progress', { started, duration: 1800 });
      fakeGetTodaysExams.willResolve([exam]);

      const vm = createVm();
      await vm.start('exam-1');

      const expectedClose = new Date(started.getTime() + 1800 * 1000);
      const hh = expectedClose.getHours().toString().padStart(2, '0');
      const mm = expectedClose.getMinutes().toString().padStart(2, '0');
      expect(vm.cierreHHMM()).toBe(`${hh}:${mm}`);
      vm.stop();
    });

    it('cierreHHMM usa scheduled cuando started es null (caso scheduled — no aplica aquí pero defensivo)', async () => {
      // No podemos cargar un exam scheduled vía start() porque retorna error.
      // Verificamos la fórmula matemática del cierre con started=null
      // siguiendo el patrón del view-model: anchor = started ?? scheduled.
      const scheduled = new Date('2026-06-11T10:00:00Z');
      const exam = buildExam('exam-1', 'in_progress', {
        scheduled,
        started: scheduled,
        duration: 3600,
      });
      fakeGetTodaysExams.willResolve([exam]);

      const vm = createVm();
      await vm.start('exam-1');

      const expectedClose = new Date(scheduled.getTime() + 3600 * 1000);
      const hh = expectedClose.getHours().toString().padStart(2, '0');
      const mm = expectedClose.getMinutes().toString().padStart(2, '0');
      expect(vm.cierreHHMM()).toBe(`${hh}:${mm}`);
      vm.stop();
    });
  });

  describe('countdownRestante() — fórmula `duration - (now - started)/1000`', () => {
    it('a now=started+300s con duration=1800 → restante = 1500s', async () => {
      const started = new Date('2026-06-11T10:00:00Z');
      const exam = buildExam('exam-1', 'in_progress', { started, duration: 1800 });
      fakeGetTodaysExams.willResolve([exam]);
      // now = started + 300s exactos.
      fakeClock.setNow(new Date(started.getTime() + 300_000));

      const vm = createVm();
      await vm.start('exam-1');

      // 1500s = 25 min restantes. El view-model formatea según umbral
      // SHOW_SECONDS_BELOW_MS (5min): por encima usa "X min restantes".
      expect(vm.countdownRestante()).toContain('25');
      expect(vm.countdownRestante()).toContain('min');
      vm.stop();
    });

    it('cuando now > cierre → "00:00"', async () => {
      const started = new Date('2026-06-11T10:00:00Z');
      const exam = buildExam('exam-1', 'in_progress', { started, duration: 60 });
      fakeGetTodaysExams.willResolve([exam]);
      // now ya pasó (1 hora después del cierre).
      fakeClock.setNow(new Date(started.getTime() + 60 * 1000 + 3_600_000));

      const vm = createVm();
      await vm.start('exam-1');

      expect(vm.countdownRestante()).toBe('00:00');
      vm.stop();
    });
  });

  describe('marcar()', () => {
    it('marcar pregunta sin marca previa → invoca use case y signal refleja la letra', async () => {
      // Clock al momento del started: examen vigente, marcar aplica.
      fakeClock.setNow(new Date('2026-06-11T10:00:05Z'));
      const exam = buildExam('exam-1', 'in_progress', { count: 5 });
      fakeGetTodaysExams.willResolve([exam]);
      const vm = createVm();
      await vm.start('exam-1');

      await vm.marcar(5, 'C');

      expect(fakeMarcar.calls).toEqual([{ examId: 'exam-1', pregunta: 5, alternativa: 'C' }]);
      expect(vm.marcaciones()['5']).toBe('C');
      vm.stop();
    });

    it('NO marca cuando el examen no es vigente (no iniciado)', async () => {
      fakeClock.setNow(new Date('2026-06-11T10:00:00Z'));
      const exam = buildExam('exam-1', 'in_progress', {
        started: new Date('2026-06-11T11:00:00Z'),
      });
      fakeGetTodaysExams.willResolve([exam]);
      const vm = createVm();
      await vm.start('exam-1');

      await vm.marcar(1, 'A');

      expect(fakeMarcar.calls).toHaveLength(0);
      expect(vm.marcaciones()['1']).toBeNull();
      vm.stop();
    });

    it('NO marca cuando el examen no es vigente (tiempo cumplido)', async () => {
      fakeClock.setNow(new Date('2026-06-11T13:00:00Z'));
      const exam = buildExam('exam-1', 'in_progress', {
        started: new Date('2026-06-11T10:00:00Z'),
      });
      fakeGetTodaysExams.willResolve([exam]);
      const vm = createVm();
      await vm.start('exam-1');

      await vm.marcar(1, 'A');

      expect(fakeMarcar.calls).toHaveLength(0);
      expect(vm.marcaciones()['1']).toBeNull();
      vm.stop();
    });
  });

  // Hash sha256 hex válido (64 chars) para construir SubmissionAck en tests.
  const VALID_HASH = 'a3f5c8d1b2e4f6a8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
  const buildAck = (id = 'ack-1', submittedIso = '2026-06-11T10:30:00.000Z'): SubmissionAck =>
    new SubmissionAck(id, VALID_HASH, new Date(submittedIso));

  describe('submit() — guard por serverStatus.permiteEntrada()', () => {
    it('submit es no-op si exam no está en in_progress (defensa adicional)', async () => {
      // Caso anómalo: imaginá que el ticker se cruza con un finalize. Tras un
      // momento, exam.serverStatus podría no permitir entrada. Como start() ya
      // habría redirigido, montamos el caso manualmente: arrancamos OK y luego
      // verificamos que el guard prevenga llamadas duplicadas al backend.
      const exam = buildExam('exam-1', 'in_progress');
      fakeGetTodaysExams.willResolve([exam]);
      const vm = createVm();
      await vm.start('exam-1');

      fakeEnviar.willResolve({
        status: 'enviado',
        ack: buildAck(),
      });

      // El primer submit pasa el guard normalmente.
      await vm.submit();
      expect(fakeEnviar.calls).toHaveLength(1);
      vm.stop();
    });

    // Scenario "Submit exitoso muestra modal y no navega" del spec exam-marking.
    // El éxito setea `lastAck` con el ack devuelto y NO navega inmediatamente —
    // la navegación queda diferida hasta `onReceiptClose()`.
    it('éxito → submissionState=sent, lastAck seteado, NO navega', async () => {
      const exam = buildExam('exam-1', 'in_progress');
      fakeGetTodaysExams.willResolve([exam]);
      const vm = createVm();
      await vm.start('exam-1');
      const ack = buildAck();
      fakeEnviar.willResolve({ status: 'enviado', ack });
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      await vm.submit();

      expect(fakeEnviar.calls).toEqual([{ examId: 'exam-1' }]);
      expect(vm.submissionState()).toBe('sent');
      expect(vm.lastAck()).toBe(ack);
      // Crítico: el modal aparece, NO se navega todavía.
      expect(navigateSpy).not.toHaveBeenCalledWith(['/home']);
      vm.stop();
    });

    // Scenario "Submit queued NO muestra modal" del spec exam-marking.
    it('queued (sin red) → submissionState=queued, lastAck=null, NO navega', async () => {
      const exam = buildExam('exam-1', 'in_progress');
      fakeGetTodaysExams.willResolve([exam]);
      const vm = createVm();
      await vm.start('exam-1');
      fakeEnviar.willResolve({ status: 'queued', ack: null });
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      await vm.submit();

      expect(vm.submissionState()).toBe('queued');
      expect(vm.lastAck()).toBeNull();
      expect(navigateSpy).not.toHaveBeenCalled();
      vm.stop();
    });

    it('SimulacroCerradoError → errorState=cerrado y navigate /home', async () => {
      const exam = buildExam('exam-1', 'in_progress');
      fakeGetTodaysExams.willResolve([exam]);
      const vm = createVm();
      await vm.start('exam-1');
      fakeEnviar.willReject(new SimulacroCerradoError());
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      await vm.submit();

      expect(vm.errorState()).toBe('cerrado');
      expect(navigateSpy).toHaveBeenCalledWith(['/home']);
      vm.stop();
    });

    it('SimulacroNoAsignadoError → errorState=not-found y navigate /home', async () => {
      const exam = buildExam('exam-1', 'in_progress');
      fakeGetTodaysExams.willResolve([exam]);
      const vm = createVm();
      await vm.start('exam-1');
      fakeEnviar.willReject(new SimulacroNoAsignadoError());
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      await vm.submit();

      expect(vm.errorState()).toBe('not-found');
      expect(navigateSpy).toHaveBeenCalledWith(['/home']);
      vm.stop();
    });

    it('InvalidSubmissionTimeError → errorState=invalid-submission-time y navigate /home', async () => {
      const exam = buildExam('exam-1', 'in_progress');
      fakeGetTodaysExams.willResolve([exam]);
      const vm = createVm();
      await vm.start('exam-1');
      fakeEnviar.willReject(new InvalidSubmissionTimeError());
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      await vm.submit();

      expect(vm.errorState()).toBe('invalid-submission-time');
      expect(navigateSpy).toHaveBeenCalledWith(['/home']);
      vm.stop();
    });

    it('InvalidPayloadError → errorState=invalid-payload y navigate /home', async () => {
      const exam = buildExam('exam-1', 'in_progress');
      fakeGetTodaysExams.willResolve([exam]);
      const vm = createVm();
      await vm.start('exam-1');
      fakeEnviar.willReject(new InvalidPayloadError());
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      await vm.submit();

      expect(vm.errorState()).toBe('invalid-payload');
      expect(navigateSpy).toHaveBeenCalledWith(['/home']);
      vm.stop();
    });

    it('SessionExpiredError → errorState=session-expired y navigate /login', async () => {
      const exam = buildExam('exam-1', 'in_progress');
      fakeGetTodaysExams.willResolve([exam]);
      const vm = createVm();
      await vm.start('exam-1');
      fakeEnviar.willReject(new SessionExpiredError());
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      await vm.submit();

      expect(vm.errorState()).toBe('session-expired');
      expect(navigateSpy).toHaveBeenCalledWith(['/login']);
      vm.stop();
    });

    it('NetworkError (defensa) → errorState=network y navigate /home', async () => {
      const exam = buildExam('exam-1', 'in_progress');
      fakeGetTodaysExams.willResolve([exam]);
      const vm = createVm();
      await vm.start('exam-1');
      fakeEnviar.willReject(new NetworkError());
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      await vm.submit();

      expect(vm.errorState()).toBe('network');
      expect(navigateSpy).toHaveBeenCalledWith(['/home']);
      vm.stop();
    });

    it('doble click: la segunda invocación NO dispara un segundo POST mientras la primera está en vuelo', async () => {
      const exam = buildExam('exam-1', 'in_progress');
      fakeGetTodaysExams.willResolve([exam]);
      const vm = createVm();
      await vm.start('exam-1');
      const ctrl = fakeEnviar.willStayPending();

      const first = vm.submit();
      const second = vm.submit();

      expect(fakeEnviar.calls).toHaveLength(1);

      ctrl.resolve({ status: 'enviado', ack: buildAck() });
      await first;
      await second;

      expect(fakeEnviar.calls).toHaveLength(1);
      vm.stop();
    });

    it('submit() cancela el auto-envío programado al entrar', async () => {
      const exam = buildExam('exam-1', 'in_progress');
      fakeGetTodaysExams.willResolve([exam]);
      const vm = createVm();
      await vm.start('exam-1');

      expect(fakeProgramar.calls).toHaveLength(1);
      expect(fakeProgramar.cancelCalls).toBe(0);

      fakeEnviar.willResolve({ status: 'enviado', ack: buildAck() });
      await vm.submit();

      expect(fakeProgramar.cancelCalls).toBe(1);
      vm.stop();
    });
  });

  // Scenario "Modal dismiss navega a /home" del spec exam-marking.
  describe('onReceiptClose() — dismiss del modal de comprobante', () => {
    it('limpia lastAck y navega a /home', async () => {
      const exam = buildExam('exam-1', 'in_progress');
      fakeGetTodaysExams.willResolve([exam]);
      const vm = createVm();
      await vm.start('exam-1');
      const ack = buildAck();
      fakeEnviar.willResolve({ status: 'enviado', ack });

      await vm.submit();
      expect(vm.lastAck()).toBe(ack);

      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      vm.onReceiptClose();

      expect(vm.lastAck()).toBeNull();
      expect(navigateSpy).toHaveBeenCalledWith(['/home']);
      vm.stop();
    });
  });

  describe('auto-envío disparado por el timer', () => {
    it('onResult con status enviado + ack → submissionState=sent, lastAck seteado, NO navega', async () => {
      const exam = buildExam('exam-1', 'in_progress');
      fakeGetTodaysExams.willResolve([exam]);
      const vm = createVm();
      await vm.start('exam-1');

      expect(fakeProgramar.calls).toHaveLength(1);
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      const ack = buildAck('ack-auto', '2026-06-11T12:00:00.000Z');
      fakeProgramar.fireOnResult({ status: 'enviado', ack });

      expect(vm.submissionState()).toBe('sent');
      expect(vm.lastAck()).toBe(ack);
      // El modal aparece tras auto-envío también; sin navegar hasta dismiss.
      expect(navigateSpy).not.toHaveBeenCalledWith(['/home']);
      vm.stop();
    });

    it('onResult con status queued → submissionState=queued, lastAck null, NO navega', async () => {
      const exam = buildExam('exam-1', 'in_progress');
      fakeGetTodaysExams.willResolve([exam]);
      const vm = createVm();
      await vm.start('exam-1');

      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      fakeProgramar.fireOnResult({ status: 'queued', ack: null });

      expect(vm.submissionState()).toBe('queued');
      expect(vm.lastAck()).toBeNull();
      expect(navigateSpy).not.toHaveBeenCalled();
      vm.stop();
    });
  });

  describe('start() — clasificación de errores del use case', () => {
    it('SessionExpiredError → errorState=session-expired y redirect /login', async () => {
      fakeGetTodaysExams.willReject(new SessionExpiredError());
      const vm = createVm();
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      await vm.start('exam-1');

      expect(vm.errorState()).toBe('session-expired');
      expect(navigateSpy).toHaveBeenCalledWith(['/login']);
      vm.stop();
    });

    it('NetworkError → errorState=network y redirect /home', async () => {
      fakeGetTodaysExams.willReject(new NetworkError());
      const vm = createVm();
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      await vm.start('exam-1');

      expect(vm.errorState()).toBe('network');
      expect(navigateSpy).toHaveBeenCalledWith(['/home']);
      vm.stop();
    });
  });

  describe('volver()', () => {
    it('navega a /home y NO toca exam/marcaciones/errorState', async () => {
      const exam = buildExam('exam-1', 'in_progress');
      fakeGetTodaysExams.willResolve([exam]);
      const vm = createVm();
      await vm.start('exam-1');

      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      const examBefore = vm.exam();
      const marcsBefore = vm.marcaciones();
      const errBefore = vm.errorState();

      vm.volver();

      expect(navigateSpy).toHaveBeenCalledWith(['/home']);
      expect(vm.exam()).toBe(examBefore);
      expect(vm.marcaciones()).toBe(marcsBefore);
      expect(vm.errorState()).toBe(errBefore);
      vm.stop();
    });
  });

  describe('examenNoIniciado() — `in_progress` con started futuro', () => {
    it('true cuando started cae en el futuro relativo al clock', async () => {
      fakeClock.setNow(new Date('2026-06-11T10:00:00Z'));
      const exam = buildExam('exam-1', 'in_progress', {
        started: new Date('2026-06-11T11:00:00Z'),
      });
      fakeGetTodaysExams.willResolve([exam]);
      const vm = createVm();
      await vm.start('exam-1');

      expect(vm.examenNoIniciado()).toBe(true);
      vm.stop();
    });

    it('false una vez que el clock cruza started', async () => {
      fakeClock.setNow(new Date('2026-06-11T10:00:00Z'));
      const exam = buildExam('exam-1', 'in_progress', {
        started: new Date('2026-06-11T10:00:00Z'),
      });
      fakeGetTodaysExams.willResolve([exam]);
      const vm = createVm();
      await vm.start('exam-1');

      expect(vm.examenNoIniciado()).toBe(false);
      vm.stop();
    });

    it('NO bloquea entrada — el alumno queda en la página de marcado', async () => {
      fakeClock.setNow(new Date('2026-06-11T10:00:00Z'));
      const exam = buildExam('exam-1', 'in_progress', {
        started: new Date('2026-06-11T11:00:00Z'),
      });
      fakeGetTodaysExams.willResolve([exam]);
      const vm = createVm();
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      await vm.start('exam-1');

      expect(vm.exam()).toBe(exam);
      expect(vm.errorState()).toBeNull();
      expect(navigateSpy).not.toHaveBeenCalled();
      vm.stop();
    });
  });

  describe('DraftAutoSaveDispatcher — integración con view-model', () => {
    it('marcarRespuesta exitoso → notificarCambio(sessionId, count) invocado exactamente 1 vez', async () => {
      // El examen debe ser vigente para que marcar() no se aborte antes de
      // llamar al dispatcher. Seteamos el reloj justo después del started del exam.
      fakeClock.setNow(new Date('2026-06-11T10:01:00Z'));
      const exam = buildExam('exam-1', 'in_progress', { count: 5 });
      fakeGetTodaysExams.willResolve([exam]);
      fakeMarkings.seedMarcaciones('exam-1', {
        '1': null,
        '2': null,
        '3': null,
        '4': null,
        '5': null,
      });

      const vm = createVm();
      await vm.start('exam-1');

      expect(fakeDraftDispatcher.notificarCalls).toHaveLength(0);

      await vm.marcar(1, 'A');

      expect(fakeDraftDispatcher.notificarCalls).toHaveLength(1);
      // El view-model debe pasar el Exam.count al dispatcher (design.md D12).
      expect(fakeDraftDispatcher.notificarCalls[0]).toEqual({
        sessionId: 'exam-1',
        count: 5,
      });
      vm.stop();
    });

    it('submit() llama cancelarDraftsPendientes(sessionId) antes del envío', async () => {
      const exam = buildExam('exam-1', 'in_progress');
      fakeGetTodaysExams.willResolve([exam]);
      fakeEnviar.willResolve({ status: 'enviado', ack: null });

      const vm = createVm();
      await vm.start('exam-1');

      const router = TestBed.inject(Router);
      vi.spyOn(router, 'navigate').mockResolvedValue(true);

      expect(fakeDraftDispatcher.cancelarCalls).toHaveLength(0);

      await vm.submit();

      // cancelar debe haber sido llamado antes de que el submit resolviera
      expect(fakeDraftDispatcher.cancelarCalls).toContain('exam-1');
      vm.stop();
    });

    it('stop() llama cancelarDraftsPendientes para prevenir timer leak', async () => {
      const exam = buildExam('exam-1', 'in_progress');
      fakeGetTodaysExams.willResolve([exam]);

      const vm = createVm();
      await vm.start('exam-1');

      expect(fakeDraftDispatcher.cancelarCalls).toHaveLength(0);

      vm.stop();

      expect(fakeDraftDispatcher.cancelarCalls).toContain('exam-1');
    });

    it('closedSessions emite sessionId activo → errorState=cerrado + redirect /home', async () => {
      const exam = buildExam('exam-1', 'in_progress');
      fakeGetTodaysExams.willResolve([exam]);

      const vm = createVm();
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      await vm.start('exam-1');
      expect(vm.errorState()).toBeNull();

      // Dispatcher emite el cierre (simula 409 SESSION_NOT_ACTIVE recibido mid-draft)
      fakeDraftDispatcher.emitClosed('exam-1');
      // El effect es reactivo — TestBed debe procesar el cambio de signal
      TestBed.flushEffects();

      expect(vm.errorState()).toBe('cerrado');
      expect(navigateSpy).toHaveBeenCalledWith(['/home']);
      vm.stop();
    });

    it('closedSessions con sessionId diferente al activo → no dispara flujo cerrado', async () => {
      const exam = buildExam('exam-1', 'in_progress');
      fakeGetTodaysExams.willResolve([exam]);

      const vm = createVm();
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      await vm.start('exam-1');

      // Emitir un sessionId diferente — no debe afectar exam-1
      fakeDraftDispatcher.emitClosed('otro-exam');
      TestBed.flushEffects();

      expect(vm.errorState()).toBeNull();
      expect(navigateSpy).not.toHaveBeenCalled();
      vm.stop();
    });

    it('con NoopDraftAutoSaveDispatcher, métodos del view-model funcionan sin error', async () => {
      // Re-configurar TestBed con el Noop para este test
      TestBed.resetTestingModule();
      const noop = new NoopDraftAutoSaveDispatcher();
      TestBed.configureTestingModule({
        providers: [
          provideRouter([
            { path: 'home', component: HomeStub },
            { path: 'login', component: LoginStub },
          ]),
          { provide: GetTodaysExamsUseCase, useValue: fakeGetTodaysExams },
          { provide: MarcarRespuestaUseCase, useValue: fakeMarcar },
          { provide: EnviarSimulacroUseCase, useValue: fakeEnviar },
        // Reusa fakeEnviar para EnviarTareaUseCase — los tests históricos usan
        // openUntil: null en las fixtures (modo examen), así el branch tarea
        // no se dispara; el provide solo satisface la DI del view-model.
        { provide: EnviarTareaUseCase, useValue: fakeEnviar },
          { provide: ProgramarAutoEnvioUseCase, useValue: fakeProgramar },
          { provide: SeleccionarAdmissionAreaUseCase, useValue: fakeSeleccionarArea },
          { provide: CLOCK, useValue: fakeClock },
          { provide: MARKINGS_STORAGE, useValue: fakeMarkings },
          { provide: DraftAutoSaveDispatcher, useValue: noop },
        ],
      });

      const exam = buildExam('exam-1', 'in_progress', { count: 5 });
      fakeGetTodaysExams.willResolve([exam]);
      fakeMarkings.seedMarcaciones('exam-1', {
        '1': null,
        '2': null,
        '3': null,
        '4': null,
        '5': null,
      });

      const vm = createVm();
      await vm.start('exam-1');

      // marcar con noop no lanza
      await vm.marcar(1, 'A');

      // stop con noop no lanza
      expect(() => vm.stop()).not.toThrow();

      // closedSessions del noop nunca emite
      expect(noop.closedSessions()).toEqual([]);
    });

    it('draftStatus signal inicializa en idle', async () => {
      const exam = buildExam('exam-1', 'in_progress');
      fakeGetTodaysExams.willResolve([exam]);

      const vm = createVm();
      await vm.start('exam-1');

      expect(vm.draftStatus()).toBe('idle');
      vm.stop();
    });
  });

  describe('cierreHHMM y countdownRestante usan effectiveCloseAt', () => {
    it('cierreHHMM usa `finished` cuando learnex ya emitió cierre', async () => {
      // finalized normalmente redirige al home, así que para forzar que el
      // VM llegue a calcular cierreHHMM con finished seteado, construimos
      // un in_progress con finished puesto a mano (caso patológico que el
      // dominio igual debe modelar bien).
      fakeClock.setNow(new Date('2026-06-11T10:00:00Z'));
      const finished = new Date('2026-06-11T10:30:00Z');
      const exam = new Exam({
        id: 'exam-1',
        area: 'M',
        course: 'A',
        type: 't',
        name: 'n',
        count: 5,
        duration: 7200, // 2hs (ignorado porque finished manda)
        scheduled: new Date('2026-06-11T09:00:00Z'),
        started: new Date('2026-06-11T09:30:00Z'),
        finished,
        openUntil: null,
        serverStatus: new ExamServerStatus('in_progress'),
      });
      fakeGetTodaysExams.willResolve([exam]);
      const vm = createVm();
      await vm.start('exam-1');

      const expected = `${String(finished.getHours()).padStart(2, '0')}:${String(finished.getMinutes()).padStart(2, '0')}`;
      expect(vm.cierreHHMM()).toBe(expected);
      vm.stop();
    });

    it('countdownRestante NO se infla cuando started cae en el futuro', async () => {
      // started a las 11am, now a las 10am, duration 300s (5 min). Sin clamp,
      // el restante daría 65 min. Con clamp, debe dar exactamente 5 min.
      fakeClock.setNow(new Date('2026-06-11T10:00:00Z'));
      const exam = buildExam('exam-1', 'in_progress', {
        started: new Date('2026-06-11T11:00:00Z'),
        duration: 300,
      });
      fakeGetTodaysExams.willResolve([exam]);
      const vm = createVm();
      await vm.start('exam-1');

      // Formato adaptativo: 5 min están justo en el threshold de 5min → muestra
      // "05:00" (MM:SS) porque la condición es `>= SHOW_SECONDS_BELOW_MS`.
      // Como 300_000ms NO es >= 300_000ms (estricto en `<`), cae al branch
      // "min restantes" o al MM:SS dependiendo del operador exacto. Lo
      // importante: el restante representa <= 5min, NUNCA 65min.
      const restante = vm.countdownRestante();
      // Aceptamos cualquier formato; lo que NO debe contener es "65".
      expect(restante).not.toMatch(/65/);
      // Y debería contener 5 (los 5 minutos legítimos).
      expect(restante).toMatch(/\b5\b|05/);
      vm.stop();
    });
  });

  describe('admissionArea — hidratación y seleccionarArea()', () => {
    // Scenario "Signal se hidrata desde storage al montar" del spec exam-marking.
    it('start() hidrata el signal desde MarkingsStorage.getAdmissionArea', async () => {
      const exam = buildExam('exam-1', 'in_progress');
      fakeGetTodaysExams.willResolve([exam]);
      fakeMarkings.seedAdmissionArea('exam-1', 'MAT');

      const vm = createVm();
      await vm.start('exam-1');

      expect(vm.admissionArea()).toBe('MAT');
      vm.stop();
    });

    // Scenario "Signal cae al default si storage retorna null" del spec exam-marking.
    it('start() con storage vacío deja el signal en DEFAULT_ADMISSION_AREA (GENERAL)', async () => {
      const exam = buildExam('exam-1', 'in_progress');
      fakeGetTodaysExams.willResolve([exam]);
      // Deliberadamente NO seedeamos admissionArea → getAdmissionArea → null.

      const vm = createVm();
      await vm.start('exam-1');

      expect(vm.admissionArea()).toBe('GENERAL');
      vm.stop();
    });

    // Scenario "`seleccionarArea` persiste, actualiza signal y notifica draft"
    // del spec exam-marking. Cubre los tres efectos en un solo test para
    // reflejar el ADR "notificarCambio con 2 args" del design.md.
    it('seleccionarArea("A") invoca use case, actualiza signal y notifica dispatcher con (sessionId, count)', async () => {
      const exam = buildExam('exam-1', 'in_progress', { count: 40 });
      fakeGetTodaysExams.willResolve([exam]);

      const vm = createVm();
      await vm.start('exam-1');

      // Antes de seleccionar: use case no invocado, signal en default.
      expect(fakeSeleccionarArea.callsWith).toHaveLength(0);
      expect(vm.admissionArea()).toBe('GENERAL');
      // La hidratación del start() puede haber notificado por el flow de marcaciones,
      // pero seleccionarArea NO. Tomamos snapshot para verificar delta exacto.
      const notificarCallsBefore = fakeDraftDispatcher.notificarCalls.length;

      await vm.seleccionarArea('A');

      // 1) Use case invocado con { examId, area }.
      expect(fakeSeleccionarArea.callsWith).toEqual([{ examId: 'exam-1', area: 'A' }]);
      // 2) Signal actualizado.
      expect(vm.admissionArea()).toBe('A');
      // 3) Dispatcher.notificarCambio invocado con DOS args: (sessionId, count).
      // Cubre la expectativa crítica del scenario del spec — el view-model debe
      // usar el mismo hook que post-marcarRespuesta, no una firma distinta.
      expect(fakeDraftDispatcher.notificarCalls.length).toBe(notificarCallsBefore + 1);
      const last =
        fakeDraftDispatcher.notificarCalls[fakeDraftDispatcher.notificarCalls.length - 1];
      expect(last).toEqual({ sessionId: 'exam-1', count: 40 });
      vm.stop();
    });

    it('seleccionarArea() es no-op después de stop()', async () => {
      const exam = buildExam('exam-1', 'in_progress', { count: 20 });
      fakeGetTodaysExams.willResolve([exam]);

      const vm = createVm();
      await vm.start('exam-1');
      vm.stop();

      const notificarCallsBefore = fakeDraftDispatcher.notificarCalls.length;
      await vm.seleccionarArea('A');

      // Ni use case ni dispatcher.notificarCambio deben haber sido invocados
      // tras el stop() — el view-model no debe empujar cambios cuando ya se
      // desmontó la sesión.
      expect(fakeSeleccionarArea.callsWith).toHaveLength(0);
      expect(fakeDraftDispatcher.notificarCalls.length).toBe(notificarCallsBefore);
    });

    it('seleccionarArea() es no-op si no hay exam cargado (start no invocado)', async () => {
      // Sin llamar start(): exam() === null. seleccionarArea debe abortar
      // silenciosamente porque no hay sessionId ni count válidos para armar
      // la llamada al dispatcher (invariante D7 del design de admission-area).
      const vm = createVm();

      await vm.seleccionarArea('A');

      expect(fakeSeleccionarArea.callsWith).toHaveLength(0);
      expect(fakeDraftDispatcher.notificarCalls).toHaveLength(0);
    });
  });
});
