import { describe, it, expect } from 'vitest';
import { Exam } from '../../../../src/L1_domain/entities/exam';
import { ExamServerStatus } from '../../../../src/L1_domain/value-objects/exam-server-status';
import { InvalidExamError } from '../../../../src/L1_domain/errors/invalid-exam.error';

describe('Exam', () => {
  const validServerStatus = new ExamServerStatus('scheduled');
  const validScheduled = new Date('2026-06-11T10:00:00Z');
  const validStarted = new Date('2026-06-11T10:00:05Z');
  const validFinished = new Date('2026-06-11T12:00:00Z');

  const validParams = {
    id: 'exam-001',
    area: 'Matemática',
    course: 'Aritmética',
    type: 'simulacro',
    name: 'Examen 1 — Aritmética',
    count: 20,
    duration: 3600,
    serverStatus: validServerStatus,
    scheduled: validScheduled,
    started: null,
    finished: null,
  } as const;

  describe('construcción válida', () => {
    it('expone todos los campos cuando los args son válidos', () => {
      const e = new Exam({ ...validParams });
      expect(e.id).toBe('exam-001');
      expect(e.area).toBe('Matemática');
      expect(e.course).toBe('Aritmética');
      expect(e.type).toBe('simulacro');
      expect(e.name).toBe('Examen 1 — Aritmética');
      expect(e.count).toBe(20);
      expect(e.duration).toBe(3600);
      expect(e.scheduled).toEqual(validScheduled);
      expect(e.started).toBeNull();
      expect(e.finished).toBeNull();
      expect(e.serverStatus).toBe(validServerStatus);
    });

    it('trimea id, type y name', () => {
      const e = new Exam({
        ...validParams,
        id: '  exam-001  ',
        type: '  simulacro  ',
        name: '  Examen 1  ',
      });
      expect(e.id).toBe('exam-001');
      expect(e.type).toBe('simulacro');
      expect(e.name).toBe('Examen 1');
    });

    it('acepta area null directamente sin lanzar', () => {
      const e = new Exam({ ...validParams, area: null });
      expect(e.area).toBeNull();
    });

    it('acepta course null directamente sin lanzar', () => {
      const e = new Exam({ ...validParams, course: null });
      expect(e.course).toBeNull();
    });

    it('acepta tanto area como course en null simultáneamente', () => {
      const e = new Exam({ ...validParams, area: null, course: null });
      expect(e.area).toBeNull();
      expect(e.course).toBeNull();
    });

    it('acepta started como Date válida', () => {
      const e = new Exam({
        ...validParams,
        serverStatus: new ExamServerStatus('in_progress'),
        started: validStarted,
      });
      expect(e.started).toEqual(validStarted);
    });

    it('acepta finished como Date válida', () => {
      const e = new Exam({
        ...validParams,
        serverStatus: new ExamServerStatus('finalized'),
        started: validStarted,
        finished: validFinished,
      });
      expect(e.finished).toEqual(validFinished);
    });

    it('admite count = 1 (mínimo entero positivo)', () => {
      const e = new Exam({ ...validParams, count: 1 });
      expect(e.count).toBe(1);
    });

    it('admite duration = 1 (mínimo entero positivo en segundos)', () => {
      const e = new Exam({ ...validParams, duration: 1 });
      expect(e.duration).toBe(1);
    });

    it('admite los 3 valores de serverStatus', () => {
      for (const value of ['scheduled', 'in_progress', 'finalized'] as const) {
        const e = new Exam({ ...validParams, serverStatus: new ExamServerStatus(value) });
        expect(e.serverStatus.value).toBe(value);
      }
    });

    it('trimea area whitespace a null cuando queda vacía', () => {
      const e = new Exam({ ...validParams, area: '   ' });
      expect(e.area).toBeNull();
    });

    it('trimea course whitespace a null cuando queda vacía', () => {
      const e = new Exam({ ...validParams, course: '   ' });
      expect(e.course).toBeNull();
    });
  });

  describe('invariantes — id', () => {
    it('rechaza id vacío con InvalidExamError', () => {
      expect(() => new Exam({ ...validParams, id: '' })).toThrow(InvalidExamError);
    });

    it('rechaza id solo whitespace con InvalidExamError', () => {
      expect(() => new Exam({ ...validParams, id: '   ' })).toThrow(InvalidExamError);
    });

    it('rechaza id null-equivalent con InvalidExamError', () => {
      expect(() => new Exam({ ...validParams, id: null as unknown as string })).toThrow(
        InvalidExamError,
      );
    });
  });

  describe('invariantes — type', () => {
    it('rechaza type vacío con InvalidExamError', () => {
      expect(() => new Exam({ ...validParams, type: '' })).toThrow(InvalidExamError);
    });

    it('rechaza type solo whitespace con InvalidExamError', () => {
      expect(() => new Exam({ ...validParams, type: '   ' })).toThrow(InvalidExamError);
    });
  });

  describe('invariantes — name', () => {
    it('rechaza name vacío con InvalidExamError', () => {
      expect(() => new Exam({ ...validParams, name: '' })).toThrow(InvalidExamError);
    });

    it('rechaza name solo whitespace con InvalidExamError', () => {
      expect(() => new Exam({ ...validParams, name: '   ' })).toThrow(InvalidExamError);
    });
  });

  describe('invariantes — count', () => {
    it('rechaza count = 0 con InvalidExamError', () => {
      expect(() => new Exam({ ...validParams, count: 0 })).toThrow(InvalidExamError);
    });

    it('rechaza count negativo con InvalidExamError', () => {
      expect(() => new Exam({ ...validParams, count: -1 })).toThrow(InvalidExamError);
    });

    it('rechaza count no-entero (1.5) con InvalidExamError', () => {
      expect(() => new Exam({ ...validParams, count: 1.5 })).toThrow(InvalidExamError);
    });

    it('rechaza count NaN con InvalidExamError', () => {
      expect(() => new Exam({ ...validParams, count: Number.NaN })).toThrow(InvalidExamError);
    });

    it('rechaza count no-numérico con InvalidExamError', () => {
      expect(() => new Exam({ ...validParams, count: 'veinte' as unknown as number })).toThrow(
        InvalidExamError,
      );
    });
  });

  describe('invariantes — duration', () => {
    it('rechaza duration = 0 con InvalidExamError', () => {
      expect(() => new Exam({ ...validParams, duration: 0 })).toThrow(InvalidExamError);
    });

    it('rechaza duration negativo con InvalidExamError', () => {
      expect(() => new Exam({ ...validParams, duration: -10 })).toThrow(InvalidExamError);
    });

    it('rechaza duration no-entero con InvalidExamError', () => {
      expect(() => new Exam({ ...validParams, duration: 3.7 })).toThrow(InvalidExamError);
    });

    it('rechaza duration NaN con InvalidExamError', () => {
      expect(() => new Exam({ ...validParams, duration: Number.NaN })).toThrow(InvalidExamError);
    });
  });

  describe('invariantes — scheduled', () => {
    it('rechaza scheduled no-Date (string) con InvalidExamError', () => {
      expect(
        () =>
          new Exam({
            ...validParams,
            scheduled: '2026-06-11T10:00:00Z' as unknown as Date,
          }),
      ).toThrow(InvalidExamError);
    });

    it('rechaza scheduled Date inválida (NaN time) con InvalidExamError', () => {
      expect(() => new Exam({ ...validParams, scheduled: new Date('not-a-date') })).toThrow(
        InvalidExamError,
      );
    });
  });

  describe('invariantes — started', () => {
    it('rechaza started no-Date (string) con InvalidExamError', () => {
      expect(
        () =>
          new Exam({
            ...validParams,
            started: '2026-06-11T10:00:00Z' as unknown as Date,
          }),
      ).toThrow(InvalidExamError);
    });

    it('rechaza started Date inválida (NaN time) con InvalidExamError', () => {
      expect(() => new Exam({ ...validParams, started: new Date('not-a-date') })).toThrow(
        InvalidExamError,
      );
    });

    it('admite started null', () => {
      const e = new Exam({ ...validParams, started: null });
      expect(e.started).toBeNull();
    });
  });

  describe('invariantes — finished', () => {
    it('rechaza finished no-Date (string) con InvalidExamError', () => {
      expect(
        () =>
          new Exam({
            ...validParams,
            finished: '2026-06-11T12:00:00Z' as unknown as Date,
          }),
      ).toThrow(InvalidExamError);
    });

    it('rechaza finished Date inválida (NaN time) con InvalidExamError', () => {
      expect(() => new Exam({ ...validParams, finished: new Date('not-a-date') })).toThrow(
        InvalidExamError,
      );
    });

    it('admite finished null', () => {
      const e = new Exam({ ...validParams, finished: null });
      expect(e.finished).toBeNull();
    });
  });

  describe('invariantes — serverStatus', () => {
    it('rechaza serverStatus no-ExamServerStatus (string crudo) con InvalidExamError', () => {
      expect(
        () =>
          new Exam({
            ...validParams,
            serverStatus: 'in_progress' as unknown as ExamServerStatus,
          }),
      ).toThrow(InvalidExamError);
    });

    it('rechaza serverStatus null con InvalidExamError', () => {
      expect(
        () =>
          new Exam({
            ...validParams,
            serverStatus: null as unknown as ExamServerStatus,
          }),
      ).toThrow(InvalidExamError);
    });
  });

  describe('effectiveCloseAt()', () => {
    it('devuelve `finished` cuando está seteado (manda sobre duration)', () => {
      const finished = new Date('2026-06-11T11:30:00Z');
      const e = new Exam({
        ...validParams,
        serverStatus: new ExamServerStatus('finalized'),
        started: validStarted,
        finished,
        duration: 3600, // started + duration = 11:00:05; finished < esto (cierre manual antes)
      });
      expect(e.effectiveCloseAt()).toEqual(finished);
    });

    it('respeta `finished` aunque sea posterior a started+duration (tiempo extra)', () => {
      const finishedConTiempoExtra = new Date('2026-06-11T13:00:00Z');
      const e = new Exam({
        ...validParams,
        serverStatus: new ExamServerStatus('finalized'),
        started: validStarted,
        finished: finishedConTiempoExtra,
        duration: 300, // started + duration = 10:05:05; finished > esto (tiempo extra)
      });
      expect(e.effectiveCloseAt()).toEqual(finishedConTiempoExtra);
    });

    it('cae a started + duration cuando finished === null', () => {
      const e = new Exam({
        ...validParams,
        serverStatus: new ExamServerStatus('in_progress'),
        started: new Date('2026-06-11T10:00:00Z'),
        finished: null,
        duration: 1800, // 30 min
      });
      expect(e.effectiveCloseAt()).toEqual(new Date('2026-06-11T10:30:00Z'));
    });

    it('retorna null cuando started y finished son null (examen no activado)', () => {
      const e = new Exam({
        ...validParams,
        scheduled: new Date('2026-06-11T09:00:00Z'),
        started: null,
        finished: null,
        duration: 600,
      });
      // NO usamos `scheduled + duration` como fallback: el scheduled puede
      // ser viejo y eso provoca countdowns negativos en la UI. null = "no
      // hay cierre todavía"; los consumidores lo manejan como tal.
      expect(e.effectiveCloseAt()).toBeNull();
    });

    it('factor ×1000 (segundos a ms), NO ×60000', () => {
      const e = new Exam({
        ...validParams,
        started: new Date('2026-06-11T10:00:00Z'),
        finished: null,
        duration: 60, // 60 segundos = 1 min
      });
      // started + 60_000 ms = 10:01:00, NO 11:00:00
      expect(e.effectiveCloseAt()).toEqual(new Date('2026-06-11T10:01:00Z'));
    });
  });

  describe('hasStartedBy(now)', () => {
    it('true cuando now ≥ started', () => {
      const e = new Exam({
        ...validParams,
        serverStatus: new ExamServerStatus('in_progress'),
        started: new Date('2026-06-11T10:00:00Z'),
      });
      expect(e.hasStartedBy(new Date('2026-06-11T10:00:00Z'))).toBe(true);
      expect(e.hasStartedBy(new Date('2026-06-11T10:00:01Z'))).toBe(true);
    });

    it('false cuando now < started (started en el futuro relativo a now)', () => {
      const e = new Exam({
        ...validParams,
        serverStatus: new ExamServerStatus('in_progress'),
        started: new Date('2026-06-11T11:00:00Z'),
      });
      expect(e.hasStartedBy(new Date('2026-06-11T10:00:00Z'))).toBe(false);
    });

    it('false cuando started === null (todavía esperando al tutor)', () => {
      const e = new Exam({
        ...validParams,
        started: null,
      });
      expect(e.hasStartedBy(new Date('2026-06-11T10:00:00Z'))).toBe(false);
    });
  });
});
