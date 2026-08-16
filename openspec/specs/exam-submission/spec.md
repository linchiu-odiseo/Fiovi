# exam-submission Specification

## Purpose
Handles exam submission to backend with timestamp validation, offline queuing, auto-submission at deadline, and retry on reconnection.

## Requirements

### Requirement: Envío del simulacro con `clientFinishedAt`

El sistema SHALL exponer `EnviarSimulacroUseCase` (L2) que toma `{examId}`, lee identity desde `IdentityStorage` para resolver `code`, lee marcaciones de `MarkingsStorage`, computa el `clientFinishedAt` con el `Clock` server-anchored, reshape `AnswersMap` a `responses` con prefijo `P` y filtro de null, y delega el POST al puerto `ExamsApi.enviar`. Sobre éxito, persiste el ack en `MarkingsStorage` y borra marcaciones. Sobre `NetworkError`, encola el payload completo. Sobre otros errores de dominio, propaga sin tocar storage.

#### Scenario: clientFinishedAt usa Clock server-anchored

- **GIVEN** el `Clock` retorna `new Date("2026-06-17T15:29:54.531Z")` y no se pasa `clientSubmittedAtOverride`
- **WHEN** se invoca `EnviarSimulacroUseCase.execute({ examId })`
- **THEN** el `EnvioRequest` enviado al adapter tiene `clientFinishedAt: "2026-06-17T15:29:54.531Z"`

#### Scenario: clientSubmittedAtOverride respeta el timestamp recibido

- **GIVEN** el caller pasa `clientSubmittedAtOverride: new Date("2026-06-17T11:00:00.000Z")` (ej. ProgramarAutoEnvioUseCase fuerza el cierre exacto)
- **WHEN** se invoca `execute({ examId, clientSubmittedAtOverride })`
- **THEN** el `EnvioRequest` tiene `clientFinishedAt: "2026-06-17T11:00:00.000Z"`

### Requirement: Envío offline en cola con retry automático

Cuando el POST falla por error de red, el sistema SHALL persistir el envío como pendiente en `MarkingsStorage` (cola) y reintentarlo automáticamente cuando `Connectivity.isOnline` pase a `true`. El `clientFinishedAt` original se preserva entre el momento del intento y el envío exitoso.

#### Scenario: NetworkError encola y reintenta al volver la red

- **GIVEN** el adapter `ExamsApi.enviar` rechaza con `NetworkError`
- **WHEN** el use case procesa el error
- **THEN** el envío queda persistido en la cola con su `clientFinishedAt` intacto
- **AND** `Connectivity.isOnline` pasando a `true` dispara `RetomarEnviosPendientesUseCase`

### Requirement: Auto-envío silencioso a T=0 con jitter

El sistema SHALL programar un auto-envío que se dispara exactamente cuando `serverTime` llega al cierre del examen, con `clientFinishedAt` = momento de cierre. Para mitigar thundering herd, el timer aplica un jitter aleatorio uniforme en `[-3s, +3s]`. El auto-envío usa el mismo camino que `EnviarSimulacroUseCase`, así que respeta la cola offline.

#### Scenario: Auto-envío usa EnviarSimulacroUseCase

- **WHEN** `serverTime` llega al cierre del examen
- **THEN** el timer programado invoca `EnviarSimulacroUseCase.execute({ examId, clientSubmittedAtOverride: closeAt })`
- **AND** la lógica de retry, persistencia y queue funciona idéntica al envío manual

### Requirement: El `clientFinishedAt` se computa con el `Clock` server-anchored

El cálculo de `clientFinishedAt` SHALL usar el puerto `Clock` (L1) que aplica el offset capturado en el último GET. NUNCA se usa `Date.now()` directo.

#### Scenario: Clock con offset aplica el offset al timestamp

- **GIVEN** el `Clock` server-anchored expone un offset capturado del último GET
- **WHEN** se invoca `EnviarSimulacroUseCase.execute({ examId })`
- **THEN** `clientFinishedAt` resulta de `Clock.now()` (con offset aplicado), no de `Date.now()` directo

### Requirement: Errores de dominio para envío

La capa L1 SHALL definir los errores `InvalidSubmissionTimeError`, `SimulacroCerradoError`, `SimulacroNoAsignadoError`, `InvalidPayloadError`, `StudentNotEnrolledError`. La clasificación por `(status, endpoint, body.message)` aplica al contrato POST según la tabla del adapter `HttpExamsApi.enviar`.

#### Scenario: Mapeo de 400 → InvalidPayloadError

- **WHEN** el backend responde 400 al POST submit
- **THEN** el adapter HTTP lanza `InvalidPayloadError`

#### Scenario: Mapeo de 409 SESSION_NOT_ACTIVE → SimulacroCerradoError

- **WHEN** el backend responde 409 con `body: { message: "SESSION_NOT_ACTIVE" }`
- **THEN** el adapter HTTP lanza `SimulacroCerradoError`

#### Scenario: Mapeo de 404 → SimulacroNoAsignadoError

- **WHEN** el backend responde 404 al POST submit
- **THEN** el adapter HTTP lanza `SimulacroNoAsignadoError`

#### Scenario: Clasificación por (status, endpoint, body.message) — nunca por texto humano

- **WHEN** el backend responde con cualquier status
- **THEN** el adapter clasifica solo por `status`, endpoint, y `body.message` (igualdad estricta contra enum cerrado), nunca por texto humano

### Requirement: SubmissionAck VO en L1

La capa L1 SHALL exponer el value-object `SubmissionAck` con campos readonly `id: string`, `submissionHash: string` (64 chars hex), `submittedAt: Date`. El constructor valida: `id` no vacío; `submissionHash` matchea `/^[0-9a-f]{64}$/`; `submittedAt` es `Date` válido. Sirve como comprobante criptográfico devuelto por el server tras un envío exitoso.

#### Scenario: SubmissionAck válido

- **GIVEN** parámetros `id="7620c18d-...", submissionHash="a3f5...a1b2" (64 hex), submittedAt=Date válido`
- **WHEN** se construye `new SubmissionAck(...)`
- **THEN** la instancia expone los campos sin transformación

#### Scenario: SubmissionAck rechaza hash inválido

- **WHEN** se construye con `submissionHash="abc"` (no es 64 hex chars)
- **THEN** lanza Error con mensaje descriptivo

### Requirement: ExamsApi.enviar contrato real

El puerto `ExamsApi.enviar(req: EnvioRequest): Promise<EnvioResult>` SHALL recibir `EnvioRequest = { examId: string; code: string; admissionArea: AdmissionArea; responses: Record<string, 'A'|'B'|'C'|'D'|'E'>; clientFinishedAt: string }` y SHALL retornar `EnvioResult = { ack: SubmissionAck }`. El stub `SubmissionNotAvailableError` SHALL NOT existir.

El nuevo campo `admissionArea` es obligatorio (no opcional, no nullable). El use case es responsable de resolverlo (con default `GENERAL` si no hay valor persistido). El tipo `AdmissionArea` está definido en la capability `admission-area`.

#### Scenario: Envío exitoso retorna ack

- **WHEN** el adapter recibe HTTP 201 con body `{ id, submission_hash, submitted_at }`
- **THEN** `enviar()` resuelve con `{ ack: SubmissionAck }` con esos campos parseados

#### Scenario: EnvioRequest incluye admissionArea

- **WHEN** se inspecciona el tipo `EnvioRequest`
- **THEN** el campo `admissionArea: AdmissionArea` está presente y es requerido (no opcional)

### Requirement: EnviarSimulacroUseCase inyecta IdentityStorage

El use case `EnviarSimulacroUseCase` SHALL inyectar `IdentityStorage` como cuarto puerto. En `execute()` SHALL leer la identidad antes del POST y extraer `codigo` para construir `EnvioRequest.code`. Si `IdentityStorage.get()` retorna `null` o `identity.codigo` es `null`, SHALL lanzar `SessionExpiredError` sin tocar el adapter.

#### Scenario: Use case resuelve DNI internamente

- **GIVEN** IdentityStorage retorna `Identity` con `codigo="30303011"`
- **WHEN** se invoca `EnviarSimulacroUseCase.execute({ examId })`
- **THEN** el adapter recibe `EnvioRequest` con `code: "30303011"`

#### Scenario: Sesión expirada durante envío

- **GIVEN** `IdentityStorage.get()` resuelve a `null`
- **WHEN** se invoca `execute()`
- **THEN** lanza `SessionExpiredError`
- **AND** `ExamsApi.enviar` NUNCA es invocado

### Requirement: Reshape de responses con prefijo P y filtro de null

El use case `EnviarSimulacroUseCase` SHALL transformar el `AnswersMap` interno (`{ "1": "C", "2": null, "3": "A" }`) en `responses` con keys con prefijo `"P"` y SHALL omitir las preguntas con valor `null`. Esto cumple el contrato learnex donde solo se envían las respuestas marcadas.

#### Scenario: AnswersMap con nulls produce responses filtrado

- **GIVEN** `AnswersMap = { "1": "A", "2": null, "5": "D" }`
- **WHEN** el use case construye el body para el adapter
- **THEN** `responses = { "P1": "A", "P5": "D" }`
- **AND** la key `"P2"` NO está presente

#### Scenario: AnswersMap vacío produce responses vacío

- **GIVEN** `AnswersMap = { "1": null, "2": null, "3": null }`
- **WHEN** el use case construye el body
- **THEN** `responses = {}` (entrega en blanco válida según contrato)

### Requirement: Envío exitoso persiste ack y limpia marcaciones

Cuando `ExamsApi.enviar` resuelve con `{ ack }`, el use case `EnviarSimulacroUseCase` SHALL:
1. Persistir el ack via `MarkingsStorage.setSubmissionAck(examId, ack)`.
2. Borrar las marcaciones locales via `MarkingsStorage.clearMarcaciones(examId)`.
3. Retornar `{ status: 'enviado', ack }`.

#### Scenario: Persistencia y limpieza tras 201

- **GIVEN** `api.enviar` retorna `{ ack: validAck }`
- **WHEN** el use case procesa el éxito
- **THEN** `storage.setSubmissionAck(examId, validAck)` es invocado UNA vez
- **AND** `storage.clearMarcaciones(examId)` es invocado UNA vez
- **AND** el output del use case es `{ status: 'enviado', ack: validAck }`

### Requirement: NetworkError encola payload completo

Cuando `ExamsApi.enviar` rechaza con `NetworkError`, el use case `EnviarSimulacroUseCase` SHALL encolar el envío en `MarkingsStorage.enqueueEnvio` con el `code`, `responses`, `clientFinishedAt` y `examId` originales. SHALL retornar `{ status: 'queued', ack: null }`. SHALL NO persistir ack.

#### Scenario: NetworkError → queued con payload completo

- **GIVEN** `api.enviar` rechaza con `new NetworkError()`
- **WHEN** el use case procesa el error
- **THEN** `storage.enqueueEnvio` recibe `{ examId, code, responses, clientFinishedAt }`
- **AND** el output es `{ status: 'queued', ack: null }`
- **AND** `setSubmissionAck` NO es invocado

### Requirement: Queue retry persiste ack

El use case `RetomarEnviosPendientesUseCase` SHALL, tras un éxito 201 del retry, persistir el ack via `MarkingsStorage.setSubmissionAck` ANTES de hacer `dequeueEnvio` + `clearMarcaciones`. Esto garantiza que el comprobante esté disponible cuando el alumno reabra la app.

#### Scenario: Queue replay exitoso persiste ack y dequeue

- **GIVEN** hay 1 envío en la cola y `api.enviar` retorna `{ ack }`
- **WHEN** `RetomarEnviosPendientesUseCase.execute()` procesa la cola
- **THEN** `storage.setSubmissionAck` es invocado con el `examId` y el `ack`
- **AND** `storage.dequeueEnvio(examId)` es invocado después
- **AND** `storage.clearMarcaciones(examId)` es invocado

### Requirement: Mapeo de 403 STUDENT_NOT_ENROLLED → StudentNotEnrolledError

El adapter `HttpExamsApi.enviar` SHALL clasificar HTTP 403 con `body.message === "STUDENT_NOT_ENROLLED"` como `StudentNotEnrolledError`. El view-model trata este error mostrando copy "No estás inscripto en este examen" y redirige a `/home`.

#### Scenario: 403 STUDENT_NOT_ENROLLED

- **WHEN** el back responde 403 con `body: { message: "STUDENT_NOT_ENROLLED" }`
- **THEN** `enviar()` rechaza con `StudentNotEnrolledError`

#### Scenario: 403 STUDENT_MISMATCH cae a NetworkError genérico

- **WHEN** el back responde 403 con `body: { message: "STUDENT_MISMATCH" }`
- **THEN** `enviar()` rechaza con `NetworkError` (sin clase dedicada)
- **AND** el view-model lo trata como error desconocido y redirige a `/home`

#### Scenario: 409 SESSION_NOT_ACTIVE reusa SimulacroCerradoError

- **WHEN** el back responde 409 con `body: { message: "SESSION_NOT_ACTIVE" }`
- **THEN** `enviar()` rechaza con `SimulacroCerradoError`

#### Scenario: 422 CLOCK_SKEW_BEFORE_START reusa InvalidSubmissionTimeError

- **WHEN** el back responde 422 con `body: { message: "CLOCK_SKEW_BEFORE_START" }`
- **THEN** `enviar()` rechaza con `InvalidSubmissionTimeError`

#### Scenario: 422 CLOCK_SKEW_TOO_FAR_FUTURE reusa InvalidSubmissionTimeError

- **WHEN** el back responde 422 con `body: { message: "CLOCK_SKEW_TOO_FAR_FUTURE" }`
- **THEN** `enviar()` rechaza con `InvalidSubmissionTimeError`

#### Scenario: 400 cualquier message → InvalidPayloadError

- **WHEN** el back responde 400
- **THEN** `enviar()` rechaza con `InvalidPayloadError` (sin leer message)

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

#### Scenario: 404 → SimulacroNoAsignadoError

- **WHEN** el back responde 404
- **THEN** `enviar()` rechaza con `SimulacroNoAsignadoError`

#### Scenario: 429 → NetworkError

- **WHEN** el back responde 429
- **THEN** `enviar()` rechaza con `NetworkError`

#### Scenario: 5xx → NetworkError

- **WHEN** el back responde 500
- **THEN** `enviar()` rechaza con `NetworkError`

### Requirement: Cleanup de SubmissionNotAvailableError

La clase `SubmissionNotAvailableError` SHALL ser eliminada de L1 (archivo borrado). Toda referencia en L2 (`EnviarSimulacroUseCase.execute` catch branch), LR (view-model `handleSubmissionError`, imports) SHALL eliminarse. `grep -r "SubmissionNotAvailableError" src/` SHALL devolver cero matches.

#### Scenario: Grep limpio

- **WHEN** se ejecuta `grep -r "SubmissionNotAvailableError" src/`
- **THEN** el comando retorna 0 matches

### Requirement: POST envío real con contrato learnex

El método `ExamsApi.enviar` en el adapter `HttpExamsApi` SHALL emitir HTTP POST a `apiPath.studentExamSubmit(req.examId)` con `withCredentials: true` (heredado del interceptor) y body `{ code, responses, client_finished_at }` (snake_case). Al recibir 201 SHALL mapear `{ id, submission_hash, submitted_at }` a `SubmissionAck` y retornar `{ ack }`.

#### Scenario: URL armada con apiPath.studentExamSubmit y examId

- **GIVEN** `EnvioRequest = { examId: "7620c18d-..." }`
- **WHEN** `enviar()` emite el POST
- **THEN** la URL es `/t/<slug>/student/exam-sessions/7620c18d-.../submit`

#### Scenario: Body exact match al contrato

- **GIVEN** `EnvioRequest = { examId, code: "30303011", responses: {"P1": "A"}, clientFinishedAt: "2026-06-17T15:29:54.531Z" }`
- **WHEN** `enviar()` emite el POST
- **THEN** el body es `{ "code": "30303011", "responses": {"P1": "A"}, "client_finished_at": "2026-06-17T15:29:54.531Z" }`

### Requirement: REQ-PA-03-L1 — ExamNotOpenYetError con startedAt

L1 SHALL define `ExamNotOpenYetError` as a domain error class (TypeScript only, no `@angular/*`)
with a required field `startedAt: Date`. The class MUST extend the project's base domain error
convention. No other layers may construct this error — it is instantiated exclusively in the L3
adapter before crossing the boundary into L1.

#### Scenario: ExamNotOpenYetError instanciado con startedAt

- GIVEN `body = { code: 'exam_not_open_yet', startedAt: '2026-08-20T08:00:00.000Z' }`
- WHEN el adapter construye `new ExamNotOpenYetError({ startedAt: new Date(body.startedAt) })`
- THEN `error.startedAt` es un `Date` con valor `2026-08-20T08:00:00.000Z`

### Requirement: REQ-PA-03-SUBMIT — Clasificación 422 exam_not_open_yet en submit

`HttpExamsApi.classifySubmitError` SHALL handle the case where `status === 422` AND
`body.code === 'exam_not_open_yet'`. In this case it SHALL return
`new ExamNotOpenYetError({ startedAt: new Date(body.startedAt) })`.

Classification MUST use `body.code` (strict equality) — NEVER `body.message` or any string
pattern match. This follows CLAUDE.md rule #3: classify by `(status, endpoint, code)`.

If `body.startedAt` is absent or unparseable, the adapter SHALL still construct
`ExamNotOpenYetError` with `startedAt: undefined` cast to `Date` (i.e., `new Date(undefined)` →
Invalid Date). The VM handles the fallback display (see REQ-PA-03-VM).

Any other 422 with a different `body.code` SHALL fall through to the existing classification
logic (e.g., `InvalidSubmissionTimeError`).

#### Scenario: POST submit 422 code=exam_not_open_yet → ExamNotOpenYetError con startedAt

- GIVEN el backend responde HTTP 422 con `body = { code: 'exam_not_open_yet', startedAt: '2026-08-20T08:00:00.000Z' }`
- WHEN `classifySubmitError` procesa la respuesta
- THEN retorna `ExamNotOpenYetError` con `startedAt = new Date('2026-08-20T08:00:00.000Z')`

#### Scenario: POST submit 422 body sin startedAt → ExamNotOpenYetError con Date inválido

- GIVEN el backend responde HTTP 422 con `body = { code: 'exam_not_open_yet' }` (sin `startedAt`)
- WHEN `classifySubmitError` procesa la respuesta
- THEN retorna `ExamNotOpenYetError` con `startedAt` siendo un `Invalid Date`

#### Scenario: POST submit 422 con code diferente → NO clasifica como ExamNotOpenYetError

- GIVEN el backend responde HTTP 422 con `body = { message: 'CLOCK_SKEW_BEFORE_START' }` (sin `code`)
- WHEN `classifySubmitError` procesa la respuesta
- THEN NO retorna `ExamNotOpenYetError`
- AND aplica la clasificación existente (`InvalidSubmissionTimeError`)

### Requirement: REQ-PA-03-DRAFT — Clasificación 422 exam_not_open_yet en draft

`HttpExamsApi.classifyDraftError` SHALL apply the identical classification rule as
REQ-PA-03-SUBMIT: HTTP 422 with `body.code === 'exam_not_open_yet'` returns
`new ExamNotOpenYetError({ startedAt: new Date(body.startedAt) })`.

All other draft error classification rules from `submit-progress-snapshot` spec remain unchanged.

#### Scenario: POST draft 422 code=exam_not_open_yet → ExamNotOpenYetError

- GIVEN el backend responde HTTP 422 con `body = { code: 'exam_not_open_yet', startedAt: '2026-08-20T08:00:00.000Z' }`
- WHEN `classifyDraftError` procesa la respuesta
- THEN retorna `ExamNotOpenYetError` con `startedAt` parseado como `Date`

#### Scenario: POST draft 422 code=exam_not_open_yet sin startedAt → fallback

- GIVEN el backend responde HTTP 422 con `body = { code: 'exam_not_open_yet' }` (sin `startedAt`)
- WHEN `classifyDraftError` procesa la respuesta
- THEN retorna `ExamNotOpenYetError` con `startedAt` siendo un `Invalid Date`

### Requirement: REQ-PA-03-VM — SimulacroPageViewModel maneja ExamNotOpenYetError

`SimulacroPageViewModel` SHALL catch `ExamNotOpenYetError` in both the submit handler and the
draft-error path. On catching it, the VM SHALL display a toast (or inline error message) in
Spanish:

- When `error.startedAt` is a valid `Date`: toast text is
  `"Este examen abre el {fecha formateada es-PE corta}"` using
  `Intl.DateTimeFormat('es-PE', { dateStyle: 'short', timeStyle: 'short' })` or equivalent.
- When `error.startedAt` is `undefined`, `null`, or an `Invalid Date`: fallback toast text is
  `"Este examen aún no abre"` (no date appended).

The VM MUST NOT inspect `error.message` to decide the toast text. It MUST check `error.startedAt`
directly (type-guard or validity check via `isNaN(error.startedAt.getTime())`).

#### Scenario: VM captura ExamNotOpenYetError con startedAt → toast con fecha

- GIVEN `EnviarSimulacroUseCase.execute` rechaza con `ExamNotOpenYetError({ startedAt: new Date('2026-08-20T08:00:00.000Z') })`
- WHEN el VM procesa el error
- THEN muestra toast con texto que contiene la fecha formateada en es-PE

#### Scenario: VM captura ExamNotOpenYetError sin startedAt → toast fallback

- GIVEN el error es `ExamNotOpenYetError({ startedAt: new Date(undefined) })` (Invalid Date)
- WHEN el VM procesa el error
- THEN muestra toast `"Este examen aún no abre"` (sin fecha)

#### Scenario: Clasificación por tipo, no por message

- WHEN se inspecciona el catch del submit en `SimulacroPageViewModel`
- THEN la rama de `ExamNotOpenYetError` se identifica por `instanceof ExamNotOpenYetError`
- AND no hay comparaciones de strings sobre `error.message` ni `body.code`
