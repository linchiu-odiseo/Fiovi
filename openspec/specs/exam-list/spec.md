# exam-list Specification

## Purpose
Displays today's exam list to the student with five-state model (pending, open, submitted, closed). Supports focus refresh, 120s polling, and pull-to-refresh. Resilience: accepts exams with `started: null + in_progress`, alerts in LR.

## Requirements

### Requirement: Obtener simulacros del día desde el backend

El sistema SHALL exponer `GetTodaysExamsUseCase` (L2) que invoca el puerto `ExamsApi` (L1) y devuelve una lista de entidades `Exam` correspondientes al alumno autenticado, junto con el `serverTime` ISO 8601 reportado por el backend. La operación reside en L2 y depende del puerto `ExamsApi`.

El adapter SHALL llamar `GET /t/{slug}/student/exam-sessions` construida via `apiPath.studentExamSessions()`. Auth via cookies HttpOnly + `withCredentials: true` — gestionado por `credentials.interceptor`; el adapter no agrega headers de auth. El server ordena por `scheduled DESC`; el cliente NO reordena la lista. La lista MAY ser vacía.

La entidad `Exam` (L1) SHALL tener los campos: `id`, `area: string | null`, `course: string | null`, `type: string`, `name: string`, `count: number`, `duration: number` (segundos, ≥ 1), `serverStatus: ExamServerStatus`, `scheduled: Date`, `started: Date | null`, `finished: Date | null`.

`ExamServerStatus` SHALL admitir solo los valores `'scheduled' | 'in_progress' | 'finalized'`. El método `permiteEntrada()` MUST retornar `true` solo cuando el valor es `'in_progress'`. El método `esTerminal()` MUST retornar `true` cuando el valor es `'finalized'`.

Clasificación de errores por `(status, endpoint, body.code)` — NUNCA por `message`:
- 401 → manejado por `credentials.interceptor` (refresh + redirect login si falla). El adapter NO clasifica.
- 403 → `ExamsPermissionRevokedError`.
- 404 con `code: "STUDENT_NOT_LINKED"` → `StudentNotLinkedError`.
- 404 sin ese code → `NetworkError`.
- 0 / 5xx → `NetworkError`.
- 429 → `NetworkError` (manejo de backoff diferido a change futuro).

#### Scenario: Lista no vacía con exámenes del día

- **GIVEN** el alumno está autenticado (cookies válidas)
- **WHEN** se invoca `GetTodaysExamsUseCase.execute()`
- **THEN** el resultado contiene una colección de `Exam` con al menos `id`, `name`, `count`, `duration`, `serverStatus`, `scheduled`
- **AND** el resultado incluye el `serverTime` del backend para anclar countdowns

#### Scenario: Lista vacía si no hay exámenes asignados

- **GIVEN** el alumno está autenticado y no tiene exámenes asignados
- **WHEN** se invoca `GetTodaysExamsUseCase.execute()`
- **THEN** el resultado contiene `exams: []`
- **AND** `serverTime` igualmente se reporta

#### Scenario: Error de red durante la consulta (0 / 5xx)

- **GIVEN** el backend no responde o retorna 500
- **WHEN** se invoca `GetTodaysExamsUseCase.execute()`
- **THEN** el use case rechaza con `NetworkError`

#### Scenario: 403 cuando los permisos fueron revocados

- **GIVEN** el backend retorna HTTP 403
- **WHEN** se invoca `GetTodaysExamsUseCase.execute()`
- **THEN** el use case rechaza con `ExamsPermissionRevokedError`

#### Scenario: 404 con code STUDENT_NOT_LINKED

- **GIVEN** el backend retorna HTTP 404 con body `{ code: "STUDENT_NOT_LINKED" }`
- **WHEN** se invoca `GetTodaysExamsUseCase.execute()`
- **THEN** el use case rechaza con `StudentNotLinkedError`

#### Scenario: 404 sin code conocido

- **GIVEN** el backend retorna HTTP 404 con body sin `code: "STUDENT_NOT_LINKED"`
- **WHEN** se invoca `GetTodaysExamsUseCase.execute()`
- **THEN** el use case rechaza con `NetworkError`

#### Scenario: 429 tratado como NetworkError

- **GIVEN** el backend retorna HTTP 429
- **WHEN** se invoca `GetTodaysExamsUseCase.execute()`
- **THEN** el use case rechaza con `NetworkError`

#### Scenario: started null con serverStatus in_progress (se incluye, alerta en LR)

- **GIVEN** el backend retorna una lista con un examen `serverStatus: "in_progress"` y `started: null` junto a otros exámenes válidos
- **WHEN** el adapter procesa la respuesta
- **THEN** el adapter incluye TODOS los exámenes (incluido el de `started: null`) en el resultado, en el orden recibido
- **AND** el examen problemático se construye como `Exam` con `started: null`
- **AND** el view-model de `/simulacro/:id` muestra el banner "☕ El examen está tomando un café, ¡espera la señal para empezar!" y deshabilita el botón Enviar mientras `hasStartedBy(now) === false`
- **AND** el alumno puede marcar; las marcaciones quedan en IDB hasta que el examen entre en vigencia

#### Scenario: Valor de serverStatus fuera del set permitido

- **GIVEN** el backend retorna un valor de `serverStatus` desconocido
- **WHEN** el adapter intenta construir la entidad `Exam`
- **THEN** el adapter lanza `InvalidExamError`

### Requirement: Composición de estado-tarjeta en el view-model

El view-model de `/home` (LR) SHALL componer el estado visual de cada tarjeta de examen a partir de dos dimensiones: `serverStatus` de la entidad `Exam` y el flag local `yaEnvie` derivado del estado ACK de `MarkingsStorage` para ese `examId`. El flag `yaEnvie` NO viene de ningún campo DTO; `finished` es el cierre global de la ventana del examen, no el envío del alumno. Hay exactamente 5 combinaciones válidas:

| serverStatus | yaEnvie | Estado tarjeta | Clickeable |
|---|---|---|---|
| `scheduled` | any | `pending` — gris | No |
| `in_progress` | false | `open` — verde con timer | Sí |
| `in_progress` | true | `submitted` — check verde | No |
| `finalized` | true | `submitted` — check verde | No |
| `finalized` | false | `closed` — rojo | No |

El texto de cierre SHALL calcularse como `exam.scheduled.getTime() + exam.duration * 1000` (factor × 1000 porque `duration` está en segundos). El campo secundario SHALL mostrarse como `area ?? course ?? '—'` (solo en view-model, la entidad acepta ambos como null).

El timer para tarjeta `open` SHALL calcularse como `Math.max(0, exam.duration - (serverTime - exam.started.getTime()) / 1000)` en segundos.

#### Scenario: Tarjeta pending — serverStatus scheduled

- **GIVEN** un `Exam` con `serverStatus: 'scheduled'`
- **WHEN** el view-model compone el estado de tarjeta
- **THEN** el card state es `pending` (gris, no clickeable)
- **AND** no muestra timer ni botón de entrada

#### Scenario: Tarjeta open — in_progress y no enviado localmente

- **GIVEN** un `Exam` con `serverStatus: 'in_progress'` y `yaEnvie: false`
- **WHEN** el view-model compone el estado de tarjeta
- **THEN** el card state es `open` (clickeable, muestra timer en segundos)

#### Scenario: Tarjeta submitted — in_progress y enviado localmente

- **GIVEN** un `Exam` con `serverStatus: 'in_progress'` y `yaEnvie: true`
- **WHEN** el view-model compone el estado de tarjeta
- **THEN** el card state es `submitted` (check verde, no clickeable)

#### Scenario: Tarjeta submitted — finalized y enviado localmente

- **GIVEN** un `Exam` con `serverStatus: 'finalized'` y `yaEnvie: true`
- **WHEN** el view-model compone el estado de tarjeta
- **THEN** el card state es `submitted` (check verde, no clickeable)

#### Scenario: Tarjeta closed — finalized y no enviado localmente

- **GIVEN** un `Exam` con `serverStatus: 'finalized'` y `yaEnvie: false`
- **WHEN** el view-model compone el estado de tarjeta
- **THEN** el card state es `closed` (rojo, no clickeable)

#### Scenario: Cálculo correcto del tiempo de cierre en display

- **GIVEN** `exam.scheduled = T` y `exam.duration = 3600` (segundos)
- **WHEN** el view-model calcula el tiempo de cierre para "Cierra a las HH:MM"
- **THEN** el timestamp de cierre es `T + 3600 * 1000` ms (NO `T + 3600 * 60000`)

#### Scenario: Cálculo del timer para tarjeta open

- **GIVEN** `exam.started = S`, `exam.duration = 1800`, `serverTime = S + 300000` ms
- **WHEN** el view-model calcula el timer
- **THEN** el timer es `Math.max(0, 1800 - 300000 / 1000)` = 1500 segundos

#### Scenario: area null — fallback a course en display

- **GIVEN** un `Exam` con `area: null` y `course: "Matemática"`
- **WHEN** el view-model genera el texto secundario
- **THEN** muestra "Matemática"

#### Scenario: area y course null — fallback a guion

- **GIVEN** un `Exam` con `area: null` y `course: null`
- **WHEN** el view-model genera el texto secundario
- **THEN** muestra "—"

#### Scenario: UI muestra branch StudentNotLinked

- **GIVEN** `GetTodaysExamsUseCase` rechaza con `StudentNotLinkedError`
- **WHEN** el view-model procesa el error
- **THEN** la UI muestra el mensaje "Tu cuenta no tiene un alumno asociado, contacta al tutor"

### Requirement: Refresh de la lista por focus, polling y pull-to-refresh

La pantalla `/home` (LR_render) SHALL refrescar la lista de exámenes mediante tres mecanismos: evento `visibilitychange` cuando la pestaña vuelve a estar visible, polling automático cada 120 segundos mientras la pestaña esté visible, y gesto de pull-to-refresh manual del alumno. Pull-to-refresh re-invoca el mismo `GET /t/{slug}/student/exam-sessions` sin parámetros adicionales; aplica el mismo manejo de errores.

#### Scenario: Refresh al volver al foco

- **WHEN** la pestaña pasa de oculta a visible (`document.visibilityState === "visible"`)
- **THEN** la página dispara `GetTodaysExamsUseCase.execute()` y actualiza el view-model

#### Scenario: Polling pausado mientras la pestaña no es visible

- **WHEN** la pestaña deja de ser visible
- **THEN** el polling de 120s se pausa
- **AND** se reanuda al volver a ser visible

#### Scenario: Pull-to-refresh manual

- **WHEN** el alumno arrastra hacia abajo en `/home` desde la parte superior
- **THEN** la página dispara `GetTodaysExamsUseCase.execute()` inmediatamente
- **AND** muestra feedback visual mientras carga

### Requirement: Backend garantiza no-overlap de exámenes

El puerto `ExamsApi` (L1) SHALL asumir que la lista retornada nunca contiene dos exámenes con `serverStatus: 'in_progress'` simultáneamente para el mismo alumno. El cliente trata cualquier violación como bug de backend pero degrada con elegancia.

#### Scenario: Lista válida con un único in_progress

- **WHEN** el backend retorna la lista del día
- **THEN** a lo más un examen tiene `serverStatus: 'in_progress'` en cualquier momento

#### Scenario: Violación de no-overlap como degradación graceful

- **WHEN** el backend retorna dos exámenes con `serverStatus: 'in_progress'` simultáneamente (bug)
- **THEN** la PWA registra un warning en consola con los ids involucrados
- **AND** ambas tarjetas se renderizan como `open` (verde clickeable) — el cliente NO recomputa el serverStatus
- **AND** el alumno puede entrar a cualquiera sin error

### Requirement: REQ-PA-02 — Estado 'programada' en la tarjeta del alumno

`StudentTasksListViewModel` (or the equivalent view-model composing student exam cards) SHALL add `'programada'` to the `TareaEstado` union type. The new state is a client-side derived state — it is NOT a `serverStatus` value.

Detection (evaluated by `composeEstado` or equivalent pure function, TypeScript only, no Angular APIs):
- A card enters `'programada'` when `exam.serverStatus === 'in_progress'` AND `exam.started !== null` AND `now < exam.started.getTime()`.
- A card is `'abierto'` (existing state) when `exam.serverStatus === 'in_progress'` AND (`exam.started === null` OR `now >= exam.started.getTime()`).

The ticker that drives reactivity MUST be the existing 30-second ticker. No additional `setInterval` or polling SHALL be introduced.

Card rendering when state is `'programada'`:
- Badge element with text `"PROGRAMADA"` (data-testid or equivalent class).
- Opening date line: `"Abre el {fecha corta es-PE}"` using `Intl.DateTimeFormat('es-PE', { dateStyle: 'short', timeStyle: 'short' })` or equivalent locale-aware formatter. No dependency on a new library.
- Countdown line: `"Faltan {X} h {Y} min"` when `exam.started.getTime() - now < 24 * 3600 * 1000`. When countdown exceeds 24 h, the countdown line SHALL NOT render (only the date line is shown).
- Closing info and duration SHALL appear as secondary text below.
- The action button SHALL render as disabled with label `"No disponible aún"`.

Auto-transition: when the ticker recomputes and `now >= exam.started.getTime()`, `composeEstado` returns `'abierto'` for that exam. No explicit notification or side-effect is needed beyond the signal recomputation.

#### Scenario: Exam in_progress con started en el pasado → estado 'abierto'

- **GIVEN** `exam.serverStatus === 'in_progress'` y `exam.started = T` con `T <= now`
- **WHEN** `composeEstado` evalúa el estado
- **THEN** retorna `'abierto'` (comportamiento existente sin cambios)

#### Scenario: Exam in_progress con started en el futuro → estado 'programada'

- **GIVEN** `exam.serverStatus === 'in_progress'` y `exam.started = T` con `T > now`
- **WHEN** `composeEstado` evalúa el estado
- **THEN** retorna `'programada'`
- **AND** la card muestra badge `"PROGRAMADA"` y botón disabled `"No disponible aún"`

#### Scenario: Countdown < 24h → línea "Faltan X h Y min"

- **GIVEN** el estado es `'programada'` y `exam.started.getTime() - now < 86_400_000`
- **WHEN** la card renderiza
- **THEN** aparece la línea `"Faltan {X} h {Y} min"`

#### Scenario: Countdown >= 24h → solo fecha, sin línea de countdown

- **GIVEN** el estado es `'programada'` y `exam.started.getTime() - now >= 86_400_000`
- **WHEN** la card renderiza
- **THEN** NO aparece la línea `"Faltan X h Y min"`
- **AND** SÍ aparece la línea `"Abre el {fecha}"`

#### Scenario: Ticker cruza started → transición automática a 'abierto'

- **GIVEN** una card en estado `'programada'` con `exam.started = now + 10s`
- **WHEN** el ticker de 30s recomputa después de cruzar `exam.started`
- **THEN** `composeEstado` retorna `'abierto'`
- **AND** el botón pasa a habilitado sin intervención del usuario

#### Scenario: Botón "No disponible aún" no es clickable

- **GIVEN** la card está en estado `'programada'`
- **WHEN** se inspecciona el botón de acción
- **THEN** el botón tiene el atributo `disabled`
- **AND** su label es `"No disponible aún"`
