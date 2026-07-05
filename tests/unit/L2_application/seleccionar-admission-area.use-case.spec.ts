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

  describe('input inválido — rechaza sin tocar storage', () => {
    // Set cerrado de 16 valores; cualquier cosa fuera → InvalidAdmissionAreaError.
    // "VI" es el caso natural (numeral romano válido semánticamente pero
    // no incluido en el set) — probaría un typo del picker que no se atrapó.
    it('area "VI" (fuera del set) → InvalidAdmissionAreaError sin persistir', async () => {
      await expect(useCase.execute({ examId: 'X', area: 'VI' })).rejects.toBeInstanceOf(
        InvalidAdmissionAreaError,
      );

      expect(await storage.getAdmissionArea('X')).toBeNull();
      expect(storage.getOpsLog()).not.toContain('markings.setAdmissionArea');
    });

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
