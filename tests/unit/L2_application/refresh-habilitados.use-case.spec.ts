import { describe, it, expect, beforeEach } from 'vitest';
import { RefreshHabilitadosUseCase } from '../../../src/L2_application/use-cases/refresh-habilitados.use-case';
import { ExamConflictError } from '../../../src/L1_domain/errors/exam-conflict.error';
import { NetworkError } from '../../../src/L1_domain/errors/network.error';
import { FakeTutorExamsApi } from './fakes';

describe('RefreshHabilitadosUseCase', () => {
  let api: FakeTutorExamsApi;
  let useCase: RefreshHabilitadosUseCase;

  beforeEach(() => {
    api = new FakeTutorExamsApi();
    useCase = new RefreshHabilitadosUseCase(api);
  });

  it('happy path: delega a api.refreshEnabled y retorna el resultado sin transformacion', async () => {
    api.willResolveRefreshEnabled({ addedCount: 3, totalEnabledCount: 12 });

    const result = await useCase.execute('rec-1');

    expect(result).toEqual({ addedCount: 3, totalEnabledCount: 12 });
    expect(api.getRefreshEnabledCalls()).toEqual(['rec-1']);
  });

  it('propaga ExamConflictError sin envoltura (status no scheduled)', async () => {
    api.willRejectRefreshEnabled(new ExamConflictError());

    await expect(useCase.execute('rec-1')).rejects.toBeInstanceOf(ExamConflictError);
    expect(api.getRefreshEnabledCalls()).toEqual(['rec-1']);
  });

  it('propaga NetworkError sin envoltura', async () => {
    api.willRejectRefreshEnabled(new NetworkError());

    await expect(useCase.execute('rec-1')).rejects.toBeInstanceOf(NetworkError);
    expect(api.getRefreshEnabledCalls()).toEqual(['rec-1']);
  });
});
