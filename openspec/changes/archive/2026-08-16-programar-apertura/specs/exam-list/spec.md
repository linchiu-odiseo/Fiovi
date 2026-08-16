# Delta for exam-list

## ADDED Requirements

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
