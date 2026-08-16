# Delta for tutor-exam-management

## ADDED Requirements

### Requirement: REQ-PA-01 — Modal Iniciar acepta startedAt programado (tab Tarea)

`TutorExamDetailViewModel` SHALL expose signals `pendingStartedAt: WritableSignal<string | null>` and `pendingOpenUntil: WritableSignal<string | null>` for the scheduled-open inputs, plus computed signals `startedAtError: Signal<string | null>` and `openUntilError: Signal<string | null>` for inline validation messages, and a computed `isScheduledSubmitDisabled: Signal<boolean>` that is `true` when either error is non-null.

The existing `HWheelComponent` date/time wheels in the Tarea tab MUST NOT be removed from the DOM. They SHALL be hidden via a boolean flag (`showHwheels: Signal<boolean>` or equivalent); the `datetime-local` inputs appear when the flag is `false`.

Validation rules (all comparisons in the VM, using `Date` arithmetic, no `@angular/*`):
- `startedAt < openUntil` — MUST hold; otherwise `startedAtError` = `"Debe ser antes del cierre"`.
- `startedAt >= now - CLOCK_SKEW_MS` — MUST hold; otherwise `startedAtError` = `"No puede ser en el pasado"`.
- `openUntil <= now + HOMEWORK_MAX_WINDOW_MS` — MUST hold; otherwise `openUntilError` = `"Tope 15 días"`.

`IniciarExamenUseCase` request SHALL include `startedAt?: Date` (optional). The adapter serialises it to `started_at: string` (ISO) in the POST `/start` body ONLY when the tutor modified the default (i.e., `pendingStartedAt` differs from the pre-filled default). When unmodified, the field SHALL be omitted from the body.

The modal for non-Tarea exam types MUST NOT render the `startedAt` input — the input is exclusive to `type === 'homework'` (Tarea).

#### Scenario: Tarea con startedAt válido — payload incluye started_at

- GIVEN el modal está en modo Tarea (`exam.type === 'homework'`)
- AND el tutor ingresa `startedAt = T1` donde `now - 5min <= T1 < openUntil` y `openUntil <= now + 15d`
- AND `T1` difiere del default precargado
- WHEN el tutor confirma el modal
- THEN `IniciarExamenUseCase.execute` recibe `{ recordId, startedAt: T1 }`
- AND el adapter envía body con `started_at: T1.toISOString()`

#### Scenario: startedAt >= openUntil — botón deshabilitado

- GIVEN el tutor ingresa `startedAt = T1` y `openUntil = T2` con `T1 >= T2`
- WHEN se evalúa `startedAtError`
- THEN `startedAtError()` es `"Debe ser antes del cierre"`
- AND `isScheduledSubmitDisabled()` es `true`

#### Scenario: startedAt en el pasado (> 5 min) — botón deshabilitado

- GIVEN el tutor ingresa `startedAt = T1` con `T1 < now - CLOCK_SKEW_MS`
- WHEN se evalúa `startedAtError`
- THEN `startedAtError()` es `"No puede ser en el pasado"`
- AND `isScheduledSubmitDisabled()` es `true`

#### Scenario: Tutor no modifica el default — payload NO incluye started_at

- GIVEN el modal abre con el default precargado (`pendingStartedAt` = valor inicial)
- AND el tutor NO edita el input `startedAt`
- WHEN confirma el modal
- THEN `IniciarExamenUseCase.execute` recibe `{ recordId }` sin `startedAt`
- AND el body POST NO contiene la key `started_at`

#### Scenario: Modal modo no-Tarea — input startedAt no renderiza

- GIVEN `exam.type !== 'homework'`
- WHEN la página renderiza el modal Iniciar
- THEN el input `startedAt` (`type="datetime-local"`) NO está presente en el DOM
