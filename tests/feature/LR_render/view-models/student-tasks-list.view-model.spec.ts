import { describe, it, expect, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { StudentTasksListViewModel } from '../../../../src/LR_render/view-models/student-tasks-list.view-model';
import { GetTodaysExamsUseCase } from '../../../../src/L2_application/use-cases/get-todays-exams.use-case';
import { LogoutUseCase } from '../../../../src/L2_application/use-cases/logout.use-case';
import { Exam } from '../../../../src/L1_domain/entities/exam';
import { ExamServerStatus } from '../../../../src/L1_domain/value-objects/exam-server-status';
import { CLOCK, MARKINGS_STORAGE } from '../../../../src/app.config';
import { Clock } from '../../../../src/L1_domain/ports/clock';
import { MarkingsStorage } from '../../../../src/L1_domain/ports/markings-storage';
import { SubmissionAck } from '../../../../src/L1_domain/value-objects/submission-ack';

// ─── helpers ──────────────────────────────────────────────────────────────────

function buildTareaExam(overrides: {
  id?: string;
  serverStatus?: 'scheduled' | 'in_progress' | 'finalized';
  started?: Date | null;
  openUntil?: Date;
}): Exam {
  const now = new Date();
  return new Exam({
    id: overrides.id ?? 'exam-1',
    area: null,
    course: 'Matemáticas',
    type: 'homework',
    name: 'Tarea de prueba',
    count: 10,
    duration: 3600,
    serverStatus: new ExamServerStatus(overrides.serverStatus ?? 'in_progress'),
    scheduled: new Date(now.getTime() - 60 * 60 * 1000),
    started:
      overrides.started !== undefined
        ? overrides.started
        : new Date(now.getTime() - 30 * 60 * 1000),
    finished: null,
    openUntil: overrides.openUntil ?? new Date(now.getTime() + 24 * 60 * 60 * 1000),
  });
}

// ─── fakes ────────────────────────────────────────────────────────────────────

class FakeGetTodaysExamsUseCase {
  private _next: { kind: 'resolve'; list: readonly Exam[] } | { kind: 'reject'; error: Error } = {
    kind: 'resolve',
    list: [],
  };
  callCount = 0;

  willResolve(list: readonly Exam[]) {
    this._next = { kind: 'resolve', list };
  }
  willReject(error: Error) {
    this._next = { kind: 'reject', error };
  }
  async execute(): Promise<readonly Exam[]> {
    this.callCount++;
    if (this._next.kind === 'reject') throw this._next.error;
    return this._next.list;
  }
}

class FakeLogoutUseCase {
  callCount = 0;
  async execute(): Promise<void> {
    this.callCount++;
  }
}

class FakeMarkingsStorage implements MarkingsStorage {
  private acks = new Map<string, SubmissionAck>();

  seedAck(examId: string, ack: SubmissionAck) {
    this.acks.set(examId, ack);
  }

  async getSubmissionAck(examId: string) {
    return this.acks.get(examId) ?? null;
  }
  async getAllSubmissionAcks() {
    return new Map(this.acks);
  }
  async setMarcacion() {
    /* no-op */
  }
  async getMarcaciones() {
    return {};
  }
  async clearMarcaciones() {
    /* no-op */
  }
  async enqueueEnvio() {
    /* no-op */
  }
  async getEnviosPendientes() {
    return [];
  }
  async dequeueEnvio() {
    /* no-op */
  }
  async setSubmissionAck(examId: string, ack: SubmissionAck) {
    this.acks.set(examId, ack);
  }
  async saveSubmissionSnapshot() {
    /* no-op */
  }
  async getSubmissionSnapshot() {
    return null;
  }
  async setAdmissionArea() {
    /* no-op */
  }
  async getAdmissionArea() {
    return null;
  }
  async wipeUserScope() {
    /* no-op */
  }
  hasAnyState() {
    return false;
  }
}

class FixedClock implements Clock {
  constructor(private readonly fixed: Date) {}
  now(): Date {
    return new Date(this.fixed);
  }
  setServerTime(): void {
    /* no-op */
  }
}

// ─── setup ────────────────────────────────────────────────────────────────────

function setup(now: Date = new Date()) {
  const fakeGetExams = new FakeGetTodaysExamsUseCase();
  const fakeLogout = new FakeLogoutUseCase();
  const fakeMarkings = new FakeMarkingsStorage();
  const fakeClock = new FixedClock(now);

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: GetTodaysExamsUseCase, useValue: fakeGetExams },
      { provide: LogoutUseCase, useValue: fakeLogout },
      { provide: CLOCK, useValue: fakeClock },
      { provide: MARKINGS_STORAGE, useValue: fakeMarkings },
      {
        provide: Router,
        useValue: { navigate: vi.fn().mockResolvedValue(true) },
      },
    ],
  });

  const vm = TestBed.runInInjectionContext(() => new StudentTasksListViewModel());

  return { vm, fakeGetExams, fakeMarkings, fakeClock };
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('StudentTasksListViewModel — estado programada (REQ-PA-02)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Scenario: in_progress con started en el pasado → estado "abierto"', () => {
    it('composeEstado devuelve "abierto" cuando started <= now', async () => {
      const now = new Date('2026-08-16T10:00:00Z');
      const started = new Date('2026-08-16T09:00:00Z'); // 1h en el pasado
      const { vm, fakeGetExams } = setup(now);

      const exam = buildTareaExam({ started, serverStatus: 'in_progress' });
      fakeGetExams.willResolve([exam]);

      await vm.refresh();

      const cards = vm.cards();
      expect(cards).toHaveLength(1);
      expect(cards[0]?.estado).toBe('abierto');
      expect(cards[0]?.clickable).toBe(true);
    });
  });

  describe('Scenario: in_progress con started en el futuro → estado "programada"', () => {
    it('composeEstado devuelve "programada" cuando started > now', async () => {
      const now = new Date('2026-08-16T10:00:00Z');
      const started = new Date('2026-08-16T12:00:00Z'); // 2h en el futuro
      const { vm, fakeGetExams } = setup(now);

      const exam = buildTareaExam({ started, serverStatus: 'in_progress' });
      fakeGetExams.willResolve([exam]);

      await vm.refresh();

      const cards = vm.cards();
      expect(cards).toHaveLength(1);
      expect(cards[0]?.estado).toBe('programada');
      expect(cards[0]?.clickable).toBe(false);
    });

    it('card programada tiene opensAt = exam.started', async () => {
      const now = new Date('2026-08-16T10:00:00Z');
      const started = new Date('2026-08-16T12:00:00Z');
      const { vm, fakeGetExams } = setup(now);

      const exam = buildTareaExam({ started, serverStatus: 'in_progress' });
      fakeGetExams.willResolve([exam]);

      await vm.refresh();

      const card = vm.cards()[0]!;
      expect(card.opensAt).toEqual(started);
    });
  });

  describe('Scenario: countdown < 24h → línea "Faltan Xh Ym"', () => {
    it('opensInText es "Faltan Xh Ym" cuando started - now < 24h', async () => {
      const now = new Date('2026-08-16T10:00:00Z');
      // started en 2h → diffMs = 7_200_000 < 86_400_000 (24h)
      const started = new Date('2026-08-16T12:00:00Z');
      const { vm, fakeGetExams } = setup(now);

      const exam = buildTareaExam({ started, serverStatus: 'in_progress' });
      fakeGetExams.willResolve([exam]);

      await vm.refresh();

      const card = vm.cards()[0]!;
      expect(card.opensInText).not.toBeNull();
      expect(card.opensInText).toMatch(/^Faltan \d+h \d+min$/);
    });
  });

  describe('Scenario: countdown >= 24h → opensInText es null', () => {
    it('opensInText es null cuando started - now >= 24h', async () => {
      const now = new Date('2026-08-16T10:00:00Z');
      // started en 25h → diffMs > 86_400_000
      const started = new Date('2026-08-17T11:00:00Z');
      const { vm, fakeGetExams } = setup(now);

      const exam = buildTareaExam({ started, serverStatus: 'in_progress' });
      fakeGetExams.willResolve([exam]);

      await vm.refresh();

      const card = vm.cards()[0]!;
      expect(card.opensInText).toBeNull();
      // Pero opensAt sigue presente (la fecha sí se muestra)
      expect(card.opensAt).toEqual(started);
    });
  });

  describe('Scenario: card en estado abierto tiene opensAt null', () => {
    it('opensAt es null para cards en estado abierto', async () => {
      const now = new Date('2026-08-16T10:00:00Z');
      const started = new Date('2026-08-16T09:00:00Z'); // pasado
      const { vm, fakeGetExams } = setup(now);

      const exam = buildTareaExam({ started, serverStatus: 'in_progress' });
      fakeGetExams.willResolve([exam]);

      await vm.refresh();

      const card = vm.cards()[0]!;
      expect(card.estado).toBe('abierto');
      expect(card.opensAt).toBeNull();
      expect(card.opensInText).toBeNull();
    });
  });
});
