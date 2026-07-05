import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, ActivatedRoute } from '@angular/router';
import { Component } from '@angular/core';
import { convertToParamMap, ParamMap } from '@angular/router';
import { SimulacroPage } from '../../../../../src/LR_render/pages/simulacro/simulacro.page';
import { SimulacroPageViewModel } from '../../../../../src/LR_render/view-models/simulacro.view-model';
import { GetTodaysExamsUseCase } from '../../../../../src/L2_application/use-cases/get-todays-exams.use-case';
import { MarcarRespuestaUseCase } from '../../../../../src/L2_application/use-cases/marcar-respuesta.use-case';
import { EnviarSimulacroUseCase } from '../../../../../src/L2_application/use-cases/enviar-simulacro.use-case';
import {
  AutoEnvioHandle,
  ProgramarAutoEnvioInput,
  ProgramarAutoEnvioUseCase,
} from '../../../../../src/L2_application/use-cases/programar-auto-envio.use-case';
import { CLOCK, MARKINGS_STORAGE } from '../../../../../src/app.config';
import { NoopDraftAutoSaveDispatcher, DraftAutoSaveDispatcher } from '../../../../../src/L3_periphery/envio/draft-auto-save-dispatcher.service';
import { Exam } from '../../../../../src/L1_domain/entities/exam';
import { ExamServerStatus } from '../../../../../src/L1_domain/value-objects/exam-server-status';
import { ServerTime } from '../../../../../src/L1_domain/value-objects/server-time';
import { SubmissionAck } from '../../../../../src/L1_domain/value-objects/submission-ack';
import { Alternativa } from '../../../../../src/L1_domain/value-objects/alternativa';
import { Clock } from '../../../../../src/L1_domain/ports/clock';
import {
  AlternativaValue,
  AnswersMap,
  EnvioPendiente,
  MarkingsStorage,
} from '../../../../../src/L1_domain/ports/markings-storage';

@Component({ template: '' })
class HomeStub {}

class FakeGetTodaysExamsUseCase {
  private next: { kind: 'resolve'; list: readonly Exam[] } | { kind: 'reject'; error: Error } = {
    kind: 'resolve',
    list: [],
  };

  willResolve(list: readonly Exam[]) {
    this.next = { kind: 'resolve', list };
  }
  willReject(error: Error) {
    this.next = { kind: 'reject', error };
  }

  async execute(): Promise<readonly Exam[]> {
    if (this.next.kind === 'reject') throw this.next.error;
    return this.next.list;
  }
}

class FakeMarcarRespuestaUseCase {
  public calls: { examId: string; pregunta: number; alternativa: AlternativaValue }[] = [];

  constructor(private readonly markings: MarkingsStorage) {}

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

class FakeEnviarSimulacroUseCase {
  async execute(): Promise<{ status: 'enviado'; ack: SubmissionAck }> {
    const VALID_HASH = 'a3f5c8d1b2e4f6a8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
    return {
      status: 'enviado',
      ack: new SubmissionAck('ack-page-1', VALID_HASH, new Date()),
    };
  }
}

class FakeProgramarAutoEnvioUseCase {
  execute(_input: ProgramarAutoEnvioInput): AutoEnvioHandle {
    return { cancel: () => undefined };
  }
}

class FakeMarkingsStorage implements MarkingsStorage {
  private store = new Map<string, AnswersMap>();
  private acks = new Map<string, SubmissionAck>();

  seedMarcaciones(examId: string, answers: AnswersMap): void {
    this.store.set(examId, { ...answers });
  }

  async setMarcacion(
    examId: string,
    pregunta: number,
    alternativa: AlternativaValue,
  ): Promise<void> {
    const existing = this.store.get(examId) ?? {};
    existing[String(pregunta)] = alternativa;
    this.store.set(examId, existing);
  }
  async getMarcaciones(examId: string): Promise<AnswersMap> {
    return { ...(this.store.get(examId) ?? {}) };
  }
  async getSubmissionAck(examId: string): Promise<SubmissionAck | null> {
    return this.acks.get(examId) ?? null;
  }
  async setSubmissionAck(examId: string, ack: SubmissionAck): Promise<void> {
    this.acks.set(examId, ack);
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

const buildActivatedRouteStub = (id: string | null): Partial<ActivatedRoute> => {
  const params: Record<string, string> = id !== null ? { id } : {};
  const paramMap: ParamMap = convertToParamMap(params);
  return {
    snapshot: {
      paramMap,
    } as unknown as ActivatedRoute['snapshot'],
  };
};

const flushPromises = async (iterations = 5): Promise<void> => {
  for (let i = 0; i < iterations; i++) {
    await Promise.resolve();
  }
};

const buildExam = (
  id: string,
  serverStatusValue: 'scheduled' | 'in_progress' | 'finalized',
  overrides: Partial<{ count: number; scheduled: Date; started: Date | null; name: string }> = {},
): Exam => {
  const inProgress = serverStatusValue === 'in_progress';
  const finalized = serverStatusValue === 'finalized';
  return new Exam({
    id,
    area: 'Matemática',
    course: 'Aritmética',
    type: 'simulacro',
    name: overrides.name ?? `Examen ${id}`,
    count: overrides.count ?? 5,
    duration: 7200,
    scheduled: overrides.scheduled ?? new Date('2026-06-11T10:00:00Z'),
    started:
      'started' in overrides
        ? overrides.started ?? null
        : inProgress || finalized
          ? new Date('2026-06-11T10:00:05Z')
          : null,
    finished: finalized ? new Date('2026-06-11T12:00:00Z') : null,
    serverStatus: new ExamServerStatus(serverStatusValue),
  });
};

describe('SimulacroPage', () => {
  let fakeGetTodaysExams: FakeGetTodaysExamsUseCase;
  let fakeClock: FakeClock;
  let fakeMarkings: FakeMarkingsStorage;
  let fakeMarcar: FakeMarcarRespuestaUseCase;

  const configureTestBed = async (idParam: string | null) => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [SimulacroPage],
      providers: [
        provideRouter([{ path: 'home', component: HomeStub }]),
        { provide: ActivatedRoute, useValue: buildActivatedRouteStub(idParam) },
        { provide: GetTodaysExamsUseCase, useValue: fakeGetTodaysExams },
        { provide: MarcarRespuestaUseCase, useValue: fakeMarcar },
        { provide: EnviarSimulacroUseCase, useValue: new FakeEnviarSimulacroUseCase() },
        { provide: ProgramarAutoEnvioUseCase, useValue: new FakeProgramarAutoEnvioUseCase() },
        { provide: CLOCK, useValue: fakeClock },
        { provide: MARKINGS_STORAGE, useValue: fakeMarkings },
        { provide: DraftAutoSaveDispatcher, useValue: new NoopDraftAutoSaveDispatcher() },
      ],
    }).compileComponents();
  };

  beforeEach(() => {
    fakeGetTodaysExams = new FakeGetTodaysExamsUseCase();
    fakeClock = new FakeClock();
    fakeMarkings = new FakeMarkingsStorage();
    fakeMarcar = new FakeMarcarRespuestaUseCase(fakeMarkings);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('render — exam in_progress', () => {
    it('muestra el name del exam, el countdown y count filas con 5 bubbles cada una', async () => {
      // Examen ya vigente: started en el pasado relativo al clock fake.
      // Necesario para que el countdown esté visible (se oculta cuando
      // examenNoIniciado === true).
      fakeClock.setNow(new Date('2026-06-11T10:05:00Z'));
      const exam = buildExam('exam-1', 'in_progress', {
        count: 4,
        name: 'Examen Demo',
      });
      fakeGetTodaysExams.willResolve([exam]);
      await configureTestBed('exam-1');

      const fixture = TestBed.createComponent(SimulacroPage);
      fixture.detectChanges();
      await flushPromises();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;

      expect(el.querySelector('.header__name')?.textContent).toContain('Examen Demo');
      expect(el.querySelector('[role="timer"]')).not.toBeNull();
      expect(el.querySelector('.header__restante')).not.toBeNull();

      const filas = el.querySelectorAll('.fila');
      expect(filas.length).toBe(4);
      filas.forEach((fila) => {
        expect(fila.querySelectorAll('.bubble').length).toBe(5);
      });
    });

    it('refleja marcaciones pre-existentes en las bubbles', async () => {
      const exam = buildExam('exam-1', 'in_progress', { count: 5 });
      fakeGetTodaysExams.willResolve([exam]);
      fakeMarkings.seedMarcaciones('exam-1', { '2': 'C' });
      await configureTestBed('exam-1');

      const fixture = TestBed.createComponent(SimulacroPage);
      fixture.detectChanges();
      await flushPromises();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const filas = el.querySelectorAll('.fila');
      const bubblesFila2 = filas[1].querySelectorAll('.bubble');
      expect(bubblesFila2[2].classList.contains('bubble--marked')).toBe(true);
      expect(bubblesFila2[2].getAttribute('aria-checked')).toBe('true');
      expect(bubblesFila2[0].classList.contains('bubble--marked')).toBe(false);
    });
  });

  describe('marcar una bubble', () => {
    it('click en una bubble dispara MarcarRespuestaUseCase con (examId, pregunta, letra)', async () => {
      // Clock al started del helper: examen vigente para que la grilla
      // reciba clicks (la guard de vigencia bloquearía si no).
      fakeClock.setNow(new Date('2026-06-11T10:00:05Z'));
      const exam = buildExam('exam-1', 'in_progress', { count: 3 });
      fakeGetTodaysExams.willResolve([exam]);
      await configureTestBed('exam-1');

      const fixture = TestBed.createComponent(SimulacroPage);
      fixture.detectChanges();
      await flushPromises();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const filas = el.querySelectorAll('.fila');
      const bubble = filas[1].querySelectorAll('.bubble')[1] as HTMLButtonElement;
      bubble.click();
      await flushPromises();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fakeMarcar.calls).toHaveLength(1);
      expect(fakeMarcar.calls[0]).toEqual({
        examId: 'exam-1',
        pregunta: 2,
        alternativa: 'B',
      });

      expect(bubble.classList.contains('bubble--marked')).toBe(true);
    });
  });

  describe('botón Volver', () => {
    it('navega a /home cuando se hace click', async () => {
      const exam = buildExam('exam-1', 'in_progress');
      fakeGetTodaysExams.willResolve([exam]);
      await configureTestBed('exam-1');

      const fixture = TestBed.createComponent(SimulacroPage);
      fixture.detectChanges();
      await flushPromises();
      await fixture.whenStable();
      fixture.detectChanges();

      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      const volverBtn = fixture.nativeElement.querySelector('.btn--secondary') as HTMLButtonElement;
      volverBtn.click();

      expect(navigateSpy).toHaveBeenCalledWith(['/home']);
    });
  });

  describe('id ausente en route', () => {
    it('redirige a /home directamente sin invocar al use case', async () => {
      await configureTestBed(null);

      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      TestBed.createComponent(SimulacroPage);

      expect(navigateSpy).toHaveBeenCalledWith(['/home']);
      expect(fakeMarcar.calls).toHaveLength(0);
    });

    it('id whitespace en route también redirige a /home directamente', async () => {
      await configureTestBed('   ');

      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      TestBed.createComponent(SimulacroPage);

      expect(navigateSpy).toHaveBeenCalledWith(['/home']);
    });
  });

  // -----------------------------------------------------------------------
  // Protección contra cambios accidentales — gestos en la página
  // -----------------------------------------------------------------------
  describe('long-press y protección de filas (gestos)', () => {
    const firePointerEvent = (
      el: Element,
      type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
      x: number,
      y: number,
    ): void => {
      const PointerEventCtor = (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent;
      let ev: Event;
      if (typeof PointerEventCtor === 'function') {
        try {
          ev = new PointerEventCtor(type, {
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          });
        } catch {
          ev = new MouseEvent(type, {
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          });
        }
      } else {
        ev = new MouseEvent(type, {
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true,
        });
      }
      el.dispatchEvent(ev);
    };

    let vibrateMock: ReturnType<typeof vi.fn>;
    let originalVibrate: unknown;

    beforeEach(() => {
      vibrateMock = vi.fn();
      const desc = Object.getOwnPropertyDescriptor(navigator, 'vibrate');
      originalVibrate = desc;
      Object.defineProperty(navigator, 'vibrate', {
        value: vibrateMock,
        configurable: true,
        writable: true,
      });
    });

    afterEach(() => {
      if (typeof originalVibrate === 'object' && originalVibrate !== null) {
        Object.defineProperty(navigator, 'vibrate', originalVibrate as PropertyDescriptor);
      } else {
        delete (navigator as unknown as { vibrate?: unknown }).vibrate;
      }
    });

    it('long-press 500ms en fila locked → entra a editing y muestra chip', async () => {
      const exam = buildExam('exam-1', 'in_progress', { count: 3 });
      fakeGetTodaysExams.willResolve([exam]);
      fakeMarkings.seedMarcaciones('exam-1', { '2': 'C' });
      await configureTestBed('exam-1');

      const fixture = TestBed.createComponent(SimulacroPage);
      fixture.detectChanges();
      await flushPromises();
      await fixture.whenStable();
      fixture.detectChanges();

      vi.useFakeTimers();
      try {
        const el = fixture.nativeElement as HTMLElement;
        const fila2 = el.querySelectorAll('.fila')[1] as HTMLElement;

        firePointerEvent(fila2, 'pointerdown', 100, 200);
        vi.advanceTimersByTime(500);
        firePointerEvent(fila2, 'pointerup', 100, 200);

        fixture.detectChanges();

        expect(fila2.classList.contains('fila--editing')).toBe(true);
        expect(fila2.classList.contains('fila--locked')).toBe(false);
        expect(fila2.querySelector('.row__chip')).not.toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('click en bubble de fila locked → NO aplica la marca', async () => {
      const exam = buildExam('exam-1', 'in_progress', { count: 3 });
      fakeGetTodaysExams.willResolve([exam]);
      fakeMarkings.seedMarcaciones('exam-1', { '2': 'A' });
      await configureTestBed('exam-1');

      const fixture = TestBed.createComponent(SimulacroPage);
      fixture.detectChanges();
      await flushPromises();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const filas = el.querySelectorAll('.fila');
      const fila2 = filas[1] as HTMLElement;
      const bubbleB = fila2.querySelectorAll('.bubble')[1] as HTMLButtonElement;
      bubbleB.click();
      await flushPromises();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fakeMarcar.calls).toHaveLength(0);
      const bubbleA = fila2.querySelectorAll('.bubble')[0] as HTMLButtonElement;
      expect(bubbleA.classList.contains('bubble--marked')).toBe(true);
      expect(bubbleB.classList.contains('bubble--marked')).toBe(false);
      expect(el.querySelector('.row__chip')).toBeNull();
    });

    it('click en bubble de fila editing → aplica la marca y la fila vuelve a locked', async () => {
      // Clock al started del helper: examen vigente para que el long-press
      // y el cambio de marca apliquen.
      fakeClock.setNow(new Date('2026-06-11T10:00:05Z'));
      const exam = buildExam('exam-1', 'in_progress', { count: 3 });
      fakeGetTodaysExams.willResolve([exam]);
      fakeMarkings.seedMarcaciones('exam-1', { '2': 'A' });
      await configureTestBed('exam-1');

      const fixture = TestBed.createComponent(SimulacroPage);
      fixture.detectChanges();
      await flushPromises();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const fila2 = el.querySelectorAll('.fila')[1] as HTMLElement;

      const pageVm = fixture.debugElement.injector.get(SimulacroPageViewModel);
      pageVm.enterEditing(2);
      fixture.detectChanges();

      expect(fila2.classList.contains('fila--editing')).toBe(true);

      const bubbleC = fila2.querySelectorAll('.bubble')[2] as HTMLButtonElement;
      bubbleC.click();
      await flushPromises();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fakeMarcar.calls).toHaveLength(1);
      expect(fakeMarcar.calls[0]).toEqual({
        examId: 'exam-1',
        pregunta: 2,
        alternativa: 'C',
      });
      expect(fila2.classList.contains('fila--editing')).toBe(false);
      expect(fila2.classList.contains('fila--locked')).toBe(true);
      expect(bubbleC.classList.contains('bubble--marked')).toBe(true);
    });

    it('al entrar a edición vía long-press, navigator.vibrate se llama con [40]', async () => {
      const exam = buildExam('exam-1', 'in_progress', { count: 3 });
      fakeGetTodaysExams.willResolve([exam]);
      fakeMarkings.seedMarcaciones('exam-1', { '2': 'C' });
      await configureTestBed('exam-1');

      const fixture = TestBed.createComponent(SimulacroPage);
      fixture.detectChanges();
      await flushPromises();
      await fixture.whenStable();
      fixture.detectChanges();

      vi.useFakeTimers();
      try {
        const el = fixture.nativeElement as HTMLElement;
        const fila2 = el.querySelectorAll('.fila')[1] as HTMLElement;

        firePointerEvent(fila2, 'pointerdown', 5, 5);
        vi.advanceTimersByTime(500);
        firePointerEvent(fila2, 'pointerup', 5, 5);

        expect(vibrateMock).toHaveBeenCalledWith([40]);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('banner "tomando un café" y botón Enviar', () => {
    it('aparece el banner con la copy completa cuando started cae en el futuro', async () => {
      fakeClock.setNow(new Date('2026-06-11T10:00:00Z'));
      const exam = buildExam('exam-1', 'in_progress', {
        started: new Date('2026-06-11T11:30:00Z'),
      });
      fakeGetTodaysExams.willResolve([exam]);
      await configureTestBed('exam-1');

      const fixture = TestBed.createComponent(SimulacroPage);
      fixture.detectChanges();
      await flushPromises();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const banner = el.querySelector('.simulacro-banner');
      expect(banner).not.toBeNull();
      const msg = banner!.querySelector('.simulacro-banner__msg')?.textContent ?? '';
      expect(msg).toContain('El examen está tomando un café');
      expect(msg).toContain('¡espera la señal para empezar!');
      // El countdown debe estar OCULTO mientras el banner está visible:
      // no tiene sentido mostrar "Cierra a las ..." cuando el examen aún
      // no arrancó y el cierre no es determinable.
      expect(el.querySelector('[role="timer"]')).toBeNull();
    });

    it('aparece el banner cuando started y finished son null (examen no activado)', async () => {
      fakeClock.setNow(new Date('2026-06-11T10:00:00Z'));
      const exam = buildExam('exam-1', 'in_progress', {
        started: null,
      });
      fakeGetTodaysExams.willResolve([exam]);
      await configureTestBed('exam-1');

      const fixture = TestBed.createComponent(SimulacroPage);
      fixture.detectChanges();
      await flushPromises();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.simulacro-banner')).not.toBeNull();
      // Sin started ni finished, no hay cierre determinable: el countdown
      // queda oculto en lugar de mostrar "cerrando…" o un timestamp viejo.
      expect(el.querySelector('[role="timer"]')).toBeNull();
      // El alumno NO es expulsado al home: la grilla queda visible.
      expect(el.querySelectorAll('.fila').length).toBeGreaterThan(0);
    });

    it('NO aparece el banner cuando started ya pasó', async () => {
      fakeClock.setNow(new Date('2026-06-11T11:00:00Z'));
      const exam = buildExam('exam-1', 'in_progress', {
        started: new Date('2026-06-11T10:00:00Z'),
      });
      fakeGetTodaysExams.willResolve([exam]);
      await configureTestBed('exam-1');

      const fixture = TestBed.createComponent(SimulacroPage);
      fixture.detectChanges();
      await flushPromises();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.simulacro-banner')).toBeNull();
    });

    it('la grilla queda accesible aunque el banner esté visible', async () => {
      fakeClock.setNow(new Date('2026-06-11T10:00:00Z'));
      const exam = buildExam('exam-1', 'in_progress', {
        started: new Date('2026-06-11T11:00:00Z'),
        count: 3,
      });
      fakeGetTodaysExams.willResolve([exam]);
      await configureTestBed('exam-1');

      const fixture = TestBed.createComponent(SimulacroPage);
      fixture.detectChanges();
      await flushPromises();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.simulacro-banner')).not.toBeNull();
      expect(el.querySelectorAll('.fila').length).toBe(3);
    });

    it('el botón Enviar queda DISABLED mientras el examen no esté vigente', async () => {
      fakeClock.setNow(new Date('2026-06-11T10:00:00Z'));
      const exam = buildExam('exam-1', 'in_progress', {
        started: new Date('2026-06-11T11:00:00Z'),
      });
      fakeGetTodaysExams.willResolve([exam]);
      await configureTestBed('exam-1');

      const fixture = TestBed.createComponent(SimulacroPage);
      fixture.detectChanges();
      await flushPromises();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const enviarBtn = el.querySelector('.btn--primary') as HTMLButtonElement;
      expect(enviarBtn).not.toBeNull();
      expect(enviarBtn.disabled).toBe(true);
      expect(enviarBtn.getAttribute('aria-disabled')).toBe('true');
    });

    it('el botón Enviar está ENABLED cuando el examen sí está vigente', async () => {
      fakeClock.setNow(new Date('2026-06-11T11:00:00Z'));
      const exam = buildExam('exam-1', 'in_progress', {
        started: new Date('2026-06-11T10:00:00Z'),
      });
      fakeGetTodaysExams.willResolve([exam]);
      await configureTestBed('exam-1');

      const fixture = TestBed.createComponent(SimulacroPage);
      fixture.detectChanges();
      await flushPromises();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const enviarBtn = el.querySelector('.btn--primary') as HTMLButtonElement;
      expect(enviarBtn.disabled).toBe(false);
    });
  });

  describe('banner "tiempo agotado" cuando now ya cruzó effectiveCloseAt', () => {
    it('aparece el banner con la copy "Tus marcas quedaron guardadas"', async () => {
      // started = 10:00, duration = 7200s (2h), closeAt = 12:00.
      // clock = 13:00 → tiempo cumplido localmente.
      fakeClock.setNow(new Date('2026-06-11T13:00:00Z'));
      const exam = buildExam('exam-1', 'in_progress', {
        started: new Date('2026-06-11T10:00:00Z'),
      });
      fakeGetTodaysExams.willResolve([exam]);
      await configureTestBed('exam-1');

      const fixture = TestBed.createComponent(SimulacroPage);
      fixture.detectChanges();
      await flushPromises();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const banners = el.querySelectorAll('.simulacro-banner');
      expect(banners.length).toBeGreaterThan(0);
      const msg = Array.from(banners)
        .map((b) => b.querySelector('.simulacro-banner__msg')?.textContent ?? '')
        .join(' ');
      expect(msg).toContain('Tiempo agotado');
      expect(msg).toContain('Tus marcas quedaron guardadas');
      // Countdown oculto: el cierre real lo decide el server, no tiene
      // sentido mostrar "Cierra a las HH:MM" cuando local time ya pasó.
      expect(el.querySelector('[role="timer"]')).toBeNull();
    });

    it('NO redirige al home — el alumno se queda en la cartilla offline-friendly', async () => {
      fakeClock.setNow(new Date('2026-06-11T13:00:00Z'));
      const exam = buildExam('exam-1', 'in_progress', {
        started: new Date('2026-06-11T10:00:00Z'),
      });
      fakeGetTodaysExams.willResolve([exam]);
      await configureTestBed('exam-1');

      const fixture = TestBed.createComponent(SimulacroPage);
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      fixture.detectChanges();
      await flushPromises();
      await fixture.whenStable();
      fixture.detectChanges();

      // Adelantamos varios segundos del ticker para confirmar que no se
      // dispara redirect durante la vida de la página.
      await flushPromises();
      fixture.detectChanges();

      expect(navigateSpy).not.toHaveBeenCalled();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelectorAll('.fila').length).toBeGreaterThan(0);
    });

    it('el botón Enviar queda DISABLED cuando tiempo cumplido', async () => {
      fakeClock.setNow(new Date('2026-06-11T13:00:00Z'));
      const exam = buildExam('exam-1', 'in_progress', {
        started: new Date('2026-06-11T10:00:00Z'),
      });
      fakeGetTodaysExams.willResolve([exam]);
      await configureTestBed('exam-1');

      const fixture = TestBed.createComponent(SimulacroPage);
      fixture.detectChanges();
      await flushPromises();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const enviarBtn = el.querySelector('.btn--primary') as HTMLButtonElement;
      expect(enviarBtn.disabled).toBe(true);
    });

    it('la grilla recibe clase --disabled cuando el examen no es vigente', async () => {
      fakeClock.setNow(new Date('2026-06-11T10:00:00Z'));
      const exam = buildExam('exam-1', 'in_progress', {
        started: new Date('2026-06-11T11:00:00Z'),
      });
      fakeGetTodaysExams.willResolve([exam]);
      await configureTestBed('exam-1');

      const fixture = TestBed.createComponent(SimulacroPage);
      fixture.detectChanges();
      await flushPromises();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const grilla = el.querySelector('.grilla') as HTMLElement;
      expect(grilla.classList.contains('grilla--disabled')).toBe(true);
      expect(grilla.getAttribute('aria-disabled')).toBe('true');
    });

    it('la grilla NO recibe clase --disabled cuando el examen sí es vigente', async () => {
      fakeClock.setNow(new Date('2026-06-11T11:00:00Z'));
      const exam = buildExam('exam-1', 'in_progress', {
        started: new Date('2026-06-11T10:00:00Z'),
      });
      fakeGetTodaysExams.willResolve([exam]);
      await configureTestBed('exam-1');

      const fixture = TestBed.createComponent(SimulacroPage);
      fixture.detectChanges();
      await flushPromises();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const grilla = el.querySelector('.grilla') as HTMLElement;
      expect(grilla.classList.contains('grilla--disabled')).toBe(false);
      expect(grilla.getAttribute('aria-disabled')).toBeNull();
    });
  });
});
