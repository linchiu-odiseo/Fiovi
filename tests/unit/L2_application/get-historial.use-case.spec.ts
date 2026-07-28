import { describe, it, expect, beforeEach } from 'vitest';
import { GetHistorialUseCase } from '../../../src/L2_application/use-cases/get-historial.use-case';
import { Exam } from '../../../src/L1_domain/entities/exam';
import { ExamServerStatus } from '../../../src/L1_domain/value-objects/exam-server-status';
import { SubmissionAck } from '../../../src/L1_domain/value-objects/submission-ack';
import { InMemoryMarkingsStorage } from './fakes';

const HASH = '0'.repeat(64);
const ALT_HASH = '1'.repeat(64);

function buildExam(id: string, name = 'Examen X', course: string | null = 'Anatomía'): Exam {
  return new Exam({
    id,
    area: null,
    course,
    type: 'examen',
    name,
    count: 5,
    duration: 300,
    serverStatus: new ExamServerStatus('in_progress'),
    scheduled: new Date('2026-06-17T10:00:00.000Z'),
    started: new Date('2026-06-17T10:00:00.000Z'),
    finished: null,
    openUntil: null,
  });
}

describe('GetHistorialUseCase', () => {
  let markings: InMemoryMarkingsStorage;
  let useCase: GetHistorialUseCase;

  beforeEach(() => {
    markings = new InMemoryMarkingsStorage();
    useCase = new GetHistorialUseCase(markings);
  });

  it('retorna lista vacía cuando no hay acks locales', async () => {
    const entries = await useCase.execute([]);
    expect(entries).toEqual([]);
  });

  it('mapea cada ack a una entrada con estado="envio"', async () => {
    const ack = new SubmissionAck('ack-1', HASH, new Date('2026-06-17T15:30:00.000Z'));
    await markings.setSubmissionAck('exam-1', ack);

    const entries = await useCase.execute([buildExam('exam-1', 'Anatomía sem1')]);

    expect(entries).toHaveLength(1);
    expect(entries[0].examId).toBe('exam-1');
    expect(entries[0].estado).toBe('envio');
    expect(entries[0].ackId).toBe('ack-1');
    expect(entries[0].submissionHash).toBe(HASH);
    expect(entries[0].submittedAt?.toISOString()).toBe('2026-06-17T15:30:00.000Z');
  });

  it('enriquece con nombre + curso cuando el examen viene en todaysExams', async () => {
    const ack = new SubmissionAck('ack-1', HASH, new Date('2026-06-17T15:30:00.000Z'));
    await markings.setSubmissionAck('exam-1', ack);

    const entries = await useCase.execute([buildExam('exam-1', 'Anatomía sem1', 'Anatomía')]);

    expect(entries[0].examName).toBe('Anatomía sem1');
    expect(entries[0].courseName).toBe('Anatomía');
  });

  it('deja name/course en null cuando el ack no coincide con ningún examen de hoy', async () => {
    const ack = new SubmissionAck('ack-old', HASH, new Date('2026-06-15T15:30:00.000Z'));
    await markings.setSubmissionAck('exam-old', ack);

    const entries = await useCase.execute([]);

    expect(entries[0].examName).toBeNull();
    expect(entries[0].courseName).toBeNull();
    expect(entries[0].submittedAt).not.toBeNull();
    expect(entries[0].submissionHash).toBe(HASH);
  });

  it('ordena por submittedAt descendente (más reciente primero)', async () => {
    const older = new SubmissionAck('ack-old', HASH, new Date('2026-06-15T10:00:00.000Z'));
    const newer = new SubmissionAck('ack-new', ALT_HASH, new Date('2026-06-17T10:00:00.000Z'));
    await markings.setSubmissionAck('exam-old', older);
    await markings.setSubmissionAck('exam-new', newer);

    const entries = await useCase.execute([]);

    expect(entries[0].examId).toBe('exam-new');
    expect(entries[1].examId).toBe('exam-old');
  });
});
