# Delta for exam-submission

## MODIFIED Requirements

### Requirement: ExamsApi.enviar contrato real

El puerto `ExamsApi.enviar(req: EnvioRequest): Promise<EnvioResult>` SHALL recibir `EnvioRequest = { examId: string; code: string; admissionArea: AdmissionArea; responses: Record<string, 'A'|'B'|'C'|'D'|'E'>; clientFinishedAt: string }` y SHALL retornar `EnvioResult = { ack: SubmissionAck }`. El stub `SubmissionNotAvailableError` SHALL NOT existir.

El nuevo campo `admissionArea` es obligatorio (no opcional, no nullable). El use case es responsable de resolverlo (con default `GENERAL` si no hay valor persistido). El tipo `AdmissionArea` está definido en la capability `admission-area`.

#### Scenario: Envío exitoso retorna ack

- **WHEN** el adapter recibe HTTP 201 con body `{ id, submission_hash, submitted_at }`
- **THEN** `enviar()` resuelve con `{ ack: SubmissionAck }` con esos campos parseados

#### Scenario: EnvioRequest incluye admissionArea

- **WHEN** se inspecciona el tipo `EnvioRequest`
- **THEN** el campo `admissionArea: AdmissionArea` está presente y es requerido (no opcional)

### Requirement: POST envío real con contrato learnex

El método `ExamsApi.enviar` en el adapter `HttpExamsApi` SHALL emitir HTTP POST a `apiPath.studentExamSubmit(req.examId)` con `withCredentials: true` (heredado del interceptor) y body `{ code, admission_area, responses, client_finished_at }` (snake_case) **en ese orden**. Al recibir 201 SHALL mapear `{ id, submission_hash, submitted_at }` a `SubmissionAck` y retornar `{ ack }`.

#### Scenario: URL armada con apiPath.studentExamSubmit y examId

- **GIVEN** `EnvioRequest = { examId: "7620c18d-..." }`
- **WHEN** `enviar()` emite el POST
- **THEN** la URL es `/t/<slug>/student/exam-sessions/7620c18d-.../submit`

#### Scenario: Body exact match al contrato con admission_area

- **GIVEN** `EnvioRequest = { examId, code: "30303011", admissionArea: "A", responses: {"P1": "A"}, clientFinishedAt: "2026-06-17T15:29:54.531Z" }`
- **WHEN** `enviar()` emite el POST
- **THEN** el body es `{ "code": "30303011", "admission_area": "A", "responses": {"P1": "A"}, "client_finished_at": "2026-06-17T15:29:54.531Z" }`
- **AND** el orden de las keys en el JSON serializado es `code`, `admission_area`, `responses`, `client_finished_at`

## ADDED Requirements

### Requirement: `EnviarSimulacroUseCase` resuelve `admissionArea` con default `GENERAL`

El use case `EnviarSimulacroUseCase` SHALL leer `admissionArea` vía `MarkingsStorage.getAdmissionArea(examId)` antes de construir el `EnvioRequest`. Si el storage retorna `null` (el alumno nunca la eligió expresamente), el use case SHALL usar `DEFAULT_ADMISSION_AREA` (`'GENERAL'`) sin persistirlo. El valor resuelto SHALL propagarse al port como `EnvioRequest.admissionArea`.

#### Scenario: admissionArea persistida se propaga al port

- **GIVEN** `MarkingsStorage.getAdmissionArea("X")` retorna `"MAT"`
- **WHEN** se invoca `EnviarSimulacroUseCase.execute({ examId: "X" })`
- **THEN** el adapter recibe `EnvioRequest` con `admissionArea: "MAT"`

#### Scenario: admissionArea ausente cae al default GENERAL

- **GIVEN** `MarkingsStorage.getAdmissionArea("X")` retorna `null`
- **WHEN** se invoca `EnviarSimulacroUseCase.execute({ examId: "X" })`
- **THEN** el adapter recibe `EnvioRequest` con `admissionArea: "GENERAL"`
- **AND** `MarkingsStorage.setAdmissionArea` NUNCA es invocado por el use case
