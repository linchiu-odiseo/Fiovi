import { describe, it, expect } from 'vitest';
import { formatRestante, formatRestanteTarea } from '../../../../src/LR_render/utils/countdown-format';

// formatRestante — reloj digital MM:SS o HH:MM:SS
describe('formatRestante', () => {
  it('devuelve 00:00 en ms <= 0', () => {
    expect(formatRestante(0)).toBe('00:00');
    expect(formatRestante(-1000)).toBe('00:00');
  });

  it('MM:SS cuando no hay horas', () => {
    expect(formatRestante(45 * 1000)).toBe('00:45');
    expect(formatRestante(90 * 1000)).toBe('01:30');
    expect(formatRestante(59 * 60 * 1000 + 59 * 1000)).toBe('59:59');
  });

  it('HH:MM:SS cuando hay al menos 1 hora', () => {
    expect(formatRestante(60 * 60 * 1000)).toBe('01:00:00');
    expect(formatRestante(90 * 60 * 1000)).toBe('01:30:00');
    expect(formatRestante(3 * 60 * 60 * 1000 - 1)).toBe('03:00:00');
  });

  it('redondea hacia arriba (ceiling) — no engaña al usuario', () => {
    // 500ms → 1 seg mostrado, no 0
    expect(formatRestante(500)).toBe('00:01');
  });
});

// formatRestanteTarea — escalado humano para deadlines de días/horas
describe('formatRestanteTarea', () => {
  const HOUR_MS = 60 * 60 * 1000;
  const DAY_MS = 24 * HOUR_MS;

  it('devuelve 00:00 en ms <= 0', () => {
    expect(formatRestanteTarea(0)).toBe('00:00');
    expect(formatRestanteTarea(-1)).toBe('00:00');
  });

  it('< 5 min → cae a MM:SS (mismo formato que examen)', () => {
    expect(formatRestanteTarea(3 * 60 * 1000)).toBe('03:00');
    expect(formatRestanteTarea(45 * 1000)).toBe('00:45');
  });

  it('exactamente 5 min → cambia al formato humano', () => {
    expect(formatRestanteTarea(5 * 60 * 1000)).toBe('5 min');
  });

  it('5 min – 1 h → "N min"', () => {
    expect(formatRestanteTarea(32 * 60 * 1000)).toBe('32 min');
    expect(formatRestanteTarea(59 * 60 * 1000)).toBe('59 min');
  });

  it('1 h – 24 h con minutos → "H h M min"', () => {
    expect(formatRestanteTarea(5 * HOUR_MS + 32 * 60 * 1000)).toBe('5 h 32 min');
    expect(formatRestanteTarea(2 * HOUR_MS + 5 * 60 * 1000)).toBe('2 h 5 min');
  });

  it('1 h – 24 h en hora exacta → "H h" (sin " 0 min")', () => {
    expect(formatRestanteTarea(12 * HOUR_MS)).toBe('12 h');
    expect(formatRestanteTarea(1 * HOUR_MS)).toBe('1 h');
  });

  it('> 24 h con horas → "N día(s) H h"', () => {
    expect(formatRestanteTarea(1 * DAY_MS + 5 * HOUR_MS)).toBe('1 día 5 h');
    expect(formatRestanteTarea(3 * DAY_MS + 12 * HOUR_MS)).toBe('3 días 12 h');
  });

  it('> 24 h en día(s) exacto(s) → "N día(s)" (sin " 0 h")', () => {
    expect(formatRestanteTarea(2 * DAY_MS)).toBe('2 días');
    expect(formatRestanteTarea(1 * DAY_MS)).toBe('1 día');
  });

  it('1 día vs N días: singular/plural correcto', () => {
    expect(formatRestanteTarea(1 * DAY_MS + 1 * HOUR_MS)).toBe('1 día 1 h');
    expect(formatRestanteTarea(2 * DAY_MS + 1 * HOUR_MS)).toBe('2 días 1 h');
  });
});
