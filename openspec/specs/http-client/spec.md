# http-client Specification

## Purpose
Provides the HTTP plumbing that connects the Angular app to learnex: a single credentials interceptor (`withCredentials: true`), reactive refresh on 401 with `shareReplay(1)` locking, path builders parameterized by tenant slug, and a domain-error classifier driven by `(status, endpoint, code)` — never by humano `message` text — with one acotada excepción documentada para el endpoint POST submit.

## Requirements

### Requirement: `credentials.interceptor.ts` — `withCredentials: true` global

Todo request HTTP saliente cuya URL base coincida con `environment.apiBaseUrl` SHALL ser clonado con `{ withCredentials: true }` por `credentials.interceptor.ts`. Esto permite que el browser envíe automáticamente las cookies HttpOnly de learnex.

#### Scenario: Request a `apiBaseUrl` lleva `withCredentials: true`

- **WHEN** se ejecuta cualquier request HTTP cuya URL inicia con `environment.apiBaseUrl`
- **THEN** el request clonado tiene `withCredentials: true`

#### Scenario: Request a host externo no recibe `withCredentials`

- **WHEN** se ejecuta un request HTTP a una URL fuera de `environment.apiBaseUrl`
- **THEN** `withCredentials` no se altera en ese request

### Requirement: Refresh reactivo en 401 — lock `shareReplay(1)`

Cuando cualquier request protegido recibe HTTP 401, `credentials.interceptor.ts` SHALL:

1. Invocar `ensureRefreshed()` — una operación con lock `shareReplay(1)` que garantiza que como máximo 1 llamada a `POST /t/{slug}/auth/refresh` esté en vuelo simultáneamente.
2. Si el refresh es exitoso (nuevas cookies seteadas) → reintentar la request original UNA vez.
3. Si el refresh falla con `RefreshFailedError` → propagar `RefreshFailedError` sin reintentar.
4. El lock SHALL resetearse con `finalize` al completar el refresh (exitoso o fallido) para que el siguiente ciclo de 401 pueda disparar un nuevo refresh.

#### Scenario: Request a `/student/me` con 401 → refresh → retry exitoso

- **WHEN** `GET /t/{slug}/student/me` devuelve HTTP 401
- **THEN** el interceptor invoca `POST /t/{slug}/auth/refresh`
- **AND** si el refresh devuelve 200, reintenta `GET /t/{slug}/student/me`
- **AND** el caller recibe la respuesta del retry como si no hubiera habido 401

#### Scenario: Race — 3 requests paralelos con 401 → solo 1 refresh

- **WHEN** 3 requests distintos reciben HTTP 401 simultáneamente
- **THEN** solo 1 llamada a `POST /t/{slug}/auth/refresh` es ejecutada
- **AND** los 3 reintentos esperan al mismo refresh observable
- **AND** los 3 reintentan después de que el refresh completa

#### Scenario: Refresh con token inválido → `RefreshFailedError` propagado

- **WHEN** el refresh devuelve HTTP 401 con `code: TENANT_AUTH_REFRESH_TOKEN_INVALID`
- **THEN** el interceptor propaga `RefreshFailedError`
- **AND** la request original NO es reintentada

### Requirement: Skip refresh para URLs `/auth/`

Si la URL de la request original contiene `/auth/` (ej. `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me`), el interceptor SHALL NO intentar un refresh cuando recibe 401 en esa request — en su lugar propaga el error directamente.

#### Scenario: 401 en `/auth/refresh` — no se re-intenta refrescar

- **WHEN** `POST /t/{slug}/auth/refresh` devuelve HTTP 401
- **THEN** el interceptor NO invoca `/auth/refresh` de nuevo
- **AND** emite `RefreshFailedError`

#### Scenario: 401 en `/auth/login` — no se intenta refresh

- **WHEN** `POST /t/{slug}/auth/login` devuelve HTTP 401
- **THEN** el interceptor NO invoca `/auth/refresh`
- **AND** el error es clasificado como `InvalidCredentialsError` y propagado

### Requirement: Clasificación de errores HTTP por `(status, endpoint, code)` — prohibido leer `message`

El adapter SHALL clasificar errores HTTP usando exclusivamente `(status, endpoint, code)` donde `code` es el campo estructurado del response body (ej. `TENANT_AUTH_INVALID_CREDENTIALS`). El campo `message` del body es volátil, i18n del back, y SHALL ser ignorado para clasificación. Una excepción acotada y documentada aplica al endpoint `POST /student/exam-sessions/<id>/submit` (ver requirement "Excepción documentada a la regla 'nunca leer message'").

| Status | Endpoint | `code` en body | Error de dominio |
|---|---|---|---|
| 401 | `/auth/login` | `TENANT_AUTH_INVALID_CREDENTIALS` | `InvalidCredentialsError` |
| 401 | `/auth/refresh` | `TENANT_AUTH_REFRESH_TOKEN_INVALID` | `RefreshFailedError` |
| 401 | `/auth/refresh` | `TENANT_AUTH_REFRESH_TOKEN_MISSING` | `RefreshFailedError` |
| 401 | cualquier endpoint protegido (no `/auth/`) | cualquiera | manejo por interceptor (refresh + retry) |
| 429 | `/auth/login` | cualquiera | `RateLimitError` |
| 403 | `/{role}/me` | cualquiera | `ProfileNotAvailableError` |
| 404 | `/{role}/me` | cualquiera | `ProfileNotAvailableError` |
| 403 | otros endpoints | cualquiera | `ForbiddenError` |
| 404 | otros endpoints | cualquiera | `NotFoundError` |
| 5xx | cualquiera | — | `NetworkError` |
| error de transporte | — | — | `NetworkError` |

#### Scenario: 401 en login con `code: TENANT_AUTH_INVALID_CREDENTIALS` → `InvalidCredentialsError`

- **WHEN** `POST /t/{slug}/auth/login` devuelve HTTP 401 con body `{ code: "TENANT_AUTH_INVALID_CREDENTIALS" }`
- **THEN** `HttpAuthRepository.login()` rechaza con `InvalidCredentialsError`

#### Scenario: 429 en login → `RateLimitError`

- **WHEN** `POST /t/{slug}/auth/login` devuelve HTTP 429
- **THEN** `HttpAuthRepository.login()` rechaza con `RateLimitError`

#### Scenario: `message` del body NUNCA se lee para clasificación

- **WHEN** se inspecciona `HttpAuthRepository` y el interceptor
- **THEN** no aparecen comparaciones de `error.error?.message` ni de strings humanos en la lógica de clasificación
- **AND** la clasificación usa exclusivamente `status`, la URL/endpoint, y `error.error?.code`

#### Scenario: `code` extraído del body para distinguir errores 401

- **WHEN** `POST /t/{slug}/auth/refresh` devuelve HTTP 401 con body `{ code: "TENANT_AUTH_REFRESH_TOKEN_MISSING" }`
- **THEN** el error es clasificado como `RefreshFailedError`

### Requirement: Path builder — todas las URLs usan `environment.tenantSlug`

L3 SHALL construir todas las URLs a learnex como `/t/${environment.tenantSlug}/<recurso>`. Ningún literal `"vonex"` (ni ningún otro slug concreto) SHALL aparecer en código fuente bajo `src/`. El slug proviene de `environment.tenantSlug`, generado por `scripts/build-env.mjs` desde la env var `TENANT_SLUG`.

#### Scenario: Path builder usa `environment.tenantSlug`

- **WHEN** se inspecciona cualquier adapter de L3 que construye URLs a learnex
- **THEN** el path se forma con `environment.tenantSlug`, no con un literal como `"vonex"`

#### Scenario: Cambio de `TENANT_SLUG` en env var → todas las URLs lo reflejan

- **WHEN** `TENANT_SLUG=acme` está en `.env` y se invoca `npm run build-env`
- **THEN** `environment.tenantSlug === "acme"`
- **AND** todas las requests apuntan a `/t/acme/...`

#### Scenario: Prohibido el literal del slug en `src/`

- **WHEN** se ejecuta `grep -r "vonex" src/`
- **THEN** el comando devuelve cero matches

### Requirement: Bootstrap registra `credentialsInterceptor`

`HttpClient` SHALL configurarse en el bootstrap mediante `provideHttpClient(withInterceptors([credentialsInterceptor]))`. `authHeadersInterceptor` no SHALL aparecer en la configuración.

#### Scenario: Bootstrap registra el interceptor correcto

- **WHEN** se inspecciona la configuración de proveedores raíz (`app.config.ts`)
- **THEN** `credentialsInterceptor` está registrado vía `withInterceptors`
- **AND** `authHeadersInterceptor` NO está registrado

#### Scenario: Prohibido `fetch` directo en L3

- **WHEN** se inspecciona el código de `L3_periphery/`
- **THEN** no aparecen llamadas a `fetch(...)` ni a `new XMLHttpRequest()`

### Requirement: `HttpAuthRepository` implementa el puerto `AuthRepository` evolucionado

`HttpAuthRepository` en L3 SHALL implementar los métodos `login()`, `me()`, `refresh()`, `logout()`, `getProfile(role)` según el nuevo contrato. Todos mapean DTOs HTTP a value-objects de dominio y traducen errores HTTP a errores de dominio según la tabla de clasificación.

#### Scenario: `login()` traduce response exitosa a `Identity`

- **WHEN** `POST /t/{slug}/auth/login` responde HTTP 200 con body `{ user: { id, email, codigo, roles, permissions, tenantId }, expiresAt }`
- **THEN** `HttpAuthRepository.login()` devuelve `Identity` con todos los campos poblados

#### Scenario: `me()` traduce response a `Identity`

- **WHEN** `GET /t/{slug}/auth/me` responde HTTP 200 con el mismo shape que login
- **THEN** `HttpAuthRepository.me()` devuelve `Identity`

#### Scenario: `logout()` es best-effort — fallo no bloquea

- **WHEN** `POST /t/{slug}/auth/logout` falla con error de red
- **THEN** `HttpAuthRepository.logout()` resuelve sin propagar el error (o propaga `NetworkError` que el use case ignora)

### Requirement: apiPath.studentExamSubmit

El helper `apiPath` en L3 SHALL exponer el método `studentExamSubmit(sessionId: string): string` que construye la URL `<base>/student/exam-sessions/<encodedSessionId>/submit`. El `sessionId` SHALL aplicarse `encodeURIComponent` para defensa básica (aunque el contrato lo define como UUID v4, no se asume sanitización upstream).

#### Scenario: URL armada con tenantSlug y sessionId

- **GIVEN** `environment.tenantSlug = "vonex"`, `environment.apiBaseUrl = "http://api.yangpimpollo.com"`, y `sessionId = "7620c18d-5b4d-4ef0-bf41-98352d21c2cf"`
- **WHEN** se invoca `apiPath.studentExamSubmit(sessionId)`
- **THEN** retorna `"http://api.yangpimpollo.com/t/vonex/student/exam-sessions/7620c18d-5b4d-4ef0-bf41-98352d21c2cf/submit"`

#### Scenario: sessionId con caracteres especiales se encodea

- **GIVEN** `sessionId = "foo/bar"`
- **WHEN** se invoca `apiPath.studentExamSubmit(sessionId)`
- **THEN** el segmento de URL del sessionId es `"foo%2Fbar"`

### Requirement: Clasificación POST submit por (status, body.message)

El adapter `HttpExamsApi.enviar` SHALL clasificar errores HTTP del endpoint `POST /t/{slug}/student/exam-sessions/{sessionId}/submit` usando `(status, body.message)` según la tabla siguiente:

| Status | body.message | Error de dominio |
|---|---|---|
| 400 | `INVALID_ADMISSION_AREA` | `InvalidAdmissionAreaError` |
| 400 | otros / ausente | `InvalidPayloadError` |
| 401 | (cualquiera) | manejado por `credentials.interceptor` (refresh + retry) |
| 403 | `STUDENT_NOT_ENROLLED` | `StudentNotEnrolledError` |
| 403 | `STUDENT_MISMATCH` | `NetworkError` (genérico, sin clase dedicada) |
| 403 | otros / ausente | `NetworkError` |
| 404 | (cualquiera) | `SimulacroNoAsignadoError` |
| 409 | `SESSION_NOT_ACTIVE` | `SimulacroCerradoError` |
| 409 | otros / ausente | `NetworkError` |
| 422 | `CLOCK_SKEW_BEFORE_START` | `InvalidSubmissionTimeError` |
| 422 | `CLOCK_SKEW_TOO_FAR_FUTURE` | `InvalidSubmissionTimeError` |
| 422 | otros / ausente | `NetworkError` |
| 429 | (cualquiera) | `NetworkError` |
| 5xx | (cualquiera) | `NetworkError` |
| 0 / transporte | — | `NetworkError` |

#### Scenario: 400 INVALID_ADMISSION_AREA → InvalidAdmissionAreaError

- **WHEN** POST submit responde 400 con `body: { message: "INVALID_ADMISSION_AREA" }`
- **THEN** `enviar()` rechaza con `InvalidAdmissionAreaError`

#### Scenario: 400 con message fuera del enum → InvalidPayloadError

- **WHEN** POST submit responde 400 con `body: { message: "UNKNOWN" }` o sin body
- **THEN** `enviar()` rechaza con `InvalidPayloadError`

#### Scenario: 403 STUDENT_NOT_ENROLLED → StudentNotEnrolledError

- **WHEN** POST submit responde 403 con `body: { message: "STUDENT_NOT_ENROLLED" }`
- **THEN** `enviar()` rechaza con `StudentNotEnrolledError`

#### Scenario: 403 STUDENT_MISMATCH → NetworkError genérico

- **WHEN** POST submit responde 403 con `body: { message: "STUDENT_MISMATCH" }`
- **THEN** `enviar()` rechaza con `NetworkError`

#### Scenario: 409 SESSION_NOT_ACTIVE → SimulacroCerradoError

- **WHEN** POST submit responde 409 con `body: { message: "SESSION_NOT_ACTIVE" }`
- **THEN** `enviar()` rechaza con `SimulacroCerradoError`

#### Scenario: 422 CLOCK_SKEW_* → InvalidSubmissionTimeError

- **WHEN** POST submit responde 422 con `body.message` en `{"CLOCK_SKEW_BEFORE_START", "CLOCK_SKEW_TOO_FAR_FUTURE"}`
- **THEN** `enviar()` rechaza con `InvalidSubmissionTimeError`

#### Scenario: 422 con message fuera del enum → NetworkError

- **WHEN** POST submit responde 422 con `body: { message: "UNKNOWN_REASON" }`
- **THEN** `enviar()` rechaza con `NetworkError`
- **AND** el clasificador NO compara substring ni regex sobre `message` — solo igualdad estricta contra el enum documentado

### Requirement: Excepción documentada a la regla "nunca leer message"

La regla del proyecto "clasificar exclusivamente por `(status, endpoint, code)`" SHALL admitir una excepción acotada y enumerada para el endpoint `POST /student/exam-sessions/<id>/submit`: el adapter PUEDE leer `body.message` y compararlo por **igualdad estricta** contra el set cerrado `{"INVALID_ADMISSION_AREA", "STUDENT_NOT_ENROLLED", "STUDENT_MISMATCH", "SESSION_NOT_ACTIVE", "CLOCK_SKEW_BEFORE_START", "CLOCK_SKEW_TOO_FAR_FUTURE"}`. Cualquier otro valor de `message` SHALL ser ignorado y la clasificación SHALL caer al default por status.

Razón: el back de learnex emite estos valores como código de control en mayúsculas snake_case, no como i18n humano. Son contrato explícito acordado en el handoff. La regla original ("nunca leer message") busca proteger contra acoplamiento a texto i18n; los valores acá no son i18n. La excepción está acotada — un comentario inline en el adapter referencia este Requirement.

#### Scenario: Clasificador NO usa regex ni includes() sobre message

- **WHEN** se inspecciona el adapter `HttpExamsApi.enviar` classifySubmitError
- **THEN** todas las lecturas de `body.message` son comparaciones por `===` contra strings literales del enum
- **AND** NO aparecen `.includes()`, `.match()`, ni regex sobre `message`

#### Scenario: Lista de valores aceptados está documentada inline

- **WHEN** se lee el código fuente del classifier
- **THEN** existe un comentario que enumera los 5 valores del enum y referencia `design.md` D5

### Requirement: apiPath — 6 nuevos helpers para endpoints del tutor

`src/L3_periphery/http/api-paths.ts` (única fuente de verdad para URLs de learnex) SHALL exponer los siguientes 6 helpers para el flujo del tutor. Todos SHALL aplicar `encodeURIComponent` sobre los parámetros de path. Ningún adapter L3 SHALL construir estas URLs concatenando strings directamente.

```
tutorVirtualExams(): string
  → <base>/tutor/virtual-exams

virtualExam(recordId: string): string
  → <base>/virtual-exams/<encodedRecordId>

classroomStudents(classroomId: string, virtualExamDetailId: string): string
  → <base>/classrooms/<encodedClassroomId>/students?virtualExamDetailId=<encodedDetailId>

virtualExamEnabledStudents(recordId: string): string
  → <base>/virtual-exams/<encodedRecordId>/enabled-students

virtualExamStart(recordId: string): string
  → <base>/virtual-exams/<encodedRecordId>/start

virtualExamFinalize(recordId: string): string
  → <base>/virtual-exams/<encodedRecordId>/finalize
```

Los helpers SHALL agregarse al objeto `apiPath` existente — NO crear un objeto separado.

#### Scenario: tutorVirtualExams genera URL correcta

- **GIVEN** `environment.tenantSlug = "vonex"`, `environment.apiBaseUrl = "http://api.example.com"`
- **WHEN** se invoca `apiPath.tutorVirtualExams()`
- **THEN** retorna `"http://api.example.com/t/vonex/tutor/virtual-exams"`

#### Scenario: virtualExam usa encodeURIComponent sobre recordId

- **GIVEN** `recordId = "rec-123"`
- **WHEN** se invoca `apiPath.virtualExam("rec-123")`
- **THEN** retorna `"<base>/virtual-exams/rec-123"`

- **GIVEN** `recordId = "foo/bar"` (caracteres especiales)
- **WHEN** se invoca `apiPath.virtualExam("foo/bar")`
- **THEN** retorna `"<base>/virtual-exams/foo%2Fbar"`

#### Scenario: classroomStudents incluye classroomId en path y virtualExamDetailId en query

- **GIVEN** `classroomId = "cls-1"`, `virtualExamDetailId = "det-abc"`
- **WHEN** se invoca `apiPath.classroomStudents("cls-1", "det-abc")`
- **THEN** retorna `"<base>/classrooms/cls-1/students?virtualExamDetailId=det-abc"`

#### Scenario: classroomStudents aplica encodeURIComponent sobre ambos params

- **GIVEN** `classroomId = "cls/1"`, `virtualExamDetailId = "det abc"`
- **WHEN** se invoca `apiPath.classroomStudents("cls/1", "det abc")`
- **THEN** el classroomId en el path es `"cls%2F1"`
- **AND** el virtualExamDetailId en el query es `"det%20abc"`

#### Scenario: virtualExamEnabledStudents genera URL correcta

- **GIVEN** `recordId = "rec-1"`
- **WHEN** se invoca `apiPath.virtualExamEnabledStudents("rec-1")`
- **THEN** retorna `"<base>/virtual-exams/rec-1/enabled-students"`

#### Scenario: virtualExamStart genera URL correcta

- **GIVEN** `recordId = "rec-1"`
- **WHEN** se invoca `apiPath.virtualExamStart("rec-1")`
- **THEN** retorna `"<base>/virtual-exams/rec-1/start"`

#### Scenario: virtualExamFinalize genera URL correcta

- **GIVEN** `recordId = "rec-1"`
- **WHEN** se invoca `apiPath.virtualExamFinalize("rec-1")`
- **THEN** retorna `"<base>/virtual-exams/rec-1/finalize"`

#### Scenario: Los 6 helpers están en el objeto apiPath existente

- **WHEN** se inspecciona `api-paths.ts` después del change
- **THEN** `apiPath` es un único objeto que contiene tanto los helpers pre-existentes (`login`, `studentExamSubmit`, etc.) como los 6 nuevos helpers del tutor

#### Scenario: Prohibido el literal del slug en los nuevos helpers

- **WHEN** se inspecciona `api-paths.ts` tras el change
- **THEN** los 6 nuevos helpers usan `environment.tenantSlug` (vía `base()`), no un literal como `"vonex"`

---

### Requirement: Clasificación de errores del tutor — por status, sin leer message

La regla de clasificación de errores de `http-client` (exclusivamente por `status`, `endpoint`, y `code` estructurado) SHALL extenderse con la tabla específica para el adaptador `HttpTutorExamsApi`. Esta clasificación es por status PURO (sin leer `body.message` ni `body.code`), documentada como excepción al patrón del alumno por la ausencia de códigos de control granulares en el flujo tutor.

| HTTP Status | Error de dominio (tutor) |
|---|---|
| 400 | `InvalidPayloadError` |
| 401 | manejado por `credentials.interceptor` (refresh + retry) |
| 403 | `TutorExamForbiddenError` |
| 404 | `VirtualExamNotFoundError` |
| 409 | `ExamConflictError` |
| 422 | `ExamPreconditionError` |
| 0 / 429 / 5xx | `NetworkError` |
| timeout / transporte | `NetworkError` |

Un comentario inline en `HttpTutorExamsApi.classifyTutorError` SHALL documentar la razón de clasificación por status puro (el back tutor emite codes genéricos + messages en prosa variable, no contrato de control en snake_case).

#### Scenario: Tabla de clasificación por status — tutor

- **GIVEN** los errores HTTP listados en la tabla
- **WHEN** `HttpTutorExamsApi.classifyTutorError(err)` los procesa
- **THEN** cada status mapea al error de dominio indicado en la tabla

#### Scenario: Clasificador tutor NOT lee body.message

- **WHEN** se inspecciona `classifyTutorError`
- **THEN** no aparecen comparaciones de `body.message` ni de strings en prosa del backend
- **AND** la clasificación usa exclusivamente `err.status`

#### Scenario: Clasificadores del alumno y del tutor son independientes

- **WHEN** se modifica el clasificador del tutor (`classifyTutorError`)
- **THEN** `classifySubmitError` y `classifyDraftError` (alumno) permanecen sin cambios
- **AND** viceversa
