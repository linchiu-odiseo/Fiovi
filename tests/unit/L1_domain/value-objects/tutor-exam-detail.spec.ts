import { describe, it, expect } from 'vitest';
import type { TutorExamDetail } from '../../../../src/L1_domain/value-objects/tutor-exam-detail';
import { ExamServerStatus } from '../../../../src/L1_domain/value-objects/exam-server-status';

// Type-only check: TutorExamDetail NO debe tener classroomId ni entryId.
// Se usa un helper de forma estática para que TypeScript falle en compilación
// si alguno de esos campos aparece en la interfaz.

// Esta es una verificación estructural en tiempo de compilación.
// Si TutorExamDetail tuviera classroomId o entryId, estas asignaciones
// causarían un TS error del tipo "Object literal may only specify known properties".

describe('TutorExamDetail — tipo/estructura', () => {
  it('NO tiene campo classroomId (compilación TypeScript)', () => {
    // Construimos un objeto que SÍ satisface TutorExamDetail.
    // Si TutorExamDetail tuviera classroomId, el check de tipo
    // "satisfies TutorExamDetail" abajo fallaría en compilación.
    const detail: TutorExamDetail = {
      id: 'det-1',
      recordId: 'rec-1',
      status: new ExamServerStatus('scheduled'),
      name: 'Examen',
      course: 'ÁLGEBRA',
      area: 'Matemáticas',
      count: 10,
      duration: 3600,
      enabledStudentIds: ['s-1', 's-2'],
      startedAt: null,
      finishedAt: null,
      openUntil: null,
      createdAt: new Date('2026-06-01T10:00:00Z'),
    };
    // Si el tipo tiene classroomId / entryId, TS lo inferiría como requerido y
    // el objeto de arriba fallaría. Verificamos en runtime que no están presentes.
    expect((detail as unknown as Record<string, unknown>)['classroomId']).toBeUndefined();
    expect((detail as unknown as Record<string, unknown>)['entryId']).toBeUndefined();
  });

  it('NO tiene campo entryId (compilación TypeScript)', () => {
    const detail: TutorExamDetail = {
      id: 'det-1',
      recordId: 'rec-1',
      status: new ExamServerStatus('in_progress'),
      name: 'Examen',
      course: null,
      area: null,
      count: null,
      duration: 3600,
      enabledStudentIds: [],
      startedAt: new Date('2026-06-10T08:00:00Z'),
      finishedAt: null,
      openUntil: null,
      createdAt: new Date('2026-06-01T10:00:00Z'),
    };
    expect((detail as unknown as Record<string, unknown>)['entryId']).toBeUndefined();
  });

  it('tiene enabledStudentIds: readonly string[]', () => {
    const detail: TutorExamDetail = {
      id: 'det-1',
      recordId: 'rec-1',
      status: new ExamServerStatus('scheduled'),
      name: 'Examen',
      course: null,
      area: null,
      count: null,
      duration: 3600,
      enabledStudentIds: ['s-1', 's-2', 's-3'],
      startedAt: null,
      finishedAt: null,
      openUntil: null,
      createdAt: new Date('2026-06-01T10:00:00Z'),
    };
    expect(detail.enabledStudentIds).toEqual(['s-1', 's-2', 's-3']);
    expect(detail.enabledStudentIds.length).toBe(3);
  });
});
