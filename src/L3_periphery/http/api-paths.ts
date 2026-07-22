import { environment } from '../../environments/environment';

// Único punto de interpolación del tenant slug en URLs de learnex.
//
// Endpoints GLOBALES (sin slug en path) — descubiertos post PR #481/#482:
//   POST /auth/login                       — cross-tenant, responde con user.slug
//   POST /auth/select-tenant               — completa el flow multi-tenant
//   GET  /auth/sso/providers               — lista dinámica para render del botón
//   GET  /auth/sso/{provider}/start        — inicia OAuth (query `app=pwa`)
//
// Endpoints TENANT-SCOPED (siguen bajo `/t/{slug}/...`) — el slug viene de
// la Identity (login response), NO del `.env`. El caller (HttpAuthRepository
// o adapters de exams/tutor) lee el slug de `SlugStore` y lo pasa a estos
// helpers como parámetro. Si el slug es null/vacío, la URL sale malformada
// a propósito y el request falla — señal de que la app está mal hidratada.

function tenantBase(slug: string): string {
  return `${environment.apiBaseUrl}/t/${encodeURIComponent(slug)}`;
}

export const apiPath = {
  // ---- Globales (sin slug) ---------------------------------------------

  login: (): string => `${environment.apiBaseUrl}/auth/login`,
  selectTenant: (): string => `${environment.apiBaseUrl}/auth/select-tenant`,
  listSsoProviders: (): string => `${environment.apiBaseUrl}/auth/sso/providers`,
  // `returnTo=/` deja que Fiovi decida la ruta final post-callback según role.
  // `app=pwa` hace que el backend redirija a WEB_PWA_BASE_URL (no WEB_TENANT_BASE_URL).
  ssoStart: (provider: string): string =>
    `${environment.apiBaseUrl}/auth/sso/${encodeURIComponent(provider)}/start` +
    `?app=pwa&returnTo=%2F`,

  // ---- Tenant-scoped (con slug del Identity) ---------------------------

  refresh: (slug: string): string => `${tenantBase(slug)}/auth/refresh`,
  logout: (slug: string): string => `${tenantBase(slug)}/auth/logout`,
  me: (slug: string): string => `${tenantBase(slug)}/auth/me`,
  profile: (slug: string, role: 'student' | 'tutor'): string => `${tenantBase(slug)}/${role}/me`,

  studentExamSessions: (slug: string): string => `${tenantBase(slug)}/student/exam-sessions`,
  // `sessionId` viene del `Exam.id` (confirmado por back en handoff de
  // `fase-3-exam-submit-learnex`). encodeURIComponent es defensa básica —
  // el contrato define UUID v4 pero no asumimos sanitización.
  studentExamSubmit: (slug: string, sessionId: string): string =>
    `${tenantBase(slug)}/student/exam-sessions/${encodeURIComponent(sessionId)}/submit`,
  // Auto-save progresivo. Response 204 No Content; sin body.
  studentExamDraft: (slug: string, sessionId: string): string =>
    `${tenantBase(slug)}/student/exam-sessions/${encodeURIComponent(sessionId)}/draft`,

  // ---- Tutor (virtual exams) -------------------------------------------

  tutorVirtualExams: (slug: string): string => `${tenantBase(slug)}/tutor/virtual-exams`,
  // Nav mobile AULA → SEMANA → CURSO → EXÁMENES (PR tutor-aulas-semanas-view).
  // classroomId y periodId son UUID v4; encodeURIComponent como defensa básica.
  tutorAulaSemanas: (slug: string, classroomId: string): string =>
    `${tenantBase(slug)}/tutor/aulas/${encodeURIComponent(classroomId)}/semanas`,
  tutorAulaSemanaExamenes: (slug: string, classroomId: string, periodId: string): string =>
    `${tenantBase(slug)}/tutor/aulas/${encodeURIComponent(classroomId)}` +
    `/semanas/${encodeURIComponent(periodId)}/examenes`,
  // Shortcut cross-aula: exámenes actualmente in_progress del tutor logueado.
  tutorExamsEnCurso: (slug: string): string => `${tenantBase(slug)}/tutor/exams/en-curso`,
  virtualExam: (slug: string, recordId: string): string =>
    `${tenantBase(slug)}/virtual-exams/${encodeURIComponent(recordId)}`,
  classroomStudents: (slug: string, classroomId: string, virtualExamDetailId: string): string =>
    `${tenantBase(slug)}/classrooms/${encodeURIComponent(classroomId)}/students` +
    `?virtualExamDetailId=${encodeURIComponent(virtualExamDetailId)}`,
  virtualExamEnabledStudents: (slug: string, recordId: string): string =>
    `${tenantBase(slug)}/virtual-exams/${encodeURIComponent(recordId)}/enabled-students`,
  virtualExamStart: (slug: string, recordId: string): string =>
    `${tenantBase(slug)}/virtual-exams/${encodeURIComponent(recordId)}/start`,
  // Response 200 (no 202/204) con `{transitioned, jobId?}` — ver design R2.
  virtualExamFinalize: (slug: string, recordId: string): string =>
    `${tenantBase(slug)}/virtual-exams/${encodeURIComponent(recordId)}/finalize`,
  // Transición finalized → archived. Response 204 No Content, sin body.
  virtualExamArchive: (slug: string, recordId: string): string =>
    `${tenantBase(slug)}/virtual-exams/${encodeURIComponent(recordId)}/archive`,
};
