import { describe, it, expect } from 'vitest';
import {
  KnownAdmissionArea,
  ADMISSION_AREAS,
  DEFAULT_ADMISSION_AREA,
  isAdmissionArea,
  isKnownAdmissionArea,
} from '../../../../src/L1_domain/value-objects/admission-area';

// VO de área de POSTULACIÓN del alumno (NO confundir con Exam.area — curso).
// Con `exam-admission-areas-picker` (2026-08-15), el union es ABIERTO:
// `AdmissionArea = KnownAdmissionArea | (string & {})`. Las 16 hardcoded
// siguen viviendo como `KnownAdmissionArea` (con autocomplete y layout
// especial GENERAL span-3), pero el back es autoridad y puede mandar labels
// arbitrarios que el picker renderiza tal cual.
describe('AdmissionArea', () => {
  describe('isAdmissionArea — guard relajado (cualquier string no vacío)', () => {
    const KNOWN_VALID: readonly KnownAdmissionArea[] = [
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

    it.each(KNOWN_VALID)('acepta "%s" (miembro del set conocido)', (value) => {
      expect(isAdmissionArea(value)).toBe(true);
    });

    // Post-rollout: acepta strings arbitrarios del back — el back es
    // autoridad sobre qué áreas existen (learnex snapshot de ExamStructureArea.name).
    it('acepta "VI" (label arbitrario del back — union abierto)', () => {
      expect(isAdmissionArea('VI')).toBe(true);
    });

    it('acepta "a" (case-sensitive ya no importa — cualquier string va)', () => {
      expect(isAdmissionArea('a')).toBe(true);
    });

    it('acepta "general" lowercase (el back puede mandarlo tal cual)', () => {
      expect(isAdmissionArea('general')).toBe(true);
    });

    it('acepta "Z-CUSTOM" (label con guión — string arbitrario)', () => {
      expect(isAdmissionArea('Z-CUSTOM')).toBe(true);
    });

    it('rechaza string vacío', () => {
      expect(isAdmissionArea('')).toBe(false);
    });

    it('rechaza string solo con whitespace', () => {
      expect(isAdmissionArea('   ')).toBe(false);
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

  describe('isKnownAdmissionArea — narrower para las 16 conocidas', () => {
    it('acepta "APT" (miembro del set conocido)', () => {
      expect(isKnownAdmissionArea('APT')).toBe(true);
    });

    it('acepta "GENERAL" (default)', () => {
      expect(isKnownAdmissionArea('GENERAL')).toBe(true);
    });

    it('rechaza "VI" (fuera del set conocido — string arbitrario del back)', () => {
      expect(isKnownAdmissionArea('VI')).toBe(false);
    });

    it('rechaza "general" (case-sensitive)', () => {
      expect(isKnownAdmissionArea('general')).toBe(false);
    });

    it('rechaza string vacío', () => {
      expect(isKnownAdmissionArea('')).toBe(false);
    });

    it('rechaza null', () => {
      expect(isKnownAdmissionArea(null)).toBe(false);
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
