import { describe, it, expect, beforeEach } from 'vitest';
import { GetHistorialEntryUseCase } from '../../../src/L2_application/use-cases/get-historial-entry.use-case';
import { Exam } from '../../../src/L1_domain/entities/exam';
import { ExamServerStatus } from '../../../src/L1_domain/value-objects/exam-server-status';
import { SubmissionAck } from '../../../src/L1_domain/value-objects/submission-ack';
import { InMemoryMarkingsStorage } from './fakes';

const HASH = '0'.repeat(64);

function buildExam(id: string, name = 'Anatomía sem1'): Exam {
  return new Exam({
    id,
    area: null,
    course: 'Anatomía',
    type: 'examen',
    name,
    count: 3,
    duration: 300,
    serverStatus: new ExamServerStatus('finalized'),
    scheduled: new Date('2026-06-17T10:00:00.000Z'),
    started: new Date('2026-06-17T10:00:00.000Z'),
    finished: new Date('2026-06-17T11:00:00.000Z'),
    openUntil: null,
  });
}

describe('GetHistorialEntryUseCase', () => {
  let markings: InMemoryMarkingsStorage;
  let useCase: GetHistorialEntryUseCase;

  beforeEach(() => {
    markings = new InMemoryMarkingsStorage();
    useCase = new GetHistorialEntryUseCase(markings);
  });

  it('retorna ack + marcaciones del snapshot + admissionArea del snapshot', async () => {
    // Simulamos post-envío: hay ack + snapshot congelado + NO hay marcaciones
    // activas (el clear ya se ejecutó tras el submit).
    const ack = new SubmissionAck('ack-1', HASH, new Date('2026-06-17T10:30:00.000Z'));
    await markings.setSubmissionAck('exam-1', ack);
    await markings.saveSubmissionSnapshot('exam-1', {
      answers: { '1': 'A', '2': 'C', '3': 'E' },
      admissionArea: 'B',
    });

    const detalle = await useCase.execute('exam-1', [buildExam('exam-1')]);

    expect(detalle.examId).toBe('exam-1');
    expect(detalle.ack?.id).toBe('ack-1');
    expect(detalle.marcaciones).toEqual({ '1': 'A', '2': 'C', '3': 'E' });
    expect(detalle.admissionArea).toBe('B');
    expect(detalle.exam?.name).toBe('Anatomía sem1');
  });

  it('snapshot manda sobre marcaciones activas cuando ambos existen (defensa)', async () => {
    // Edge case: snapshot presente + marcaciones activas también (no debería
    // pasar en flujo normal, pero si pasa, snapshot es la fuente de verdad
    // porque representa lo que se envió al back).
    await markings.saveSubmissionSnapshot('exam-1', {
      answers: { '1': 'A' },
      admissionArea: 'A',
    });
    // Marcaciones "activas" con valor distinto — el snapshot debe ganar.
    await markings.setMarcacion('exam-1', 1, 'E');

    const detalle = await useCase.execute('exam-1', []);

    expect(detalle.marcaciones).toEqual({ '1': 'A' });
    expect(detalle.admissionArea).toBe('A');
  });

  it('fallback a marcaciones activas cuando no hay snapshot (legacy pre-migración)', async () => {
    // Ack presente pero snapshot ausente — envío hecho antes de que existiera
    // el snapshot en el port. Historial degrada leyendo marcaciones activas
    // (que en flujo real serían {} porque el clear corrió, pero acá seedeamos
    // para verificar el path).
    const ack = new SubmissionAck('ack-legacy', HASH, new Date('2026-06-17T10:30:00.000Z'));
    await markings.setSubmissionAck('exam-legacy', ack);
    await markings.setMarcacion('exam-legacy', 1, 'D');

    const detalle = await useCase.execute('exam-legacy', []);

    expect(detalle.marcaciones).toEqual({ '1': 'D' });
    // admissionArea del ack legacy sin snapshot → DEFAULT_ADMISSION_AREA.
    expect(detalle.admissionArea).toBe('GENERAL');
  });

  it('no-envio (finalized sin ack ni snapshot): marcaciones vacías, area null', async () => {
    const detalle = await useCase.execute('exam-cerrado', [buildExam('exam-cerrado', 'Sin envío')]);

    expect(detalle.ack).toBeNull();
    expect(detalle.marcaciones).toEqual({});
    expect(detalle.admissionArea).toBeNull();
    expect(detalle.exam?.name).toBe('Sin envío');
  });

  it('exam null cuando el back ya no lo devuelve (>1 día → archivado)', async () => {
    const ack = new SubmissionAck('ack-old', HASH, new Date('2026-06-15T10:30:00.000Z'));
    await markings.setSubmissionAck('exam-old', ack);
    await markings.saveSubmissionSnapshot('exam-old', {
      answers: { '1': 'A' },
      admissionArea: 'GENERAL',
    });

    const detalle = await useCase.execute('exam-old', []);

    expect(detalle.exam).toBeNull();
    expect(detalle.ack?.id).toBe('ack-old');
    expect(detalle.marcaciones).toEqual({ '1': 'A' });
  });
});
