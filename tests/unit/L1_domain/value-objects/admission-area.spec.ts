import { describe, it, expect } from 'vitest';
import {
  AdmissionArea,
  ADMISSION_AREAS,
  DEFAULT_ADMISSION_AREA,
  isAdmissionArea,
} from '../../../../src/L1_domain/value-objects/admission-area';

// VO de área de POSTULACIÓN del alumno (NO confundir con Exam.area — curso).
// Set cerrado de 16 valores hardcoded en L1 (design.md D2 de
// `add-admission-area`): guard por igualdad estricta, sin factory, sin Zod.
// Estos tests son el contrato del set — si crece o se reordena, la UI del
// picker (grid rígido 3×6 con GENERAL span-3) deja de calzar.
describe('AdmissionArea', () => {
  describe('isAdmissionArea — set cerrado de 16 valores', () => {
    const VALID: readonly AdmissionArea[] = [
      'A',
      'A1',
      'B',
      'C',
      'D',
      'E',
      'I',
      'II',
      'III',
      'IV',
      'V',
      'G',
      'APT',
      'CIE',
      'MAT',
      'GENERAL',
    ];

    it.each(VALID)('acepta "%s" (miembro del set)', (value) => {
      expect(isAdmissionArea(value)).toBe(true);
    });

    it('rechaza "VI" (romano fuera del set — defensa contra "y si agregan uno más")', () => {
      expect(isAdmissionArea('VI')).toBe(false);
    });

    it('rechaza "a" (letra minúscula — el set es case-sensitive)', () => {
      expect(isAdmissionArea('a')).toBe(false);
    });

    it('rechaza "general" (lowercase — no matchea DEFAULT_ADMISSION_AREA)', () => {
      expect(isAdmissionArea('general')).toBe(false);
    });

    it('rechaza string vacío', () => {
      expect(isAdmissionArea('')).toBe(false);
    });

    it('rechaza null', () => {
      expect(isAdmissionArea(null)).toBe(false);
    });

    it('rechaza undefined', () => {
      expect(isAdmissionArea(undefined)).toBe(false);
    });

    it('rechaza número (42)', () => {
      expect(isAdmissionArea(42)).toBe(false);
    });

    it('rechaza objeto ({})', () => {
      expect(isAdmissionArea({})).toBe(false);
    });
  });

  describe('ADMISSION_AREAS — orden y tamaño estables', () => {
    it('tiene exactamente 16 valores', () => {
      expect(ADMISSION_AREAS.length).toBe(16);
    });

    // El orden importa: el picker LR renderiza en 3 filas × 6 cols
    //   Fila 1: A   A1  B   C   D   E
    //   Fila 2: I   II  III IV  V   G
    //   Fila 3: APT CIE MAT GENERAL(span 3)
    // Si el orden cambia, el layout se rompe silenciosamente.
    it('mantiene el orden exacto del design.md D2 + D6', () => {
      expect([...ADMISSION_AREAS]).toEqual([
        'A',
        'A1',
        'B',
        'C',
        'D',
        'E',
        'I',
        'II',
        'III',
        'IV',
        'V',
        'G',
        'APT',
        'CIE',
        'MAT',
        'GENERAL',
      ]);
    });
  });

  describe('DEFAULT_ADMISSION_AREA', () => {
    // El default vive acá — NO se persiste — para preservar la distinción
    // "eligió GENERAL" vs "todavía no eligió" (design.md D3).
    it('es "GENERAL"', () => {
      expect(DEFAULT_ADMISSION_AREA).toBe('GENERAL');
    });

    it('pasa isAdmissionArea (auto-consistencia del set)', () => {
      expect(isAdmissionArea(DEFAULT_ADMISSION_AREA)).toBe(true);
    });
  });
});
