import { describe, it, expect, beforeEach } from 'vitest';
import { SeleccionarAdmissionAreaUseCase } from '../../../src/L2_application/use-cases/seleccionar-admission-area.use-case';
import { InvalidAdmissionAreaError } from '../../../src/L1_domain/errors/invalid-admission-area.error';
import { InMemoryMarkingsStorage } from './fakes';

// Cubre `SeleccionarAdmissionAreaUseCase` (L2):
// - Valida el input con isAdmissionArea (defensa en profundidad — el picker
//   UI ya restringe, pero el use case revalida).
// - Delega a MarkingsStorage.setAdmissionArea si el input pasa.
// - Lanza InvalidAdmissionAreaError SIN tocar storage si el input no pertenece
//   al set cerrado.
// - NO toca identity, NO lee marcaciones, NO despacha drafts. Puro.
describe('SeleccionarAdmissionAreaUseCase', () => {
  let storage: InMemoryMarkingsStorage;
  let useCase: SeleccionarAdmissionAreaUseCase;

  beforeEach(() => {
    storage = new InMemoryMarkingsStorage();
    useCase = new SeleccionarAdmissionAreaUseCase(storage);
  });

  describe('input válido — persiste vía MarkingsStorage', () => {
    it('area "MAT" → setAdmissionArea invocado con ("X", "MAT")', async () => {
      await useCase.execute({ examId: 'X', area: 'MAT' });

      // Verificamos vía getAdmissionArea (round-trip) que el area se persistió.
      expect(await storage.getAdmissionArea('X')).toBe('MAT');
      expect(storage.getOpsLog()).toContain('markings.setAdmissionArea');
    });

    it('area "GENERAL" → persiste tal cual (default explícito distinto de "no eligió")', async () => {
      await useCase.execute({ examId: 'X', area: 'GENERAL' });

      expect(await storage.getAdmissionArea('X')).toBe('GENERAL');
    });

    it('cada examId escribe en su propio slot (no colisiona con otros)', async () => {
      await useCase.execute({ examId: 'X', area: 'MAT' });
      await useCase.execute({ examId: 'Y', area: 'CIE' });

      expect(await storage.getAdmissionArea('X')).toBe('MAT');
      expect(await storage.getAdmissionArea('Y')).toBe('CIE');
    });
  });

  describe('strings arbitrarios del back — union abierto post exam-admission-areas-picker', () => {
    // Con el union abierto (`AdmissionArea = KnownAdmissionArea | (string & {})`),
    // cualquier string no vacío es válido — el back es autoridad sobre qué
    // áreas existen. "VI" ya NO es rechazado; se persiste como cualquier otro
    // label. La única validación de dominio queda en shape mínimo (no null,
    // no número, no string vacío).
    it('area "VI" (label arbitrario) → se acepta y persiste', async () => {
      await useCase.execute({ examId: 'X', area: 'VI' });

      expect(await storage.getAdmissionArea('X')).toBe('VI');
      expect(storage.getOpsLog()).toContain('markings.setAdmissionArea');
    });
  });

  describe('input inválido — rechaza sin tocar storage', () => {
    it('area === null → InvalidAdmissionAreaError sin persistir', async () => {
      await expect(useCase.execute({ examId: 'X', area: null })).rejects.toBeInstanceOf(
        InvalidAdmissionAreaError,
      );

      expect(await storage.getAdmissionArea('X')).toBeNull();
      expect(storage.getOpsLog()).not.toContain('markings.setAdmissionArea');
    });

    it('area === 42 (número) → InvalidAdmissionAreaError sin persistir', async () => {
      await expect(useCase.execute({ examId: 'X', area: 42 })).rejects.toBeInstanceOf(
        InvalidAdmissionAreaError,
      );

      expect(await storage.getAdmissionArea('X')).toBeNull();
      expect(storage.getOpsLog()).not.toContain('markings.setAdmissionArea');
    });
  });
});
