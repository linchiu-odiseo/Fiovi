// Tests unitarios de los diccionarios del audit-log — verifican integridad:
// - Cada helper exportado por api-paths.ts tiene entrada en ENDPOINT_IDS.
// - Los IDs son únicos entre sí.
// - lookupErrorCode maneja códigos desconocidos sin lanzar.
// - lookupMethod es case-insensitive.

import { describe, expect, it } from 'vitest';
import { apiPath } from '../../../../src/L3_periphery/http/api-paths';
import {
  ENDPOINT_IDS,
  ERROR_CODE_IDS,
  METHOD_IDS,
  lookupErrorCode,
  lookupMethod,
} from '../../../../src/L3_periphery/telemetry/audit-log-dictionaries';

describe('audit-log-dictionaries', () => {
  describe('ENDPOINT_IDS', () => {
    it('has a numeric ID entry for every helper exported by apiPath', () => {
      const helperNames = Object.keys(apiPath);
      for (const name of helperNames) {
        const id = (ENDPOINT_IDS as Record<string, number | undefined>)[name];
        expect(id, `apiPath.${name} debe tener entrada en ENDPOINT_IDS`).toBeDefined();
        expect(
          id,
          `ENDPOINT_IDS.${name} debe ser > 0 (0 está reservado para unknown)`,
        ).toBeGreaterThan(0);
      }
    });

    it('does not have duplicate IDs', () => {
      const values = Object.values(ENDPOINT_IDS);
      const unique = new Set(values);
      expect(unique.size).toBe(values.length);
    });

    it('does not use ID 0 (reserved for unknown)', () => {
      const values = Object.values(ENDPOINT_IDS);
      expect(values).not.toContain(0);
    });
  });

  describe('ERROR_CODE_IDS + lookupErrorCode', () => {
    it('returns numeric ID for known codes', () => {
      expect(lookupErrorCode('SESSION_NOT_ACTIVE')).toBe(ERROR_CODE_IDS.SESSION_NOT_ACTIVE);
      expect(lookupErrorCode('TENANT_AUTH_INVALID_CREDENTIALS')).toBe(
        ERROR_CODE_IDS.TENANT_AUTH_INVALID_CREDENTIALS,
      );
    });

    it('returns 0 for unknown code without throwing', () => {
      expect(lookupErrorCode('UNKNOWN_FUTURE_CODE')).toBe(0);
    });

    it('returns 0 for null/undefined/empty code', () => {
      expect(lookupErrorCode(null)).toBe(0);
      expect(lookupErrorCode(undefined)).toBe(0);
      expect(lookupErrorCode('')).toBe(0);
    });

    it('does not have duplicate IDs', () => {
      const values = Object.values(ERROR_CODE_IDS);
      const unique = new Set(values);
      expect(unique.size).toBe(values.length);
    });
  });

  describe('METHOD_IDS + lookupMethod', () => {
    it('maps standard HTTP methods to 1..5', () => {
      expect(METHOD_IDS.GET).toBe(1);
      expect(METHOD_IDS.POST).toBe(2);
      expect(METHOD_IDS.PUT).toBe(3);
      expect(METHOD_IDS.DELETE).toBe(4);
      expect(METHOD_IDS.PATCH).toBe(5);
    });

    it('lookupMethod is case-insensitive', () => {
      expect(lookupMethod('get')).toBe(1);
      expect(lookupMethod('GET')).toBe(1);
      expect(lookupMethod('Post')).toBe(2);
    });

    it('lookupMethod returns 0 for unknown method', () => {
      expect(lookupMethod('OPTIONS')).toBe(0);
      expect(lookupMethod('')).toBe(0);
    });
  });
});
