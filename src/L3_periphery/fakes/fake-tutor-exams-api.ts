import { TutorExamsApi, FinalizeResult } from '../../L1_domain/ports/tutor-exams-api';
import { TutorExam } from '../../L1_domain/entities/tutor-exam';
import { TutorExamDetail } from '../../L1_domain/value-objects/tutor-exam-detail';
import { ClassroomStudent } from '../../L1_domain/value-objects/classroom-student';

// Implementación stub de TutorExamsApi para inyección en TestBed sin HTTP.
// Todos los métodos retornan datos fijos (listas vacías / void / FinalizeResult mínimo).
// Para tests con control de resolve/reject por llamada, usar FakeTutorExamsApi en
// tests/unit/L2_application/fakes.ts que tiene la API de builders completa.
//
// Este fake vive en src/ para que pueda inyectarse en configuraciones de TestBed
// que necesiten el token TUTOR_EXAMS_API pero no quieran HTTP real.
// Ver design.md D7 y tutor-exams-api spec Requirement "Token de inyección TUTOR_EXAMS_API".
export class FakeTutorExamsApi implements TutorExamsApi {
  async getTutorExams(): Promise<readonly TutorExam[]> {
    return [];
  }

  async getExamDetail(_recordId: string): Promise<TutorExamDetail> {
    throw new Error('FakeTutorExamsApi.getExamDetail: not implemented in this stub');
  }

  async listClassroomStudents(_req: {
    classroomId: string;
    virtualExamDetailId: string;
  }): Promise<readonly ClassroomStudent[]> {
    return [];
  }

  async updateEnabledStudents(_req: {
    recordId: string;
    enabledStudentIds: readonly string[];
  }): Promise<void> {
    return;
  }

  async iniciar(_recordId: string, _opts?: { duration?: number; openUntil?: Date }): Promise<void> {
    return;
  }

  async finalizar(_recordId: string): Promise<FinalizeResult> {
    return { transitioned: true };
  }

  async archivar(_recordId: string): Promise<void> {
    return;
  }
}
