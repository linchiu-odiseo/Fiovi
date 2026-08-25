import { describe, expect, it } from 'vitest';
import { shortSessionId, todayLocalKey } from '../../../../src/L3_periphery/telemetry/day-key';

describe('day-key', () => {
  describe('todayLocalKey', () => {
    it('returns YYYY-MM-DD in local timezone', () => {
      // Fecha con offset explícito: 2026-08-25 12:00 UTC-5 (Lima) → 2026-08-25 en local.
      // Nota: el test corre con la TZ del runner (probablemente UTC en CI, UTC-5 local).
      // Para hacerlo portable, verificamos que el string tiene el shape correcto y que
      // corresponde a los getFullYear/getMonth/getDate del Date pasado.
      const d = new Date(2026, 7, 25, 12, 0, 0); // agosto = index 7
      expect(todayLocalKey(d)).toBe('2026-08-25');
    });

    it('pads single-digit month and day', () => {
      const d = new Date(2026, 0, 5, 12, 0, 0); // enero, día 5
      expect(todayLocalKey(d)).toBe('2026-01-05');
    });

    it('rolls over at midnight local time', () => {
      const beforeMidnight = new Date(2026, 7, 25, 23, 59, 59);
      const afterMidnight = new Date(2026, 7, 26, 0, 0, 1);
      expect(todayLocalKey(beforeMidnight)).toBe('2026-08-25');
      expect(todayLocalKey(afterMidnight)).toBe('2026-08-26');
    });
  });

  describe('shortSessionId', () => {
    it('truncates to last 8 chars for typical UUID', () => {
      expect(shortSessionId('550e8400-e29b-41d4-a716-446655440000')).toBe('55440000');
    });

    it('returns as-is when already 8 chars or shorter', () => {
      expect(shortSessionId('abc12345')).toBe('abc12345');
      expect(shortSessionId('short')).toBe('short');
      expect(shortSessionId('')).toBe('');
    });
  });
});
