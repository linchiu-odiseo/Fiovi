import { TutorExam } from '../entities/tutor-exam';
import { TutorExamDetail } from '../value-objects/tutor-exam-detail';
import { ClassroomStudent } from '../value-objects/classroom-student';

// Resultado de finalizar un virtual exam. `transitioned` indica si el examen
// cambió de estado en esta llamada (true = primera finalización) o si ya estaba
// finalizado (false = idempotente, no es un error). `jobId` está presente
// cuando el backend lanzó un job de procesamiento de entregas.
export interface FinalizeResult {
  transitioned: boolean;
  jobId?: string;
}

// Puerto del dominio para los endpoints de virtual exams del tutor.
// Implementación concreta: HttpTutorExamsApi en L3.
// NO importa nada de Angular — sin HttpClient, sin Injectable, sin decoradores.
//
// Mapeo de errores HTTP por status (clasificación en classifyTutorError — ver D2):
//   400                     → InvalidPayloadError
//   401                     → manejado por credentials.interceptor (refresh + redirect)
//   403                     → TutorExamForbiddenError
//   404                     → VirtualExamNotFoundError
//   409                     → ExamConflictError
//   422                     → ExamPreconditionError
//   0 / 429 / 5xx / timeout → NetworkError
//
// Clasificación por STATUS PURO: el back tutor emite codes genéricos
// (forbidden, not_found, conflict, unprocessable_entity) y messages en prosa
// variable (inglés + UUIDs). No son contrato de control en snake_case como el
// flujo del alumno — ver design.md D2.
export interface TutorExamsApi {
  // GET /t/:slug/tutor/virtual-exams — lista de virtual exams del tutor.
  // Errores posibles: TutorExamForbiddenError (403), NetworkError (red/timeout).
  getTutorExams(): Promise<readonly TutorExam[]>;

  // GET /t/:slug/tutor/exams/finalizadas — lista cross-classroom de virtual
  // exams finalizados no-archivados del tutor. Payload liviano (0-10 items
  // típicos post-archived 00h) para /tutor/actividad. Los items traen
  // `classroomCode`/`classroomName` (a diferencia del endpoint gordo).
  // Errores posibles: TutorExamForbiddenError (403), NetworkError.
  getExamsFinalizadas(): Promise<readonly TutorExam[]>;

  // GET /t/:slug/virtual-exams/:recordId — detalle con enabledStudentIds.
  // Errores posibles: VirtualExamNotFoundError (404), TutorExamForbiddenError (403), NetworkError.
  getExamDetail(recordId: string): Promise<TutorExamDetail>;

  // GET /t/:slug/classrooms/:classroomId/students?virtualExamDetailId=
  // `virtualExamDetailId` es el detailId (dto.id de la lista), NO el recordId.
  // Errores posibles: TutorExamForbiddenError (403), VirtualExamNotFoundError (404), NetworkError.
  listClassroomStudents(req: {
    classroomId: string;
    virtualExamDetailId: string;
  }): Promise<readonly ClassroomStudent[]>;

  // PATCH /t/:slug/virtual-exams/:recordId/enabled-students
  // Body: { enabledStudentIds: string[] }. Respuesta: 200 void.
  // Errores posibles: ExamConflictError (409 — alumno con hasSubmitted o set congelado),
  //                   ExamPreconditionError (422 — configuración inválida), NetworkError.
  updateEnabledStudents(req: {
    recordId: string;
    enabledStudentIds: readonly string[];
  }): Promise<void>;

  // POST /t/:slug/virtual-exams/:recordId/start
  // Body opcional: `{ duration?, openUntil? }`.
  //   - `duration`: segundos (60..7200) sobrescribe la duración creada.
  //   - `openUntil`: Date opcional. Cuando se pasa, el examen arranca en modo
  //     "tarea" (ventana global hasta esa fecha; countdown por alumno cliente).
  //     Cuando se omite, arranca en modo "examen" (comportamiento heredado).
  // Respuesta: 204 void.
  // Errores posibles: InvalidPayloadError (400 — duración fuera de rango),
  //                   ExamConflictError (409 — ya iniciado),
  //                   ExamPreconditionError (422 — 0 alumnos habilitados,
  //                     claves no configuradas, o openUntil fuera de rango),
  //                   NetworkError.
  iniciar(recordId: string, opts?: { duration?: number; openUntil?: Date }): Promise<void>;

  // POST /t/:slug/virtual-exams/:recordId/finalize — sin body.
  // Respuesta: 200 (NO 202 ni 204) con body { transitioned, jobId? } — ver design.md R2.
  // Errores posibles: ExamConflictError (409), ExamPreconditionError (422 — aún no iniciado),
  //                   NetworkError.
  finalizar(recordId: string): Promise<FinalizeResult>;

  // POST /t/:slug/virtual-exams/:recordId/archive — sin body. Respuesta: 204 void.
  // Transición finalized → archived (irreversible; el examen sale de la lista del tutor).
  // Errores posibles: VirtualExamNotFoundError (404), TutorExamForbiddenError (403),
  //                   ExamConflictError (409 — ya archivado / aún no finalizado),
  //                   NetworkError.
  archivar(recordId: string): Promise<void>;

  // POST /t/:slug/virtual-exams/:recordId/refresh-enabled — sin body.
  // Reconcilia la lista de alumnos habilitados con las matrículas actuales del aula.
  // Solo válido cuando status === 'scheduled'; si ya está en otro estado devuelve 409.
  // Errores posibles: TutorExamForbiddenError (403), VirtualExamNotFoundError (404),
  //                   ExamConflictError (409 — status no es scheduled),
  //                   ExamPreconditionError (422 — recordId inválido u otros),
  //                   0 / 429 / 5xx / timeout → NetworkError.
  refreshEnabled(recordId: string): Promise<{ addedCount: number; totalEnabledCount: number }>;
}
