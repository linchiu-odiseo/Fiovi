import { describe, it, expect, beforeEach } from 'vitest';
import { GetHistorialUseCase } from '../../../src/L2_application/use-cases/get-historial.use-case';
import { Exam } from '../../../src/L1_domain/entities/exam';
import { ExamServerStatus } from '../../../src/L1_domain/value-objects/exam-server-status';
import { SubmissionAck } from '../../../src/L1_domain/value-objects/submission-ack';
import { InMemoryMarkingsStorage } from './fakes';

const HASH = '0'.repeat(64);
const ALT_HASH = '1'.repeat(64);

function buildExam(
  id: string,
  name = 'Examen X',
  course: string | null = 'Anatomía',
  serverStatus: 'scheduled' | 'in_progress' | 'finalized' = 'in_progress',
  openUntil: Date | null = null,
): Exam {
  return new Exam({
    id,
    area: null,
    course,
    type: 'examen',
    name,
    count: 5,
    duration: 300,
    serverStatus: new ExamServerStatus(serverStatus),
    scheduled: new Date('2026-06-17T10:00:00.000Z'),
    started: new Date('2026-06-17T10:00:00.000Z'),
    finished: serverStatus === 'finalized' ? new Date('2026-06-17T11:00:00.000Z') : null,
    openUntil,
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

  it('omite acks huérfanos cuando el examen ya no está en todaysExams', async () => {
    // El back archivó el examen a las 00 hs → deja de venir en getExamSessions.
    // Sin el examen en la lista, no podemos completar name/curso, así que
    // la entrada NO se emite. El ack queda en IDB pero es invisible.
    const ack = new SubmissionAck('ack-old', HASH, new Date('2026-06-15T15:30:00.000Z'));
    await markings.setSubmissionAck('exam-old', ack);

    const entries = await useCase.execute([]);

    expect(entries).toEqual([]);
  });

  it('ordena por submittedAt descendente (más reciente primero)', async () => {
    const older = new SubmissionAck('ack-old', HASH, new Date('2026-06-15T10:00:00.000Z'));
    const newer = new SubmissionAck('ack-new', ALT_HASH, new Date('2026-06-17T10:00:00.000Z'));
    await markings.setSubmissionAck('exam-old', older);
    await markings.setSubmissionAck('exam-new', newer);

    const entries = await useCase.execute([
      buildExam('exam-old', 'Anatomía sem1', 'Anatomía'),
      buildExam('exam-new', 'Anatomía sem2', 'Anatomía'),
    ]);

    expect(entries[0].examId).toBe('exam-new');
    expect(entries[1].examId).toBe('exam-old');
  });

  describe('estado "no-envio"', () => {
    it('agrega entrada no-envio para exámenes finalized sin ack local', async () => {
      const entries = await useCase.execute([
        buildExam('exam-cerrado', 'Anatomía sem1', 'Anatomía', 'finalized'),
      ]);

      expect(entries).toHaveLength(1);
      expect(entries[0].estado).toBe('no-envio');
      expect(entries[0].examId).toBe('exam-cerrado');
      expect(entries[0].examName).toBe('Anatomía sem1');
      expect(entries[0].courseName).toBe('Anatomía');
      expect(entries[0].submittedAt).toBeNull();
      expect(entries[0].submissionHash).toBeNull();
      expect(entries[0].ackId).toBeNull();
    });

    it('NO agrega no-envio para exámenes finalized que YA tienen ack (envío gana)', async () => {
      const ack = new SubmissionAck('ack-1', HASH, new Date('2026-06-17T10:30:00.000Z'));
      await markings.setSubmissionAck('exam-1', ack);

      const entries = await useCase.execute([
        buildExam('exam-1', 'Con envío', 'Anatomía', 'finalized'),
      ]);

      expect(entries).toHaveLength(1);
      expect(entries[0].estado).toBe('envio');
    });

    it('NO agrega no-envio para in_progress ni scheduled', async () => {
      const entries = await useCase.execute([
        buildExam('exam-abierto', 'Aún abre', 'Anatomía', 'in_progress'),
        buildExam('exam-programado', 'Programado', 'Anatomía', 'scheduled'),
      ]);

      expect(entries).toEqual([]);
    });

    it('NO agrega no-envio para tareas finalized (viven en /student/tareas)', async () => {
      const openUntil = new Date('2026-06-17T20:00:00.000Z');
      const entries = await useCase.execute([
        buildExam('tarea-1', 'Tarea integradora', 'Física', 'finalized', openUntil),
      ]);

      expect(entries).toEqual([]);
    });

    it('mezcla envios + no-envios: los envios con hora van arriba, no-envios al final', async () => {
      const ack = new SubmissionAck('ack-1', HASH, new Date('2026-06-17T15:00:00.000Z'));
      await markings.setSubmissionAck('exam-enviado', ack);

      const entries = await useCase.execute([
        buildExam('exam-enviado', 'Con envío', 'Anatomía', 'finalized'),
        buildExam('exam-cerrado', 'Sin envío', 'Anatomía', 'finalized'),
      ]);

      expect(entries).toHaveLength(2);
      expect(entries[0].estado).toBe('envio');
      expect(entries[1].estado).toBe('no-envio');
    });
  });
});
