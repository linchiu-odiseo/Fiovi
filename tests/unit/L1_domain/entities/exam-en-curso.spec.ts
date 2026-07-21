import { describe, it, expect } from 'vitest';
import { ExamEnCurso } from '../../../../src/L1_domain/entities/exam-en-curso';

function build(overrides: Partial<{ duration: number; startedAt: Date }> = {}) {
  return new ExamEnCurso({
    id: 'ex-1',
    recordId: 'rec-1',
    classroomId: 'cls-1',
    classroomCode: 'LIT01A',
    classroomName: 'Literatura Inglesa - Aula 1',
    name: 'EXFE - ÁLGEBRA - Semana 5',
    course: 'ÁLGEBRA',
    area: 'Números',
    count: 4,
    duration: overrides.duration ?? 900, // 15 min
    startedAt: overrides.startedAt ?? new Date('2026-07-21T14:00:00Z'),
  });
}

describe('ExamEnCurso', () => {
  describe('expectedEndAt', () => {
    it('suma duration (segundos) a startedAt', () => {
      const e = build({
        startedAt: new Date('2026-07-21T14:00:00Z'),
        duration: 900, // 15 min
      });
      expect(e.expectedEndAt.toISOString()).toBe('2026-07-21T14:15:00.000Z');
    });
  });

  describe('remainingSeconds(nowServer)', () => {
    const started = new Date('2026-07-21T14:00:00Z');
    const e = build({ startedAt: started, duration: 900 }); // ends 14:15

    it('devuelve segundos positivos cuando el examen aún está corriendo', () => {
      const now = new Date('2026-07-21T14:05:00Z');
      expect(e.remainingSeconds(now)).toBe(600); // 10 min restantes
    });

    it('devuelve 0 exactamente al expectedEndAt', () => {
      expect(e.remainingSeconds(new Date('2026-07-21T14:15:00Z'))).toBe(0);
    });

    it('devuelve 0 cuando el tiempo ya se cumplió (no negativo)', () => {
      expect(e.remainingSeconds(new Date('2026-07-21T14:20:00Z'))).toBe(0);
    });

    it('devuelve duration completa cuando nowServer coincide con startedAt', () => {
      expect(e.remainingSeconds(started)).toBe(900);
    });
  });

  describe('estaEnTiempo(nowServer)', () => {
    const e = build({
      startedAt: new Date('2026-07-21T14:00:00Z'),
      duration: 900,
    });

    it('es true cuando nowServer < expectedEndAt', () => {
      expect(e.estaEnTiempo(new Date('2026-07-21T14:10:00Z'))).toBe(true);
    });

    it('es false cuando nowServer == expectedEndAt (tiempo cumplido)', () => {
      expect(e.estaEnTiempo(new Date('2026-07-21T14:15:00Z'))).toBe(false);
    });

    it('es false cuando nowServer > expectedEndAt', () => {
      expect(e.estaEnTiempo(new Date('2026-07-21T14:30:00Z'))).toBe(false);
    });
  });
});
