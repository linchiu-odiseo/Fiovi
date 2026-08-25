// Diccionarios numéricos consumidos por el interceptor y el rollup futuro
// (Fase 1). IDs estables — nuevos endpoints/códigos agregan entradas sin
// reindexar los existentes.
//
// El ID 0 está reservado para "unknown" en TODOS los diccionarios: la
// ausencia de match en el interceptor NO lanza, resuelve a 0. Esto genera
// una señal útil en el log (H|u:0 o H|c:0) que dice "acá hay algo sin
// catalogar", visible sin necesidad de leer cada adapter.
//
// Cuando llegue Fase 1 (upload al back), el `AV` (app-version) del batch
// dice qué versión del diccionario aplica al analizar. Nuevos endpoints
// versionados con el bundle vía git.

// Métodos HTTP.
export const METHOD_IDS = {
  GET: 1,
  POST: 2,
  PUT: 3,
  DELETE: 4,
  PATCH: 5,
} as const;

// Endpoints — 1 entrada por cada helper exportado por src/L3_periphery/http/api-paths.ts.
// El adapter marca la request con `context.set(ENDPOINT_ID_TOKEN, ENDPOINT_IDS.foo)`.
// Cuando el adapter no marca, el interceptor asigna 0.
export const ENDPOINT_IDS = {
  // Auth públicos (sin slug)
  login: 1,
  selectTenant: 2,
  listSsoProviders: 3,
  ssoStart: 4,

  // Auth tenant-scoped
  refresh: 10,
  logout: 11,
  me: 12,
  profile: 13,

  // Exams alumno
  studentExamSessions: 20,
  studentExamSubmit: 21,
  studentExamDraft: 22,
  studentExamSubmitHomework: 23,
  studentMySubmission: 24,

  // Tutor
  tutorVirtualExams: 30,
  tutorAulaSemanas: 31,
  tutorAulaSemanaExamenes: 32,
  tutorExamsEnCurso: 33,
  tutorExamsFinalizadas: 34,
  virtualExam: 35,
  classroomStudents: 36,
  virtualExamEnabledStudents: 37,
  virtualExamStart: 38,
  virtualExamFinalize: 39,
  virtualExamArchive: 40,
  virtualExamRefreshEnabled: 41,
} as const;

export type EndpointName = keyof typeof ENDPOINT_IDS;

// Códigos de error server (body.code) — regla #3 del CLAUDE.md: siempre por
// código, nunca por message. Lookup case-sensitive.
export const ERROR_CODE_IDS = {
  // Auth
  TENANT_AUTH_INVALID_CREDENTIALS: 1,
  TENANT_AUTH_ACCOUNT_NOT_ACTIVE: 2,
  TENANT_AUTH_REFRESH_TOKEN_MISSING: 3,
  TENANT_AUTH_REFRESH_TOKEN_NOT_FOUND: 4,
  TENANT_AUTH_REFRESH_TOKEN_EXPIRED: 5,
  TENANT_AUTH_REFRESH_TOKEN_REVOKED: 6,
  TENANT_AUTH_REFRESH_TOKEN_TENANT_MISMATCH: 7,
  TENANT_AUTH_REFRESH_TOKEN_INVALID: 8,
  PUBLIC_AUTH_SELECTION_TOKEN_INVALID: 9,

  // Exams alumno
  INVALID_ADMISSION_AREA: 20,
  STUDENT_NOT_ENROLLED: 21,
  STUDENT_MISMATCH: 22,
  SESSION_NOT_ACTIVE: 23,
  SESSION_NOT_FOUND: 24,
  STUDENT_BY_CODE_NOT_FOUND: 25,
  STUDENT_NOT_LINKED: 26,
  CLOCK_SKEW_BEFORE_START: 27,
  CLOCK_SKEW_TOO_FAR_FUTURE: 28,
  NOT_HOMEWORK_MODE: 29,
  HOMEWORK_WINDOW_CLOSED: 30,
  exam_not_open_yet: 31,

  // Genéricos comunes que suele emitir el server o infraestructura intermedia
  TOO_MANY_REQUESTS: 90,
  INTERNAL_SERVER_ERROR: 91,
  BAD_GATEWAY: 92,
  SERVICE_UNAVAILABLE: 93,
  GATEWAY_TIMEOUT: 94,
} as const;

// Lookup helper. Retorna el ID si el código está catalogado; 0 si no.
// El interceptor NO debe lanzar por códigos desconocidos — el "unknown"
// es señal útil en el log.
export function lookupErrorCode(code: string | null | undefined): number {
  if (!code) return 0;
  return (ERROR_CODE_IDS as Record<string, number>)[code] ?? 0;
}

export function lookupMethod(method: string): number {
  return (METHOD_IDS as Record<string, number>)[method.toUpperCase()] ?? 0;
}
