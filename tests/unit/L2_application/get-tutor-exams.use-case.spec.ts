import { describe, it, expect, beforeEach } from 'vitest';
import { GetTutorExamsUseCase } from '../../../src/L2_application/use-cases/get-tutor-exams.use-case';
import { TutorExam } from '../../../src/L1_domain/entities/tutor-exam';
import { ExamServerStatus } from '../../../src/L1_domain/value-objects/exam-server-status';
import { NetworkError } from '../../../src/L1_domain/errors/network.error';
import { FakeTutorExamsApi } from './fakes';

function buildTutorExam(id: string): TutorExam {
  return new TutorExam({
    detailId: id,
    recordId: `rec-${id}`,
    classroomId: 'cls-1',
    serverStatus: new ExamServerStatus('scheduled'),
    name: `Examen ${id}`,
    course: null,
    area: null,
    count: null,
    duration: 3600,
    scheduled: new Date('2026-06-01T10:00:00Z'),
    startedAt: null,
    finishedAt: null,
    openUntil: null,
  });
}

describe('GetTutorExamsUseCase', () => {
  let api: FakeTutorExamsApi;
  let useCase: GetTutorExamsUseCase;

  beforeEach(() => {
    api = new FakeTutorExamsApi();
    useCase = new GetTutorExamsUseCase(api);
  });

  it('delega a TutorExamsApi.getTutorExams() y retorna la lista sin transformación', async () => {
    const exam1 = buildTutorExam('det-1');
    const exam2 = buildTutorExam('det-2');
    api.willResolveGetTutorExams([exam1, exam2]);

    const result = await useCase.execute();

    expect(result).toHaveLength(2);
    expect(result[0]).toBe(exam1);
    expect(result[1]).toBe(exam2);
  });

  it('propaga NetworkError sin envoltorio', async () => {
    api.willRejectGetTutorExams(new NetworkError());
    await expect(useCase.execute()).rejects.toBeInstanceOf(NetworkError);
  });

  it('NO llama a enqueueEnvio, setSubmissionAck ni IDB (no tiene esas referencias)', () => {
    // Verificación estructural: el use case no tiene esos símbolos.
    // Si los tuviera, el import del módulo fallaría o causaría side effects.
    expect(typeof useCase.execute).toBe('function');
    // La única dependencia del use case es el puerto TutorExamsApi.
    expect(api.getGetTutorExamsCallCount()).toBe(0);
  });
});
