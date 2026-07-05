# Delta for submit-progress-snapshot

## MODIFIED Requirements

### Requirement: Contrato HTTP del endpoint `/draft`

El adapter L3 `HttpExamsApi.guardarDraft` SHALL emitir HTTP POST a `apiPath.studentExamDraft(sessionId)` con body JSON `{ "code": <string>, "admission_area": <AdmissionArea>, "responses": <string> }` (snake_case) **en ese orden**. El campo `responses` SHALL ser un string de longitud `exam.count` donde cada char (0-indexed) representa la pregunta `P(i+1)`: `A | B | C | D | E` para respuesta marcada, `-` para sin marcar. El campo `admission_area` SHALL ser uno de los 16 valores del enum `AdmissionArea`. El body NO SHALL incluir `client_finished_at` (exclusivo del `/submit`). El header `withCredentials: true` SHALL ser aplicado por el `credentials.interceptor` global; el adapter NO SHALL setearlo manualmente. La response esperada es HTTP 204 No Content, sin body. El método SHALL resolver con `void` en 204.

#### Scenario: URL armada con apiPath.studentExamDraft

- **GIVEN** `DraftRequest = { examId: "7620c18d-...", code, admissionArea, responses }`
- **WHEN** `guardarDraft()` emite el POST
- **THEN** la URL es `/t/<slug>/student/exam-sessions/7620c18d-.../draft`

#### Scenario: Body exact match al contrato con admission_area

- **GIVEN** `DraftRequest = { examId, code: "30303011", admissionArea: "A", responses: "A-C-" }`
- **WHEN** `guardarDraft()` emite el POST
- **THEN** el body es exactamente `{ "code": "30303011", "admission_area": "A", "responses": "A-C-" }`
- **AND** el orden de las keys en el JSON serializado es `code`, `admission_area`, `responses`
- **AND** la key `client_finished_at` NO está presente
- **AND** `responses` es un string (no un object)

#### Scenario: 204 No Content resuelve void

- **WHEN** el back responde HTTP 204 sin body
- **THEN** `guardarDraft()` resuelve con `undefined`

#### Scenario: Adapter NO setea withCredentials manual

- **WHEN** se inspecciona `HttpExamsApi.guardarDraft`
- **THEN** la llamada `http.post(...)` NO pasa `{ withCredentials: true }` como opción
- **AND** la inclusión de cookies HttpOnly se delega al `credentials.interceptor`

### Requirement: ExamsApi.guardarDraft en L1

El puerto `ExamsApi` (L1) SHALL exponer el método `guardarDraft(req: DraftRequest): Promise<void>` donde `DraftRequest = { examId: string; code: string; admissionArea: AdmissionArea; responses: string }`. El campo `responses` SHALL ser un string compacto de longitud `exam.count` (ver D12 del design original). El campo `admissionArea` es requerido (no opcional, no nullable) y su tipo está definido en la capability `admission-area`. El tipo `DraftRequest` SHALL NO incluir `clientFinishedAt`. El bloque de comentarios del port SHALL documentar el formato del string, el mapeo de errores HTTP del endpoint, y la distinción entre `admissionArea` (área de postulación) y `Exam.area` (área del curso).

#### Scenario: Port expone guardarDraft con responses como string y admissionArea

- **WHEN** se inspecciona la interfaz `ExamsApi`
- **THEN** existe el método `guardarDraft(req: DraftRequest): Promise<void>`
- **AND** el tipo `DraftRequest` tiene exactamente los campos `{ examId, code, admissionArea, responses }`
- **AND** el tipo de `responses` es `string` (no `Record<string, ...>`)
- **AND** el tipo de `admissionArea` es `AdmissionArea`

### Requirement: Clasificación de errores POST draft por (status, body.message)

El adapter `HttpExamsApi.guardarDraft` SHALL clasificar errores HTTP del endpoint `POST /t/{slug}/student/exam-sessions/{sessionId}/draft` usando `(status, body.message)` según la tabla siguiente:

| Status | body.message | Error de dominio |
|---|---|---|
| 400 | `INVALID_ADMISSION_AREA` | `InvalidAdmissionAreaError` |
| 400 | otros / ausente | `InvalidPayloadError` |
| 401 | (cualquiera) | manejado por `credentials.interceptor` (refresh + retry) |
| 403 | `STUDENT_NOT_ENROLLED` | `StudentNotEnrolledError` |
| 403 | `STUDENT_MISMATCH` u otro | `NetworkError` (genérico, sin clase dedicada) |
| 404 | `SESSION_NOT_FOUND` | `SimulacroNoAsignadoError` |
| 404 | `STUDENT_BY_CODE_NOT_FOUND` | `StudentNotLinkedError` |
| 404 | sin message conocido | `NetworkError` (retryable con backoff a nivel dispatcher; ver requirement "Backoff exponencial on retryable failures") |
| 409 | `SESSION_NOT_ACTIVE` | `SimulacroCerradoError` |
| 409 | otros / ausente | `NetworkError` |
| 429 | (cualquiera) | `NetworkError` |
| 5xx | (cualquiera) | `NetworkError` |
| 0 / timeout / transporte | — | `NetworkError` |

El clasificador SHALL leer `body.message` SOLO con igualdad estricta contra el set cerrado `DRAFT_ERROR_MESSAGES = { "STUDENT_NOT_ENROLLED", "STUDENT_MISMATCH", "SESSION_NOT_FOUND", "STUDENT_BY_CODE_NOT_FOUND", "SESSION_NOT_ACTIVE", "INVALID_ADMISSION_AREA" }`. Cualquier otro valor SHALL caer al default por status. El adapter NO SHALL usar `.includes()`, `.match()`, ni regex sobre `message`. Un comentario inline en el adapter SHALL referenciar la excepción documentada a la regla "nunca leer message".

#### Scenario: 400 INVALID_ADMISSION_AREA → InvalidAdmissionAreaError

- **WHEN** POST draft responde 400 con `body: { message: "INVALID_ADMISSION_AREA" }`
- **THEN** `guardarDraft()` rechaza con `InvalidAdmissionAreaError`

#### Scenario: 400 con message fuera del enum → InvalidPayloadError

- **WHEN** POST draft responde 400 con `body: { message: "UNKNOWN" }` o sin body
- **THEN** `guardarDraft()` rechaza con `InvalidPayloadError`

#### Scenario: 403 STUDENT_NOT_ENROLLED → StudentNotEnrolledError

- **WHEN** POST draft responde 403 con `body: { message: "STUDENT_NOT_ENROLLED" }`
- **THEN** `guardarDraft()` rechaza con `StudentNotEnrolledError`

#### Scenario: 403 STUDENT_MISMATCH → NetworkError genérico

- **WHEN** POST draft responde 403 con `body: { message: "STUDENT_MISMATCH" }`
- **THEN** `guardarDraft()` rechaza con `NetworkError`

#### Scenario: 403 con message fuera del enum → NetworkError

- **WHEN** POST draft responde 403 con `body: { message: "UNKNOWN" }` o sin body
- **THEN** `guardarDraft()` rechaza con `NetworkError`

## ADDED Requirements

### Requirement: `GuardarDraftUseCase` resuelve `admissionArea` con default `GENERAL`

El use case `GuardarDraftUseCase` SHALL leer `admissionArea` vía `MarkingsStorage.getAdmissionArea(examId)` antes de construir el `DraftRequest`. Si el storage retorna `null`, el use case SHALL usar `DEFAULT_ADMISSION_AREA` (`'GENERAL'`) sin persistirlo. El valor resuelto SHALL propagarse al port como `DraftRequest.admissionArea`.

#### Scenario: admissionArea persistida se propaga al port

- **GIVEN** `MarkingsStorage.getAdmissionArea("X")` retorna `"MAT"`
- **WHEN** se invoca `GuardarDraftUseCase.execute({ examId: "X", count: 4 })`
- **THEN** el adapter recibe `DraftRequest` con `admissionArea: "MAT"`

#### Scenario: admissionArea ausente cae al default GENERAL

- **GIVEN** `MarkingsStorage.getAdmissionArea("X")` retorna `null`
- **WHEN** se invoca `GuardarDraftUseCase.execute({ examId: "X", count: 4 })`
- **THEN** el adapter recibe `DraftRequest` con `admissionArea: "GENERAL"`
- **AND** `MarkingsStorage.setAdmissionArea` NUNCA es invocado por el use case
