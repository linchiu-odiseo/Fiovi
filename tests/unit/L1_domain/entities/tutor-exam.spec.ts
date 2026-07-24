import { describe, it, expect } from 'vitest';
import { TutorExam } from '../../../../src/L1_domain/entities/tutor-exam';
import { ExamServerStatus } from '../../../../src/L1_domain/value-objects/exam-server-status';

// Helper para construir TutorExam de prueba con defaults razonables.
function buildTutorExam(
  status: 'scheduled' | 'in_progress' | 'finalized',
  overrides?: {
    count?: number | null;
    course?: string | null;
    area?: string | null;
    duration?: number;
  },
) {
  return new TutorExam({
    detailId: 'det-1',
    recordId: 'rec-1',
    classroomId: 'cls-1',
    serverStatus: new ExamServerStatus(status),
    name: 'Examen de prueba',
    course: overrides?.course !== undefined ? overrides.course : 'ÁLGEBRA',
    area: overrides?.area !== undefined ? overrides.area : 'Matemáticas',
    count: overrides?.count !== undefined ? overrides.count : 10,
    duration: overrides?.duration !== undefined ? overrides.duration : 3600,
    scheduled: new Date('2026-06-01T10:00:00Z'),
    startedAt: status === 'scheduled' ? null : new Date('2026-06-10T08:00:00Z'),
    finishedAt: status === 'finalized' ? new Date('2026-06-10T09:00:00Z') : null,
    openUntil: null,
  });
}

describe('TutorExam', () => {
  describe('puedeIniciar()', () => {
    it('retorna true cuando status es "scheduled"', () => {
      const exam = buildTutorExam('scheduled');
      expect(exam.puedeIniciar()).toBe(true);
    });

    it('retorna false cuando status es "in_progress"', () => {
      const exam = buildTutorExam('in_progress');
      expect(exam.puedeIniciar()).toBe(false);
    });

    it('retorna false cuando status es "finalized"', () => {
      const exam = buildTutorExam('finalized');
      expect(exam.puedeIniciar()).toBe(false);
    });
  });

  describe('puedeFinalizar()', () => {
    it('retorna true cuando status es "in_progress"', () => {
      const exam = buildTutorExam('in_progress');
      expect(exam.puedeFinalizar()).toBe(true);
    });

    it('retorna false cuando status es "scheduled"', () => {
      const exam = buildTutorExam('scheduled');
      expect(exam.puedeFinalizar()).toBe(false);
    });

    it('retorna false cuando status es "finalized"', () => {
      const exam = buildTutorExam('finalized');
      expect(exam.puedeFinalizar()).toBe(false);
    });
  });

  describe('estaFinalizado()', () => {
    it('retorna true cuando status es "finalized"', () => {
      const exam = buildTutorExam('finalized');
      expect(exam.estaFinalizado()).toBe(true);
    });

    it('retorna false cuando status es "scheduled"', () => {
      const exam = buildTutorExam('scheduled');
      expect(exam.estaFinalizado()).toBe(false);
    });

    it('retorna false cuando status es "in_progress"', () => {
      const exam = buildTutorExam('in_progress');
      expect(exam.estaFinalizado()).toBe(false);
    });
  });

  describe('campos nullable', () => {
    it('acepta count: null (tipo válido — number | null)', () => {
      const exam = buildTutorExam('scheduled', { count: null });
      expect(exam.count).toBeNull();
    });

    it('acepta course: null (snapshot vacío)', () => {
      const exam = buildTutorExam('scheduled', { course: null });
      expect(exam.course).toBeNull();
    });

    it('acepta area: null (snapshot vacío)', () => {
      const exam = buildTutorExam('scheduled', { area: null });
      expect(exam.area).toBeNull();
    });
  });

  describe('durationInMinutes', () => {
    it('convierte segundos a minutos con redondeo estándar', () => {
      const exam = buildTutorExam('scheduled', { duration: 3600 });
      expect(exam.durationInMinutes).toBe(60);
    });

    it('redondea al minuto más cercano', () => {
      // 1800s = 30 min exactos
      const halfHour = buildTutorExam('scheduled', { duration: 1800 });
      expect(halfHour.durationInMinutes).toBe(30);
      // 90s = 1.5 min → redondea a 2
      const short = buildTutorExam('scheduled', { duration: 90 });
      expect(short.durationInMinutes).toBe(2);
    });
  });
});
