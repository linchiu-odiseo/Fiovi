import { describe, it, expect } from 'vitest';
import { AulaSemana } from '../../../../src/L1_domain/entities/aula-semana';

function build(
  overrides: Partial<{
    periodId: string;
    name: string;
    order: number;
    startDate: string;
    endDate: string;
    examCount: number;
    byStatus: { scheduled: number; in_progress: number; finalized: number };
  }> = {},
) {
  return new AulaSemana({
    periodId: overrides.periodId ?? 'p-1',
    name: overrides.name ?? 'Semana 5',
    order: overrides.order ?? 5,
    startDate: overrides.startDate ?? '2026-04-13',
    endDate: overrides.endDate ?? '2026-04-17',
    examCount: overrides.examCount ?? 0,
    byStatus: overrides.byStatus ?? { scheduled: 0, in_progress: 0, finalized: 0 },
  });
}

describe('AulaSemana', () => {
  describe('estaVacia()', () => {
    it('es true cuando examCount es 0', () => {
      expect(build({ examCount: 0 }).estaVacia()).toBe(true);
    });

    it('es false cuando examCount es > 0', () => {
      expect(build({ examCount: 3 }).estaVacia()).toBe(false);
    });
  });

  describe('tieneExamenesEnCurso()', () => {
    it('es true cuando byStatus.in_progress > 0', () => {
      const s = build({
        examCount: 5,
        byStatus: { scheduled: 2, in_progress: 3, finalized: 0 },
      });
      expect(s.tieneExamenesEnCurso()).toBe(true);
    });

    it('es false cuando byStatus.in_progress es 0', () => {
      const s = build({
        examCount: 5,
        byStatus: { scheduled: 2, in_progress: 0, finalized: 3 },
      });
      expect(s.tieneExamenesEnCurso()).toBe(false);
    });
  });

  describe('esSemanaActual(nowServer)', () => {
    const s = build({ startDate: '2026-04-13', endDate: '2026-04-17' });

    it('es true cuando "hoy" cae dentro del rango [start, end]', () => {
      expect(s.esSemanaActual(new Date('2026-04-15T12:00:00Z'))).toBe(true);
    });

    it('es true cuando "hoy" coincide con startDate', () => {
      expect(s.esSemanaActual(new Date('2026-04-13T00:00:00Z'))).toBe(true);
    });

    it('es true cuando "hoy" coincide con endDate', () => {
      expect(s.esSemanaActual(new Date('2026-04-17T23:59:59Z'))).toBe(true);
    });

    it('es false cuando "hoy" es anterior a startDate', () => {
      expect(s.esSemanaActual(new Date('2026-04-12T23:59:59Z'))).toBe(false);
    });

    it('es false cuando "hoy" es posterior a endDate', () => {
      expect(s.esSemanaActual(new Date('2026-04-18T00:00:00Z'))).toBe(false);
    });
  });
});
