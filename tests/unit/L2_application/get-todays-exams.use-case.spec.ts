import { describe, it, expect, beforeEach } from 'vitest';
import { GetTodaysExamsUseCase } from '../../../src/L2_application/use-cases/get-todays-exams.use-case';
import { Exam } from '../../../src/L1_domain/entities/exam';
import { ExamServerStatus } from '../../../src/L1_domain/value-objects/exam-server-status';
import { ServerTime } from '../../../src/L1_domain/value-objects/server-time';
import { NetworkError } from '../../../src/L1_domain/errors/network.error';
import { SessionExpiredError } from '../../../src/L1_domain/errors/session-expired.error';
import { ExamsPermissionRevokedError } from '../../../src/L1_domain/errors/exams-permission-revoked.error';
import { StudentNotLinkedError } from '../../../src/L1_domain/errors/student-not-linked.error';
import { FakeClock, FakeExamsApi } from './fakes';

describe('GetTodaysExamsUseCase', () => {
  let api: FakeExamsApi;
  let clock: FakeClock;
  let useCase: GetTodaysExamsUseCase;

  const buildExam = (id: string, statusValue: 'scheduled' | 'in_progress' | 'finalized') => {
    const started = statusValue === 'scheduled' ? null : new Date('2026-06-11T10:00:05Z');
    const finished = statusValue === 'finalized' ? new Date('2026-06-11T12:00:00Z') : null;
    return new Exam({
      id,
      area: 'Matemática',
      course: 'Aritmética',
      type: 'simulacro',
      name: `Examen ${id}`,
      count: 20,
      duration: 3600,
      scheduled: new Date('2026-06-11T10:00:00Z'),
      started,
      finished,
      openUntil: null,
      serverStatus: new ExamServerStatus(statusValue),
    });
  };

  beforeEach(() => {
    api = new FakeExamsApi();
    clock = new FakeClock();
    useCase = new GetTodaysExamsUseCase(api, clock);
  });

  describe('happy path', () => {
    it('devuelve la lista de exámenes tal cual la entrega el puerto', async () => {
      const exams = [buildExam('exam-1', 'in_progress'), buildExam('exam-2', 'scheduled')];
      const serverTime = new ServerTime('2026-06-11T11:30:00Z');
      api.willResolveGetTodaysExams({ exams, serverTime });

      const result = await useCase.execute();

      expect(result).toHaveLength(2);
      expect(result[0]).toBe(exams[0]);
      expect(result[1]).toBe(exams[1]);
    });

    it('ancla el Clock con el ServerTime exacto reportado por el puerto', async () => {
      const exams = [buildExam('exam-1', 'in_progress')];
      const serverTime = new ServerTime('2026-06-11T11:30:00Z');
      api.willResolveGetTodaysExams({ exams, serverTime });

      await useCase.execute();

      const calls = clock.getSetServerTimeCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0]).toBe(serverTime);
      expect(calls[0].toMillis()).toBe(new Date('2026-06-11T11:30:00Z').getTime());
    });

    it('invoca el puerto exactamente una vez por ejecución', async () => {
      api.willResolveGetTodaysExams({
        exams: [],
        serverTime: new ServerTime('2026-06-11T11:30:00Z'),
      });
      await useCase.execute();
      expect(api.getObtenerCalls()).toBe(1);
    });
  });

  describe('lista vacía', () => {
    it('devuelve array vacío cuando el backend no reporta exámenes', async () => {
      const serverTime = new ServerTime('2026-06-11T08:00:00Z');
      api.willResolveGetTodaysExams({ exams: [], serverTime });

      const result = await useCase.execute();

      expect(result).toEqual([]);
    });

    it('ancla el Clock incluso si la lista está vacía', async () => {
      const serverTime = new ServerTime('2026-06-11T08:00:00Z');
      api.willResolveGetTodaysExams({ exams: [], serverTime });

      await useCase.execute();

      expect(clock.getSetServerTimeCalls()).toHaveLength(1);
      expect(clock.getSetServerTimeCalls()[0]).toBe(serverTime);
    });
  });

  describe('propagación de errores', () => {
    it('propaga NetworkError sin capturarlo', async () => {
      api.willRejectGetTodaysExams(new NetworkError());
      await expect(useCase.execute()).rejects.toBeInstanceOf(NetworkError);
    });

    it('NO ancla el Clock si el puerto rechaza con NetworkError', async () => {
      api.willRejectGetTodaysExams(new NetworkError());
      await useCase.execute().catch(() => undefined);
      expect(clock.getSetServerTimeCalls()).toHaveLength(0);
    });

    it('propaga SessionExpiredError sin capturarlo', async () => {
      api.willRejectGetTodaysExams(new SessionExpiredError());
      await expect(useCase.execute()).rejects.toBeInstanceOf(SessionExpiredError);
    });

    it('NO ancla el Clock si el puerto rechaza con SessionExpiredError', async () => {
      api.willRejectGetTodaysExams(new SessionExpiredError());
      await useCase.execute().catch(() => undefined);
      expect(clock.getSetServerTimeCalls()).toHaveLength(0);
    });

    it('propaga ExamsPermissionRevokedError sin capturarlo (403)', async () => {
      api.willRejectGetTodaysExams(new ExamsPermissionRevokedError());
      await expect(useCase.execute()).rejects.toBeInstanceOf(ExamsPermissionRevokedError);
    });

    it('NO ancla el Clock si el puerto rechaza con ExamsPermissionRevokedError', async () => {
      api.willRejectGetTodaysExams(new ExamsPermissionRevokedError());
      await useCase.execute().catch(() => undefined);
      expect(clock.getSetServerTimeCalls()).toHaveLength(0);
    });

    it('propaga StudentNotLinkedError sin capturarlo (404 STUDENT_NOT_LINKED)', async () => {
      api.willRejectGetTodaysExams(new StudentNotLinkedError());
      await expect(useCase.execute()).rejects.toBeInstanceOf(StudentNotLinkedError);
    });

    it('NO ancla el Clock si el puerto rechaza con StudentNotLinkedError', async () => {
      api.willRejectGetTodaysExams(new StudentNotLinkedError());
      await useCase.execute().catch(() => undefined);
      expect(clock.getSetServerTimeCalls()).toHaveLength(0);
    });
  });
});
