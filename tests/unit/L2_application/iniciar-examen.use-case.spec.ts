import { describe, it, expect, beforeEach } from 'vitest';
import { IniciarExamenUseCase } from '../../../src/L2_application/use-cases/iniciar-examen.use-case';
import { ExamPreconditionError } from '../../../src/L1_domain/errors/exam-precondition.error';
import { FakeTutorExamsApi } from './fakes';

describe('IniciarExamenUseCase', () => {
  let api: FakeTutorExamsApi;
  let useCase: IniciarExamenUseCase;

  beforeEach(() => {
    api = new FakeTutorExamsApi();
    useCase = new IniciarExamenUseCase(api);
  });

  it('delega execute({ recordId }) a iniciar(recordId) y resuelve void', async () => {
    api.willResolveIniciar();

    await expect(useCase.execute({ recordId: 'rec-1' })).resolves.toBeUndefined();
    expect(api.getIniciarCalls()).toEqual(['rec-1']);
  });

  it('propaga ExamPreconditionError sin envoltorio', async () => {
    api.willRejectIniciar(new ExamPreconditionError());
    await expect(useCase.execute({ recordId: 'rec-1' })).rejects.toBeInstanceOf(
      ExamPreconditionError,
    );
  });

  it('NO llama a IDB ni outbox (verificación estructural)', async () => {
    api.willResolveIniciar();
    await useCase.execute({ recordId: 'rec-1' });
    // Si el use case tocara outbox/IDB, el import importaría módulos de
    // IndexedDB que causarían errores en el entorno de test puro.
    expect(api.getIniciarCalls()).toHaveLength(1);
  });

  it('propaga la duración opcional al puerto (override al iniciar)', async () => {
    api.willResolveIniciar();
    await useCase.execute({ recordId: 'rec-1', duration: 1800 });
    expect(api.getIniciarCallsFull()).toEqual([{ recordId: 'rec-1', duration: 1800 }]);
  });

  it('no envía duration cuando no se pasa (mantiene la duración de creación)', async () => {
    api.willResolveIniciar();
    await useCase.execute({ recordId: 'rec-1' });
    expect(api.getIniciarCallsFull()).toEqual([
      { recordId: 'rec-1', duration: undefined, openUntil: undefined, startedAt: undefined },
    ]);
  });

  it('propaga startedAt al adaptador cuando se pasa (apertura programada)', async () => {
    api.willResolveIniciar();
    const startedAt = new Date('2026-08-20T08:00:00.000Z');
    await useCase.execute({ recordId: 'rec-1', startedAt });
    const calls = api.getIniciarCallsFull();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.startedAt).toBe(startedAt);
  });

  it('NO envía startedAt cuando no se pasa (payload limpio)', async () => {
    api.willResolveIniciar();
    await useCase.execute({ recordId: 'rec-1', openUntil: new Date('2026-08-25T23:00:00.000Z') });
    const calls = api.getIniciarCallsFull();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.startedAt).toBeUndefined();
  });
});
