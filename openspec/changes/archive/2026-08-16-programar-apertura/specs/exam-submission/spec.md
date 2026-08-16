# Delta for exam-submission + submit-progress-snapshot

> Covers REQ-PA-03: HTTP 422 `exam_not_open_yet` classification in both `classifySubmitError`
> (exam-submission capability) and `classifyDraftError` (submit-progress-snapshot capability).
> Both deltas are combined here because the behavioural rule is identical and shares the same
> domain error class.

## ADDED Requirements

### Requirement: REQ-PA-03-L1 — ExamNotOpenYetError con startedAt

L1 SHALL define `ExamNotOpenYetError` as a domain error class (TypeScript only, no `@angular/*`)
with a required field `startedAt: Date`. The class MUST extend the project's base domain error
convention. No other layers may construct this error — it is instantiated exclusively in the L3
adapter before crossing the boundary into L1.

#### Scenario: ExamNotOpenYetError instanciado con startedAt

- GIVEN `body = { code: 'exam_not_open_yet', startedAt: '2026-08-20T08:00:00.000Z' }`
- WHEN el adapter construye `new ExamNotOpenYetError({ startedAt: new Date(body.startedAt) })`
- THEN `error.startedAt` es un `Date` con valor `2026-08-20T08:00:00.000Z`

---

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

---

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

---

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

---

## Constants

| Constant | Value | Used in |
|---|---|---|
| `HOMEWORK_MAX_WINDOW_MS` | `15 * 24 * 60 * 60 * 1000` (15 days in ms) | tutor-exam-management validation |
| `CLOCK_SKEW_MS` | `5 * 60 * 1000` (5 min in ms) | tutor-exam-management validation |
| `TICKER_INTERVAL_MS` | `30 * 1000` (30 s) | exam-list auto-transition (existing ticker, not new) |
| `SCHEDULED_COUNTDOWN_THRESHOLD_MS` | `24 * 60 * 60 * 1000` (24 h in ms) | exam-list countdown display cutoff |

---

## Out of Scope

- Home screen del alumno (lista fuera de `/home`).
- Server-side changes — learnex backend ya soporta `started_at` y 422 `exam_not_open_yet`.
- I18n / i18next integration (strings hardcoded es-PE, Fase 1+).
- Analytics o telemetría del nuevo estado `'programada'`.
- Estilos custom para `<input type="datetime-local">` (UI nativa del OS).
- Migración de datos existentes.
- Nuevas dependencias npm.
- Feature flags remotos.
