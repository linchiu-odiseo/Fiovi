import { describe, it, expect, beforeEach } from 'vitest';
import { GetTutorExamDetailUseCase } from '../../../src/L2_application/use-cases/get-tutor-exam-detail.use-case';
import { TutorExamDetail } from '../../../src/L1_domain/value-objects/tutor-exam-detail';
import { ExamServerStatus } from '../../../src/L1_domain/value-objects/exam-server-status';
import { VirtualExamNotFoundError } from '../../../src/L1_domain/errors/virtual-exam-not-found.error';
import { FakeTutorExamsApi } from './fakes';

function buildDetail(): TutorExamDetail {
  return {
    id: 'det-1',
    recordId: 'rec-1',
    status: new ExamServerStatus('scheduled'),
    name: 'Examen de prueba',
    course: null,
    area: null,
    count: null,
    duration: 3600,
    enabledStudentIds: ['s-1', 's-2'],
    startedAt: null,
    finishedAt: null,
    createdAt: new Date('2026-06-01T10:00:00Z'),
  };
}

describe('GetTutorExamDetailUseCase', () => {
  let api: FakeTutorExamsApi;
  let useCase: GetTutorExamDetailUseCase;

  beforeEach(() => {
    api = new FakeTutorExamsApi();
    useCase = new GetTutorExamDetailUseCase(api);
  });

  it('delega execute({ recordId }) a getExamDetail(recordId) y retorna TutorExamDetail', async () => {
    const detail = buildDetail();
    api.willResolveGetExamDetail(detail);

    const result = await useCase.execute({ recordId: 'rec-1' });

    expect(result).toBe(detail);
    expect(api.getGetExamDetailCalls()).toEqual(['rec-1']);
  });

  it('propaga VirtualExamNotFoundError sin envoltorio', async () => {
    api.willRejectGetExamDetail(new VirtualExamNotFoundError());
    await expect(useCase.execute({ recordId: 'rec-1' })).rejects.toBeInstanceOf(
      VirtualExamNotFoundError,
    );
  });
});
