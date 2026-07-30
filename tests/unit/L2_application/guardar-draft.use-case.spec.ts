import { describe, it, expect, beforeEach } from 'vitest';
import { GuardarDraftUseCase } from '../../../src/L2_application/use-cases/guardar-draft.use-case';
import { DraftRequest, ExamsApi, ExamsListResult } from '../../../src/L1_domain/ports/exams-api';
import { Identity } from '../../../src/L1_domain/entities/identity';
import { SessionExpiredError } from '../../../src/L1_domain/errors/session-expired.error';
import { SimulacroCerradoError } from '../../../src/L1_domain/errors/simulacro-cerrado.error';
import { FakeIdentityStorage, InMemoryMarkingsStorage } from './fakes';

// Fake ExamsApi mínimo para GuardarDraftUseCase — solo implementa guardarDraft.
class FakeDraftExamsApi implements ExamsApi {
  private draftPlan: { kind: 'resolve' } | { kind: 'reject'; error: Error } | null = null;

  public draftCalls: DraftRequest[] = [];

  willResolveDraft(): void {
    this.draftPlan = { kind: 'resolve' };
  }

  willRejectDraft(error: Error): void {
    this.draftPlan = { kind: 'reject', error };
  }

  async guardarDraft(req: DraftRequest): Promise<void> {
    this.draftCalls.push({ ...req });
    if (!this.draftPlan) {
      throw new Error('FakeDraftExamsApi: configurar willResolveDraft o willRejectDraft');
    }
    if (this.draftPlan.kind === 'reject') throw this.draftPlan.error;
  }

  // Métodos del port ExamsApi que no usa este use case.
  async getTodaysExams(): Promise<ExamsListResult> {
    throw new Error('Not used in draft tests');
  }
  async enviar(): Promise<never> {
    throw new Error('Not used in draft tests');
  }
  async enviarHomework(): Promise<never> {
    throw new Error('Not used in draft tests');
  }
  async getMySubmission(): Promise<null> {
    throw new Error('Not used in draft tests');
  }
}

const VALID_CODIGO = '30303011';
const VALID_EMAIL = '30303011@vonex.edu.pe';

function studentIdentity(codigo: string | null = VALID_CODIGO): Identity {
  return new Identity(
    'user-id',
    'tenant-id',
    'vonex',
    VALID_EMAIL,
    codigo,
    ['student'],
    Date.now() + 900_000,
  );
}

describe('GuardarDraftUseCase', () => {
  let api: FakeDraftExamsApi;
  let storage: InMemoryMarkingsStorage;
  let identityStorage: FakeIdentityStorage;
  let useCase: GuardarDraftUseCase;

  beforeEach(async () => {
    api = new FakeDraftExamsApi();
    storage = new InMemoryMarkingsStorage();
    identityStorage = new FakeIdentityStorage();
    await identityStorage.write(studentIdentity());
    useCase = new GuardarDraftUseCase(api, storage, identityStorage);
  });

  describe('Reshape AnswersMap a string compacto de longitud fija = count', () => {
    it('marcas mezcladas con un null intermedio: {1:E, 2:A, 3:null, 4:C} count=4 → "EA-C"', async () => {
      storage.seedMarcacion('exam-1', 1, 'E');
      storage.seedMarcacion('exam-1', 2, 'A');
      storage.seedMarcacion('exam-1', 3, null);
      storage.seedMarcacion('exam-1', 4, 'C');
      api.willResolveDraft();

      await useCase.execute({ examId: 'exam-1', count: 4 });

      expect(api.draftCalls).toHaveLength(1);
      expect(api.draftCalls[0].examId).toBe('exam-1');
      expect(api.draftCalls[0].code).toBe(VALID_CODIGO);
      expect(api.draftCalls[0].responses).toBe('EA-C');
      // El responses es string, NO un objeto.
      expect(typeof api.draftCalls[0].responses).toBe('string');
    });

    it('AnswersMap vacío {} con count=5 → "-----"', async () => {
      api.willResolveDraft();

      await useCase.execute({ examId: 'exam-1', count: 5 });

      expect(api.draftCalls[0].responses).toBe('-----');
      expect(api.draftCalls[0].responses).toHaveLength(5);
    });

    it('todos null {1:null, 2:null, 3:null} con count=3 → "---"', async () => {
      storage.seedMarcacion('exam-1', 1, null);
      storage.seedMarcacion('exam-1', 2, null);
      storage.seedMarcacion('exam-1', 3, null);
      api.willResolveDraft();

      await useCase.execute({ examId: 'exam-1', count: 3 });

      expect(api.draftCalls[0].responses).toBe('---');
    });

    it('marcas dispersas {1:A, 5:D} con count=6 → "A---D-"', async () => {
      storage.seedMarcacion('exam-1', 1, 'A');
      storage.seedMarcacion('exam-1', 5, 'D');
      api.willResolveDraft();

      await useCase.execute({ examId: 'exam-1', count: 6 });

      expect(api.draftCalls[0].responses).toBe('A---D-');
      expect(api.draftCalls[0].responses).toHaveLength(6);
    });

    it('count=0 con {} → "" (string vacío válido por contrato server)', async () => {
      api.willResolveDraft();

      await useCase.execute({ examId: 'exam-1', count: 0 });

      expect(api.draftCalls[0].responses).toBe('');
      expect(api.draftCalls[0].responses).toHaveLength(0);
    });

    it('marca fuera de rango {1:A, 50:B} con count=4 → "A---" (P50 ignorada silenciosamente)', async () => {
      storage.seedMarcacion('exam-1', 1, 'A');
      storage.seedMarcacion('exam-1', 50, 'B');
      api.willResolveDraft();

      await useCase.execute({ examId: 'exam-1', count: 4 });

      expect(api.draftCalls[0].responses).toBe('A---');
      expect(api.draftCalls[0].responses).toHaveLength(4);
    });
  });

  describe('Sesión expirada antes del POST', () => {
    it('identity null → SessionExpiredError sin invocar guardarDraft', async () => {
      await identityStorage.clear();
      api.willResolveDraft();

      await expect(useCase.execute({ examId: 'exam-1', count: 4 })).rejects.toBeInstanceOf(
        SessionExpiredError,
      );

      expect(api.draftCalls).toEqual([]);
      expect(storage.getOpsLog()).not.toContain('markings.setMarcacion');
    });

    it('identity.codigo === null → SessionExpiredError sin invocar guardarDraft', async () => {
      await identityStorage.write(studentIdentity(null));
      api.willResolveDraft();

      await expect(useCase.execute({ examId: 'exam-1', count: 4 })).rejects.toBeInstanceOf(
        SessionExpiredError,
      );

      expect(api.draftCalls).toEqual([]);
    });
  });

  describe('admissionArea — propagación al DraftRequest', () => {
    // Mismo patrón que EnviarSimulacroUseCase: getAdmissionArea con fallback
    // DEFAULT_ADMISSION_AREA sin persistir (design.md D3 de
    // `add-admission-area`).
    it('area sembrada con seedAdmissionArea se propaga al DraftRequest', async () => {
      storage.seedAdmissionArea('exam-1', 'APT');
      api.willResolveDraft();

      await useCase.execute({ examId: 'exam-1', count: 4 });

      expect(api.draftCalls[0].admissionArea).toBe('APT');
    });

    it('sin sembrar → DraftRequest recibe GENERAL', async () => {
      api.willResolveDraft();

      await useCase.execute({ examId: 'exam-1', count: 4 });

      expect(api.draftCalls[0].admissionArea).toBe('GENERAL');
    });

    it('el use case NUNCA invoca setAdmissionArea (default NO se persiste)', async () => {
      api.willResolveDraft();

      await useCase.execute({ examId: 'exam-1', count: 4 });

      expect(storage.getOpsLog()).not.toContain('markings.setAdmissionArea');
    });
  });

  describe('Use case NO toca queue ni ack ni clear', () => {
    it('tras éxito, NO invoca enqueueEnvio ni setSubmissionAck ni clearMarcaciones', async () => {
      storage.seedMarcacion('exam-1', 1, 'A');
      api.willResolveDraft();

      await useCase.execute({ examId: 'exam-1', count: 4 });

      const log = storage.getOpsLog();
      expect(log).not.toContain('markings.enqueueEnvio');
      expect(log).not.toContain('markings.setSubmissionAck');
      expect(log).not.toContain('markings.clearMarcaciones');
    });
  });

  describe('Errores del port se propagan tal cual', () => {
    it('SimulacroCerradoError del port propaga sin envoltorio', async () => {
      storage.seedMarcacion('exam-1', 1, 'A');
      const error = new SimulacroCerradoError();
      api.willRejectDraft(error);

      await expect(useCase.execute({ examId: 'exam-1', count: 4 })).rejects.toBe(error);
    });

    it('error genérico propaga tal cual', async () => {
      const error = new Error('error-generico');
      api.willRejectDraft(error);

      await expect(useCase.execute({ examId: 'exam-1', count: 4 })).rejects.toBe(error);
    });
  });
});
