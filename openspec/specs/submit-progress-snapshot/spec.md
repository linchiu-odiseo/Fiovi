# Delta for submit-progress-snapshot

> Esta capability es **NUEVA**. Todos los requirements debajo son ADDED.
> Al archivar este change, este delta se promueve a `openspec/specs/submit-progress-snapshot/spec.md`.

## ADDED Requirements

### Requirement: Contrato HTTP del endpoint `/draft`

El adapter L3 `HttpExamsApi.guardarDraft` SHALL emitir HTTP POST a `apiPath.studentExamDraft(sessionId)` con body JSON `{ "code": <string>, "admission_area": <AdmissionArea>, "responses": <string> }` (snake_case) **en ese orden**. El campo `responses` SHALL ser un string de longitud `exam.count` donde cada char (0-indexed) representa la pregunta `P(i+1)`: `A | B | C | D | E` para respuesta marcada, `-` para sin marcar. El campo `admission_area` SHALL ser uno de los 16 valores del enum `AdmissionArea`. El body NO SHALL incluir `client_finished_at` (exclusivo del `/submit`). El header `withCredentials: true` SHALL ser aplicado por el `credentials.interceptor` global; el adapter NO SHALL setearlo manualmente. La response esperada es HTTP 204 No Content, sin body. El método SHALL resolver con `void` en 204.

#### Scenario: URL armada con apiPath.studentExamDraft

- **GIVEN** `DraftRequest = { examId: "7620c18d-...", code, responses }`
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

El puerto `ExamsApi` (L1) SHALL exponer el método `guardarDraft(req: DraftRequest): Promise<void>` donde `DraftRequest = { examId: string; code: string; admissionArea: AdmissionArea; responses: string }`. El campo `responses` SHALL ser un string compacto de longitud `exam.count` (ver D12 del design). El campo `admissionArea` es requerido (no opcional, no nullable) y su tipo está definido en la capability `admission-area`. El tipo `DraftRequest` SHALL NO incluir `clientFinishedAt`. El bloque de comentarios del port SHALL documentar el formato del string, el mapeo de errores HTTP del endpoint, y la distinción entre `admissionArea` (área de postulación) y `Exam.area` (área del curso).

#### Scenario: Port expone guardarDraft con responses como string y admissionArea

- **WHEN** se inspecciona la interfaz `ExamsApi`
- **THEN** existe el método `guardarDraft(req: DraftRequest): Promise<void>`
- **AND** el tipo `DraftRequest` tiene exactamente los campos `{ examId, code, admissionArea, responses }`
- **AND** el tipo de `responses` es `string` (no `Record<string, ...>`)
- **AND** el tipo de `admissionArea` es `AdmissionArea`

### Requirement: GuardarDraftUseCase puro en L2

El use case `GuardarDraftUseCase` (L2) SHALL:
1. Inyectar `ExamsApi`, `MarkingsStorage`, `IdentityStorage` como puertos.
2. Aceptar `execute({ examId, count }: { examId: string; count: number })`. El parámetro `count` SHALL provenir del view-model (lo conoce desde `Exam.count`) vía el dispatcher.
3. Leer `identity = await identityStorage.read()`; si `identity === null` o `identity.codigo === null`, lanzar `SessionExpiredError` sin tocar `markingsStorage` ni `examsApi`.
4. Leer `AnswersMap` vía `markingsStorage.getMarcaciones(examId)`.
5. Transformar `AnswersMap` en `responses` como **string de longitud `count`**: inicializar array de `count` posiciones con `'-'`; para cada `(pregunta, letra)` con `letra !== null`, sobrescribir la posición `parseInt(pregunta) - 1` (1-indexed → 0-indexed); `join('')`.
6. Delegar al port: `await examsApi.guardarDraft({ examId, code: identity.codigo, responses })`.
7. NO encolar en `enqueueEnvio`. NO invocar `setSubmissionAck`. NO llamar `clearMarcaciones`.
8. Propagar todos los errores del port sin transformación.

#### Scenario: Reshape AnswersMap a string compacto de longitud count

- **GIVEN** `markingsStorage.getMarcaciones` retorna `{ "1": "E", "2": "A", "3": null, "4": "C" }`
- **AND** identity con `codigo="30303011"`
- **WHEN** el use case ejecuta con `{ examId, count: 4 }`
- **THEN** el adapter recibe `{ examId, code: "30303011", responses: "EA-C" }`
- **AND** `responses.length === 4`

#### Scenario: AnswersMap vacío produce responses todo guiones

- **GIVEN** `markingsStorage.getMarcaciones` retorna `{}` (sin entradas)
- **WHEN** el use case ejecuta con `{ examId, count: 5 }`
- **THEN** el adapter recibe `responses: "-----"`

#### Scenario: AnswersMap con todos null produce responses todo guiones

- **GIVEN** `markingsStorage.getMarcaciones` retorna `{ "1": null, "2": null, "3": null }`
- **WHEN** el use case ejecuta con `{ examId, count: 3 }`
- **THEN** el adapter recibe `responses: "---"`

#### Scenario: AnswersMap con marcas dispersas

- **GIVEN** `markingsStorage.getMarcaciones` retorna `{ "1": "A", "5": "D" }`
- **WHEN** el use case ejecuta con `{ examId, count: 6 }`
- **THEN** el adapter recibe `responses: "A---D-"`

#### Scenario: count = 0 produce string vacío

- **GIVEN** `markingsStorage.getMarcaciones` retorna `{}`
- **WHEN** el use case ejecuta con `{ examId, count: 0 }`
- **THEN** el adapter recibe `responses: ""`

#### Scenario: Marcas fuera de rango se ignoran

- **GIVEN** `markingsStorage.getMarcaciones` retorna `{ "1": "A", "50": "B" }` (P50 fuera de count)
- **WHEN** el use case ejecuta con `{ examId, count: 4 }`
- **THEN** el adapter recibe `responses: "A---"`
- **AND** la marca de P50 se ignora silenciosamente

#### Scenario: Sesión expirada antes del POST

- **GIVEN** `identityStorage.read()` resuelve a `null`
- **WHEN** se invoca `execute({ examId, count: 10 })`
- **THEN** lanza `SessionExpiredError`
- **AND** `examsApi.guardarDraft` NUNCA es invocado
- **AND** `markingsStorage.getMarcaciones` NUNCA es invocado

#### Scenario: Use case NO toca queue ni ack

- **GIVEN** `examsApi.guardarDraft` resuelve OK
- **WHEN** el use case completa
- **THEN** `markingsStorage.enqueueEnvio` NUNCA es invocado
- **AND** `markingsStorage.setSubmissionAck` NUNCA es invocado
- **AND** `markingsStorage.clearMarcaciones` NUNCA es invocado

#### Scenario: Errores del port se propagan tal cual

- **GIVEN** `examsApi.guardarDraft` rechaza con `SimulacroCerradoError`
- **WHEN** el use case ejecuta
- **THEN** `execute()` rechaza con `SimulacroCerradoError` (sin envoltorio)

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

El clasificador SHALL leer `body.message` SOLO con igualdad estricta contra el set cerrado `DRAFT_ERROR_MESSAGES = { "INVALID_ADMISSION_AREA", "STUDENT_NOT_ENROLLED", "STUDENT_MISMATCH", "SESSION_NOT_FOUND", "STUDENT_BY_CODE_NOT_FOUND", "SESSION_NOT_ACTIVE" }`. Cualquier otro valor SHALL caer al default por status. El adapter NO SHALL usar `.includes()`, `.match()`, ni regex sobre `message`. Un comentario inline en el adapter SHALL referenciar este Requirement y la excepción documentada a la regla "nunca leer message".

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

#### Scenario: 404 SESSION_NOT_FOUND → SimulacroNoAsignadoError

- **WHEN** POST draft responde 404 con `body: { message: "SESSION_NOT_FOUND" }`
- **THEN** `guardarDraft()` rechaza con `SimulacroNoAsignadoError`

#### Scenario: 404 STUDENT_BY_CODE_NOT_FOUND → StudentNotLinkedError

- **WHEN** POST draft responde 404 con `body: { message: "STUDENT_BY_CODE_NOT_FOUND" }`
- **THEN** `guardarDraft()` rechaza con `StudentNotLinkedError`

#### Scenario: 404 sin message conocido → NetworkError

- **WHEN** POST draft responde 404 con body vacío o `body.message` fuera del enum
- **THEN** `guardarDraft()` rechaza con `NetworkError`

#### Scenario: 409 SESSION_NOT_ACTIVE → SimulacroCerradoError

- **WHEN** POST draft responde 409 con `body: { message: "SESSION_NOT_ACTIVE" }`
- **THEN** `guardarDraft()` rechaza con `SimulacroCerradoError`

#### Scenario: 429 → NetworkError

- **WHEN** POST draft responde 429
- **THEN** `guardarDraft()` rechaza con `NetworkError`

#### Scenario: 5xx → NetworkError

- **WHEN** POST draft responde 500, 502, 503 o 504
- **THEN** `guardarDraft()` rechaza con `NetworkError`

#### Scenario: Timeout o error de transporte → NetworkError

- **WHEN** la request falla con status 0, network error, o timeout
- **THEN** `guardarDraft()` rechaza con `NetworkError`

#### Scenario: Clasificador NO usa regex ni includes() sobre message

- **WHEN** se inspecciona `HttpExamsApi.classifyDraftError`
- **THEN** todas las lecturas de `body.message` son comparaciones por `===` contra strings literales del enum `DRAFT_ERROR_MESSAGES`
- **AND** NO aparecen `.includes()`, `.match()`, ni regex sobre `message`

#### Scenario: Set DRAFT_ERROR_MESSAGES está documentado inline

- **WHEN** se lee el código fuente del classifier
- **THEN** existe un comentario que enumera los 5 valores del enum y referencia `design.md` D5/D10
- **AND** la justificación de la excepción a "nunca leer message" está documentada (misma razón que `SUBMIT_ERROR_MESSAGES`)

### Requirement: Dispatcher con debounce 3s

El servicio L3 `DraftAutoSaveDispatcher` SHALL exponer `notificarCambio(sessionId: string, count: number): void`. El parámetro `count` corresponde a `Exam.count` y SHALL persistir en `DraftState.count` para que el use case lo reciba en cada `fire`. La invocación de `notificarCambio` SHALL:
1. Crear `DraftState` lazy si no existe; setear `state.count = count` (la primera vez se persiste; en llamadas posteriores con el mismo sessionId se actualiza idempotente si la cuenta cambió).
2. Setear `state.dirty = true` para ese sessionId.
3. Si `state.stopped === true`, retornar sin programar timer.
4. Si hay un debounce timer previo activo, cancelarlo (`clearTimeout`).
5. Programar un nuevo timer de **3000ms** que dispare el flush (con throttle según el requirement siguiente).

#### Scenario: Una marca dispara 1 POST tras 3s

- **GIVEN** el dispatcher con estado limpio para `sessionId="S1"`
- **WHEN** se invoca `notificarCambio("S1", count: 50)` y avanzan exactamente 3000ms sin más cambios
- **THEN** se dispara exactamente 1 POST al endpoint `/draft`
- **AND** el use case recibe `{ examId: "S1", count: 50 }`

#### Scenario: 10 marcas en 2s coalesce a 1 POST

- **GIVEN** el dispatcher con estado limpio
- **WHEN** se invoca `notificarCambio` 10 veces en 2000ms (mismo sessionId y count) y luego avanzan 3000ms sin cambios
- **THEN** se dispara exactamente 1 POST con el snapshot final

#### Scenario: Cada notificarCambio cancela el debounce previo

- **WHEN** `notificarCambio` se invoca a t=0ms y nuevamente a t=2000ms
- **THEN** el primer timer es cancelado
- **AND** el POST se dispara a t=5000ms (no a t=3000ms)

#### Scenario: count se persiste en DraftState y se pasa al use case

- **GIVEN** el dispatcher con estado limpio
- **WHEN** se invoca `notificarCambio("S1", 50)` y luego el debounce dispara `fire`
- **THEN** el use case recibe `{ examId: "S1", count: 50 }`
- **AND** el state interno tiene `count === 50`

### Requirement: Throttle 10s entre POSTs

El dispatcher SHALL garantizar que, para un mismo sessionId, dos POSTs consecutivos a `/draft` están separados por al menos **10000ms**. Cuando el debounce timer dispara y `(now - state.lastPostAt) < 10000`, el dispatcher SHALL reagendar el fire al delta restante (`10000 - (now - lastPostAt)`) en vez de POSTear inmediatamente. `state.lastPostAt` SHALL actualizarse SOLO en éxito (HTTP 204).

#### Scenario: Marcas constantes producen máximo 1 POST cada 10s

- **GIVEN** el dispatcher arrancó hace 100ms con un POST exitoso (`lastPostAt = 100`)
- **WHEN** `notificarCambio` se invoca a t=3100ms (3s de debounce desde t=100ms)
- **THEN** el debounce timer dispara a t=3100ms
- **AND** el fire detecta `now - lastPostAt = 3000ms < 10000ms`, reagenda al delta restante (7000ms)
- **AND** el POST efectivo sale a t=10100ms

#### Scenario: throttle NO se aplica si hubo un fallo en el POST previo

- **GIVEN** el POST previo falló (NetworkError) y `state.lastPostAt` quedó sin actualizar (e.g., en su valor inicial 0)
- **WHEN** el siguiente debounce dispara
- **THEN** el fire NO reagenda (delta `now - 0 = now >> 10000`) y POSTea inmediatamente

### Requirement: Backoff exponencial on retryable failures

Cuando un POST `/draft` rechaza con `NetworkError` (incluye HTTP 0, 429, 5xx, timeout, 403 genérico, 404 sin `body.message` conocido), el dispatcher SHALL aplicar un schedule de espera ascendente antes del próximo intento para esa `sessionId`. La constante interna SHALL ser exactamente:

```
BACKOFF_SCHEDULE_MS = [30_000, 60_000, 120_000, 240_000, 300_000]
```

El estado por sessionId SHALL incluir `retryCount: number` (inicializa `0`) y `nextRetryAt: number | null` (inicializa `null`).

En el path de éxito (`fire(sessionId)` recibe HTTP 204), el dispatcher SHALL setear `retryCount = 0` y `nextRetryAt = null` (reset incondicional).

En el path de falla `NetworkError`, el dispatcher SHALL:
1. Incrementar `retryCount += 1`.
2. Calcular `delay = BACKOFF_SCHEDULE_MS[Math.min(retryCount - 1, BACKOFF_SCHEDULE_MS.length - 1)]`.
3. Setear `nextRetryAt = Date.now() + delay`.
4. NO marcar `stopped`. NO escalar a la UI.

La función `tryFire(sessionId)` (gate previo a `fire`) SHALL evaluar `nextRetryAt` antes del throttle:
- Si `nextRetryAt !== null && now < nextRetryAt`: SHALL reagendar `setTimeout(nextRetryAt - now)` y retornar.
- Si pasa el gate de backoff, SHALL evaluar throttle 10s (requirement existente).

El heartbeat 60s SHALL respetar `nextRetryAt`: NO disparar `fire(sessionId)` si `nextRetryAt !== null && now < nextRetryAt`.

Errores que setean `stopped = true` (`InvalidPayloadError`, `StudentNotEnrolledError`, `SimulacroNoAsignadoError`, `StudentNotLinkedError`, `SimulacroCerradoError`, `SessionExpiredError`) SHALL NO usar backoff: quedan terminales para esa sessionId.

#### Scenario: Primera falla espera 30 segundos antes del próximo intento

- **GIVEN** el dispatcher con `retryCount = 0`, `nextRetryAt = null`, dispara `fire("S1")`
- **WHEN** el adapter rechaza con `NetworkError` a t=0ms
- **THEN** `state.retryCount === 1`
- **AND** `state.nextRetryAt === 30_000` (Date.now() base = 0)
- **AND** un nuevo `notificarCambio("S1")` o el heartbeat a t < 30_000ms NO dispara POST
- **AND** un intento a t=30_000ms o posterior SÍ ejecuta `fire("S1")`

#### Scenario: Segunda falla consecutiva espera 60 segundos

- **GIVEN** el dispatcher con `retryCount = 1` tras una falla previa
- **WHEN** el siguiente intento también rechaza con `NetworkError`
- **THEN** `state.retryCount === 2`
- **AND** `state.nextRetryAt === Date.now() + 60_000`

#### Scenario: Tercera falla espera 2 minutos

- **GIVEN** `retryCount = 2`
- **WHEN** falla con `NetworkError`
- **THEN** `state.retryCount === 3`
- **AND** delay aplicado === 120_000ms

#### Scenario: Cuarta falla espera 4 minutos

- **GIVEN** `retryCount = 3`
- **WHEN** falla con `NetworkError`
- **THEN** `state.retryCount === 4`
- **AND** delay aplicado === 240_000ms

#### Scenario: Quinta y subsiguientes fallas quedan capeadas en 5 minutos

- **GIVEN** `retryCount = 4`
- **WHEN** falla con `NetworkError`
- **THEN** `state.retryCount === 5`
- **AND** delay aplicado === 300_000ms
- **AND** una sexta falla SHALL también usar 300_000ms (techo)
- **AND** una décima falla SHALL también usar 300_000ms

#### Scenario: Éxito resetea el contador y el próximo fallo vuelve a 30s

- **GIVEN** `retryCount = 4` tras 4 fallas consecutivas
- **WHEN** el siguiente POST responde HTTP 204
- **THEN** `state.retryCount === 0`
- **AND** `state.nextRetryAt === null`
- **AND** una nueva falla `NetworkError` inmediata aplica delay === 30_000ms (no 300_000ms)

#### Scenario: Heartbeat respeta el backoff

- **GIVEN** `state.dirty === true`, `state.nextRetryAt === Date.now() + 120_000`
- **WHEN** transcurre 1 tick del heartbeat (60_000ms después)
- **THEN** NO se dispara POST (porque `now < nextRetryAt`)
- **AND** otro tick más (60_000ms después, ahora total 120_000ms) SÍ permite dispatcher (nextRetryAt ya se cumplió)

#### Scenario: Backoff NO aplica a errores duros

- **GIVEN** `fire("S1")` ejecuta y el adapter rechaza con `InvalidPayloadError`
- **THEN** `state.stopped === true`
- **AND** `state.retryCount` NO se incrementa
- **AND** `state.nextRetryAt` permanece `null`
- **AND** futuros `notificarCambio("S1")` NO programan timer (por `stopped`)

#### Scenario: Backoff NO aplica a 409 SESSION_NOT_ACTIVE

- **GIVEN** `fire("S1")` ejecuta y el adapter rechaza con `SimulacroCerradoError`
- **THEN** `state.stopped === true`
- **AND** `state.retryCount` NO se incrementa
- **AND** la sessionId emite a la signal `closedSessions`

#### Scenario: Back se cae 1 minuto y se recupera — alumno sigue marcando

- **GIVEN** el alumno marca a t=0ms, el POST sale a t=3000ms y falla con `NetworkError` (back caído)
- **AND** `state.retryCount = 1`, `state.nextRetryAt = 33_000ms`
- **AND** el alumno sigue marcando entre t=3000ms y t=60_000ms
- **WHEN** el back vuelve a t=33_000ms y el debounce/heartbeat dispara `fire`
- **AND** el POST responde 204
- **THEN** `state.retryCount === 0`
- **AND** marcas posteriores siguen el ritmo normal (debounce 3s + throttle 10s)
- **AND** el alumno nunca vio una interrupción

#### Scenario: Back caído todo el examen — máximo 1 POST cada 5 minutos por sessionId

- **GIVEN** el back devuelve 503 a todos los `fire` durante 60 minutos
- **WHEN** el alumno marca constantemente
- **THEN** después de la 5° falla, el dispatcher mantiene el ritmo de 1 intento cada 300_000ms (5 min)
- **AND** la UI sigue funcionando idéntica a hoy
- **AND** el submit final dispara su flujo normal (IDB → outbox si falla)

### Requirement: Heartbeat 60s dirty-only

El dispatcher SHALL ejecutar un heartbeat global con `setInterval(60_000ms)`. En cada tick, el heartbeat SHALL recorrer todos los `(sessionId, state)` del estado interno y, para cada uno, invocar `fire(sessionId)` SOLO si `state.dirty === true && state.inflight === false && state.stopped === false`. Si no hay nada que requiera flush, el heartbeat SHALL no-op silenciosamente sin emitir tráfico HTTP.

#### Scenario: Heartbeat NO dispara si no hay cambios sucios

- **GIVEN** el dispatcher con sesiones registradas, todas con `dirty === false`
- **WHEN** transcurren 60000ms
- **THEN** NO se emite ningún POST

#### Scenario: Heartbeat dispara si hay cambios sucios sin sincronizar

- **GIVEN** el dispatcher con `sessionId="S1"`, `state = { dirty: true, inflight: false, stopped: false, ... }`
- **AND** el último cambio fue hace 50000ms (debounce ya expiró pero el throttle reagendó y luego el alumno paró de marcar)
- **WHEN** transcurren 10000ms más (heartbeat tick a t=60000ms)
- **THEN** se dispara exactamente 1 POST con el snapshot actual

#### Scenario: Heartbeat NO dispara si stopped

- **GIVEN** el dispatcher con `state = { dirty: true, stopped: true }`
- **WHEN** transcurren 60000ms
- **THEN** NO se emite ningún POST

#### Scenario: Heartbeat NO dispara si inflight

- **GIVEN** el dispatcher con `state = { dirty: true, inflight: true, stopped: false }`
- **WHEN** transcurren 60000ms
- **THEN** NO se emite ningún POST adicional (espera a que el inflight termine)

### Requirement: Coalesce — invariante de pérdida cero local

Cuando `fire(sessionId)` ejecuta, SHALL bajar `state.dirty = false` ANTES de leer el snapshot de IndexedDB. Si una invocación a `notificarCambio(sessionId)` ocurre durante el POST en vuelo, SHALL setear `state.dirty = true` de nuevo. El próximo ciclo (debounce o heartbeat) SHALL hacer otro POST con el snapshot actualizado.

#### Scenario: Marca durante POST en vuelo conserva dirty

- **GIVEN** el dispatcher está en mitad de un POST (`inflight = true`, `dirty = false`)
- **WHEN** se invoca `notificarCambio(sessionId)`
- **THEN** `state.dirty` queda en `true`
- **AND** cuando el POST en vuelo termina, el siguiente ciclo dispara un nuevo POST con el snapshot actualizado

#### Scenario: Bajar dirty antes de leer IDB

- **WHEN** se inspecciona la implementación de `fire(sessionId)`
- **THEN** el orden de operaciones es: setear `inflight = true`, setear `dirty = false`, leer snapshot, POSTear
- **AND** no hay path donde se lea el snapshot ANTES de bajar `dirty`

### Requirement: Cancel-on-submit

El dispatcher SHALL exponer `cancelarDraftsPendientes(sessionId: string): void`. La invocación SHALL:
1. Cancelar el debounce timer del sessionId si existe (`clearTimeout`; setear handle a `null`).
2. Setear `state.stopped = true` para ese sessionId.
3. NO tocar `state.inflight` (el POST en vuelo no es abortable; el back hace no-op silent si el submit ya escribió `final` en Redis).

Tras `cancelarDraftsPendientes`, futuras invocaciones a `notificarCambio(sessionId)` con la misma sessionId SHALL retornar sin programar timer (porque `stopped === true`). El heartbeat SHALL omitir el sessionId.

#### Scenario: cancelarDraftsPendientes detiene futuros POSTs

- **GIVEN** el dispatcher con `sessionId="S1"`, debounce timer activo
- **WHEN** se invoca `cancelarDraftsPendientes("S1")`
- **AND** transcurren 60000ms con o sin `notificarCambio` adicional
- **THEN** NO se emite ningún POST adicional para esa sessionId

#### Scenario: cancelarDraftsPendientes NO aborta inflight

- **GIVEN** el dispatcher con `state = { inflight: true }` para `sessionId="S1"`
- **WHEN** se invoca `cancelarDraftsPendientes("S1")`
- **THEN** el POST en vuelo se completa normalmente
- **AND** `state.stopped` queda en `true`

### Requirement: 409 SESSION_NOT_ACTIVE escala al view-model

Cuando un POST `/draft` rechaza con `SimulacroCerradoError`, el dispatcher SHALL:
1. Setear `state.stopped = true` para ese sessionId.
2. Emitir el sessionId a la signal pública `closedSessions: Signal<readonly string[]>` (o un mecanismo equivalente de notificación al view-model).

El view-model de `/simulacro` SHALL observar esta señal y, cuando reciba el sessionId activo, reusar el branch existente `errorState = 'cerrado'` + redirect a `/home`.

#### Scenario: 409 escala al view-model

- **GIVEN** el dispatcher dispara un POST y el back responde 409 con `body: { message: "SESSION_NOT_ACTIVE" }`
- **WHEN** el adapter rechaza con `SimulacroCerradoError`
- **THEN** `state.stopped` se setea a `true`
- **AND** la sessionId aparece en la signal `closedSessions`
- **AND** el view-model en `/simulacro` observa el cambio y dispara el flujo "cerrado"

### Requirement: Garantías no-fatal para la sesión

Errores del `/draft` distintos de `SimulacroCerradoError` SHALL NO interrumpir la sesión del alumno ni emitir cambios visibles en la UI. Específicamente:
- `NetworkError`, timeout, 429, 5xx, 403 genérico, 404 sin message conocido: dispatcher silencia, `state.inflight = false`, `state.dirty` queda como esté, aplica **backoff exponencial** (ver requirement "Backoff exponencial on retryable failures"). El próximo intento queda gateado por `nextRetryAt`.
- `InvalidPayloadError`, `StudentNotEnrolledError`, `SimulacroNoAsignadoError`, `StudentNotLinkedError`, `SessionExpiredError`: dispatcher setea `state.stopped = true` y silencia. La sesión queda sin auto-save pero el alumno puede seguir marcando (IDB local intacto) y el submit final sigue siendo el camino canónico — si persiste el problema, el submit hablará.

El dispatcher SHALL NO mostrar toasts, modales, ni cambiar el routing por errores no-fatales.

#### Scenario: NetworkError silencia y deja dirty para reintento con backoff

- **GIVEN** el dispatcher con `dirty=true` dispara un POST
- **WHEN** el adapter rechaza con `NetworkError`
- **THEN** `state.inflight = false`
- **AND** `state.stopped` permanece `false`
- **AND** `state.retryCount` se incrementa y `state.nextRetryAt` se setea según `BACKOFF_SCHEDULE_MS` (ver requirement "Backoff exponencial on retryable failures")
- **AND** la UI no muestra ningún cambio
- **AND** el próximo dispatch (debounce, heartbeat, o nuevo `notificarCambio`) queda gateado por `nextRetryAt`

#### Scenario: InvalidPayloadError silencia y detiene la sesión

- **GIVEN** el dispatcher dispara un POST
- **WHEN** el adapter rechaza con `InvalidPayloadError`
- **THEN** `state.stopped` se setea a `true`
- **AND** la UI no muestra ningún cambio
- **AND** futuras invocaciones a `notificarCambio` para esa sessionId no programan timer

#### Scenario: Sin red durante todo el examen NO interrumpe al alumno

- **GIVEN** la red está caída desde el inicio
- **WHEN** el alumno marca, el debounce expira, y cada POST rechaza con `NetworkError`
- **THEN** la UI sigue funcionando idéntica a hoy
- **AND** el alumno puede completar la cartilla y tocar Enviar
- **AND** el submit final sigue su flujo normal (queue offline + retry)

### Requirement: Race draft-vs-submit — back no-op silent

El dispatcher SHALL NO intentar abortar un POST `/draft` en vuelo cuando el view-model invoca `cancelarDraftsPendientes` (caso típico: alumno tocó Enviar). El POST en vuelo llega al back; si el back ya tiene en Redis la key `sess:{sessionId}:student:{studentId}:final` (escrita por un submit exitoso previo), el back responde HTTP 204 sin upsertear nada. El dispatcher trata ese 204 como éxito normal (actualiza `lastPostAt`, no hay efecto observable porque `stopped = true` impide nuevos fires).

#### Scenario: Draft en vuelo durante submit recibe 204 no-op silent

- **GIVEN** un POST `/draft` está en vuelo (`inflight = true`)
- **AND** el view-model invoca `cancelarDraftsPendientes` (alumno tocó Enviar)
- **WHEN** el submit completa antes que el draft (back escribe `final` en Redis)
- **AND** el draft llega al back después
- **THEN** el back responde HTTP 204 sin tocar nada
- **AND** el dispatcher trata la respuesta como éxito normal sin efectos visibles

### Requirement: Feature flag DRAFT_ENABLED — dispatcher inerte cuando apagado

El sistema SHALL exponer la variable de entorno `DRAFT_ENABLED` (string `"true"` o `"false"`, default `"false"` si no está seteada). `scripts/build-env.mjs` SHALL generar `environment.draftEnabled: boolean`. En `app.config.ts`, el provider de `DraftAutoSaveDispatcher` SHALL:
- Cuando `environment.draftEnabled === true`: instanciar el dispatcher real (`DraftAutoSaveDispatcher`).
- Cuando `environment.draftEnabled === false`: instanciar un stub `NoopDraftAutoSaveDispatcher` que implementa la misma interfaz pública con métodos vacíos (no-op) y signal de cierre que nunca emite.

El view-model SHALL inyectar el dispatcher por token/clase y llamar a sus métodos sin condicional. Cuando el flag está apagado, las llamadas NO SHALL emitir tráfico HTTP, NO SHALL programar timers, y NO SHALL ejecutar heartbeat.

#### Scenario: Flag apagado → cero tráfico al /draft

- **GIVEN** `environment.draftEnabled === false`
- **WHEN** el alumno marca 100 veces durante 1 hora en la cartilla
- **THEN** NO se emite ningún POST a `/t/{slug}/student/exam-sessions/{id}/draft`
- **AND** la UI sigue funcionando idéntica a hoy
- **AND** el submit final no cambia

#### Scenario: Flag apagado → view-model invoca stub sin error

- **GIVEN** `environment.draftEnabled === false` y el provider devolvió `NoopDraftAutoSaveDispatcher`
- **WHEN** el view-model invoca `notificarCambio(sessionId)` y luego `cancelarDraftsPendientes(sessionId)`
- **THEN** ambas llamadas resuelven sin error
- **AND** no se programan timers
- **AND** la signal `closedSessions` nunca emite

#### Scenario: Default ausente equivale a false

- **GIVEN** la variable `DRAFT_ENABLED` no está en `.env`
- **WHEN** se invoca `npm run build-env`
- **THEN** `environment.draftEnabled === false`

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

### Requirement: Dispatcher arranca lazy — NO en APP_INITIALIZER

El `DraftAutoSaveDispatcher` SHALL NO ser invocado desde APP_INITIALIZER. La primera entrada en su estado interno SHALL crearse implícitamente cuando el view-model invoca `notificarCambio(sessionId)` por primera vez. El heartbeat `setInterval(60s)` SHALL armarse en el constructor del servicio pero SHALL no-op'ear mientras el mapa de estado esté vacío (o todas las sesiones tengan `dirty === false`).

Esta diferencia con `EnvioRetryDispatcher` (que SÍ arranca en APP_INITIALIZER porque drena la cola IDB persistente) SHALL estar documentada en un comentario inline del servicio referenciando `design.md` D1/D8.

#### Scenario: app.config.ts NO invoca start() del dispatcher

- **WHEN** se inspecciona `app.config.ts`
- **THEN** no hay APP_INITIALIZER ni inject explícito que invoque `DraftAutoSaveDispatcher.start()`
- **AND** existe sí el APP_INITIALIZER de `EnvioRetryDispatcher.start()` (que no se toca en este change)

#### Scenario: Sin actividad, el dispatcher no emite POSTs

- **GIVEN** la app arranca y el alumno se queda en `/home` sin abrir ningún simulacro
- **WHEN** transcurren 10 minutos
- **THEN** NO se emite ningún POST a `/draft`
- **AND** el heartbeat tick no-op'ea silencioso (mapa vacío)
