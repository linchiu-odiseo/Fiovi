import { describe, it, expect } from 'vitest';
import { AulaSemanaExamGrupo } from '../../../../src/L1_domain/entities/aula-semana-exam-grupo';
import { TutorExam } from '../../../../src/L1_domain/entities/tutor-exam';
import { ExamServerStatus } from '../../../../src/L1_domain/value-objects/exam-server-status';

function fakeExam(name: string): TutorExam {
  return new TutorExam({
    detailId: `d-${name}`,
    recordId: `r-${name}`,
    classroomId: 'c-1',
    serverStatus: new ExamServerStatus('scheduled'),
    name,
    course: 'ÁLGEBRA',
    area: 'Números',
    count: 4,
    duration: 900,
    scheduled: new Date('2026-04-15T09:00:00Z'),
    startedAt: null,
    finishedAt: null,
    openUntil: null,
  });
}

describe('AulaSemanaExamGrupo', () => {
  it('displayName retorna el nombre del curso cuando no es null', () => {
    const g = new AulaSemanaExamGrupo({
      courseId: 'course-1',
      course: 'ÁLGEBRA',
      area: 'Números',
      examenes: [],
    });
    expect(g.displayName).toBe('ÁLGEBRA');
  });

  it('displayName cae en "General" cuando course es null (bucket general)', () => {
    const g = new AulaSemanaExamGrupo({
      courseId: null,
      course: null,
      area: null,
      examenes: [],
    });
    expect(g.displayName).toBe('General');
  });

  it('total refleja la cantidad de exámenes del grupo', () => {
    const g = new AulaSemanaExamGrupo({
      courseId: 'course-1',
      course: 'ÁLGEBRA',
      area: 'Números',
      examenes: [fakeExam('A1'), fakeExam('A2'), fakeExam('A3')],
    });
    expect(g.total).toBe(3);
  });

  it('total es 0 para grupo vacío', () => {
    const g = new AulaSemanaExamGrupo({
      courseId: 'course-1',
      course: 'ÁLGEBRA',
      area: 'Números',
      examenes: [],
    });
    expect(g.total).toBe(0);
  });
});
