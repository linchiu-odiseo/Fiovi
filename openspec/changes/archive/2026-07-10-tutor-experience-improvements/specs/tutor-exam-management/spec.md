# Delta for tutor-exam-management

## ADDED Requirements

### Requirement: Metadata rica en el header del detail

`TutorExamDetailPage` SHALL renderizar en el header (`[data-testid="exam-meta"]`) los siguientes campos derivados de `vm.detail()`:

- **Área** — si `detail.area` no es null: ícono `category` + texto `"Área: <area>"`.
- **Curso** — si `detail.course` no es null: ícono `menu_book` + texto `"Curso: <course>"`.
- **Preguntas** — ícono `quiz` + texto derivado: `"N preguntas"` si `count` es número; `"Preguntas: pendientes"` si `count === null`.
- **Duración** — ícono `timer` + texto `"Duración: N min"` con `N = Math.round(duration / 60)`.
- **Iniciado** — si `detail.startedAt` no es null: ícono `play_arrow` + `formatDateTime(startedAt)` con formato es-PE `dd/mm/yyyy hh:mm`.
- **Finalizado** — si `detail.finishedAt` no es null: ícono `flag` + `formatDateTime(finishedAt)`.

Los helpers `durationMinutes`, `countLabel`, `formatDateTime` SHALL vivir en el page (`tutor-exam-detail.page.ts`) como métodos `protected`. `formatDateTime` SHALL usar `getDate/getMonth/getFullYear/getHours/getMinutes` con `padStart(2, '0')` — sin dependencia con `Intl` para bundle chico y output determinista en jsdom.

#### Scenario: Header muestra área y curso cuando existen

- **GIVEN** `detail = { area: "Matemáticas", course: "Álgebra", count: 20, duration: 3600, startedAt: null, finishedAt: null }`
- **WHEN** el detail renderiza
- **THEN** `[data-testid="exam-meta"]` contiene `"Matemáticas"` y `"Álgebra"`
- **AND** contiene `"20 preguntas"` y `"60 min"`

#### Scenario: count null → "Preguntas: pendientes"

- **GIVEN** `detail.count === null`
- **WHEN** el detail renderiza
- **THEN** `[data-testid="exam-meta"]` contiene `"Preguntas: pendientes"`

#### Scenario: startedAt renderiza en formato es-PE

- **GIVEN** `detail.startedAt = new Date("2026-07-10T14:32:00")`
- **WHEN** el detail renderiza
- **THEN** el DOM contiene `"10/07/2026 14:32"`

---

### Requirement: Modal Iniciar con edición de duración (mm+ss)

`TutorExamDetailViewModel` SHALL exponer estado y acciones para un modal que permite al tutor editar la duración antes de iniciar:

- `iniciarModalOpen: signal<boolean>` — visibilidad.
- `pendingMinutes: signal<number | null>` / `pendingSeconds: signal<number | null>` — inputs.
- `pendingTotalSeconds: computed<number | null>` — `null` cuando los inputs no son enteros válidos.
- `durationError: signal<string | null>` — mensaje de error activo.
- Constantes `DURATION_MIN_SECONDS = 60`, `DURATION_MAX_SECONDS = 7200`.

Acciones:
- `openIniciarModal()` — solo si `canIniciar()`; precarga mm+ss desde `detail().duration`.
- `cancelIniciarModal()` — resetea a null y cierra.
- `confirmIniciarModal()` — valida:
  - `m` y `s` son enteros; `s ∈ [0, 59]`; `m ≥ 0`.
  - `total = m*60 + s` ∈ `[DURATION_MIN_SECONDS, DURATION_MAX_SECONDS]`.
  - Si falla cualquiera → setea `durationError` y NO envía al back.
  - Si el total coincide con `detail().duration` → llama `iniciar()` sin `newDuration` (override `undefined`).
  - Si difiere → llama `iniciar(totalSeconds)`.

`iniciar(newDuration?)` SHALL propagar `newDuration` al `IniciarExamenUseCase` como `duration`.

`TutorExamDetailPage` SHALL renderizar el modal cuando `iniciarModalOpen()` es true, con dos inputs `type="number"` (mm y ss), un resumen `formatMmSs(pendingTotalSeconds())`, y botones "Iniciar examen" / "Cancelar" `[data-testid="btn-confirm-iniciar"]` y `[data-testid="btn-cancel-iniciar"]`.

#### Scenario: Duración válida sin cambio no envía body al back

- **GIVEN** `detail.duration = 3600` (60 min)
- **WHEN** el tutor abre el modal (`pendingMinutes = 60`, `pendingSeconds = 0`) y confirma sin editar
- **THEN** `IniciarExamenUseCase.execute` es llamado con `{ recordId, duration: undefined }`

#### Scenario: Duración cambiada envía override

- **GIVEN** `detail.duration = 3600`
- **WHEN** el tutor edita a `pendingMinutes = 30`, `pendingSeconds = 0` y confirma
- **THEN** `IniciarExamenUseCase.execute` es llamado con `{ recordId, duration: 1800 }`

#### Scenario: Duración fuera de rango bloquea envío

- **GIVEN** el tutor ingresa `pendingMinutes = 130`, `pendingSeconds = 0` (7800s > 7200)
- **WHEN** confirma el modal
- **THEN** `durationError` es setado con mensaje `"La duración debe estar entre 1:00 y 120:00."`
- **AND** `IniciarExamenUseCase.execute` NO es llamado

#### Scenario: Segundos > 59 bloquea envío

- **GIVEN** el tutor ingresa `pendingMinutes = 10`, `pendingSeconds = 75`
- **WHEN** confirma el modal
- **THEN** `durationError` es `"Los segundos deben estar entre 0 y 59."`
- **AND** `IniciarExamenUseCase.execute` NO es llamado

#### Scenario: Botón "Iniciar" del detail abre el modal en vez de iniciar directo

- **GIVEN** `canIniciar() === true`
- **WHEN** el usuario clickea `[data-testid="btn-iniciar"]`
- **THEN** `iniciarModalOpen()` pasa a `true`
- **AND** `IniciarExamenUseCase.execute` NO es llamado inmediatamente

---

### Requirement: Modal Finalizar con confirmación explícita

`TutorExamDetailViewModel` SHALL exponer `finalizarModalOpen: signal<boolean>` y las acciones `openFinalizarModal / cancelFinalizarModal / confirmFinalizarModal`. El botón "Finalizar" del detail (`[data-testid="btn-finalizar"]`) SHALL abrir el modal en vez de invocar `finalizar()` directo.

El modal SHALL mostrar el copy `"¿Seguro que querés cerrar el examen antes de tiempo? Los alumnos no podrán seguir marcando y se enviará a procesar."` y dos botones: "Sí, finalizar" (`[data-testid="btn-confirm-finalizar"]`, estilo destructivo) y "Cancelar" (`[data-testid="btn-cancel-finalizar"]`).

Ambos botones SHALL quedar `[disabled]="vm.isSaving()"` mientras la operación está en vuelo (previene double-tap).

#### Scenario: Botón "Finalizar" abre el modal

- **GIVEN** `canFinalizar() === true`
- **WHEN** el usuario clickea `[data-testid="btn-finalizar"]`
- **THEN** `finalizarModalOpen()` pasa a `true`
- **AND** `FinalizarExamenUseCase.execute` NO es llamado inmediatamente

#### Scenario: Confirmación ejecuta finalizar

- **GIVEN** `finalizarModalOpen() === true`
- **WHEN** el usuario clickea `[data-testid="btn-confirm-finalizar"]`
- **THEN** `finalizarModalOpen()` pasa a `false`
- **AND** `FinalizarExamenUseCase.execute` es llamado con el `recordId`

#### Scenario: Cancelación cierra sin ejecutar

- **GIVEN** `finalizarModalOpen() === true`
- **WHEN** el usuario clickea `[data-testid="btn-cancel-finalizar"]`
- **THEN** `finalizarModalOpen()` pasa a `false`
- **AND** `FinalizarExamenUseCase.execute` NO es llamado

---

### Requirement: Contador de alumnos habilitados en el header de la lista

`TutorExamDetailViewModel` SHALL exponer `enabledCount: computed<number>` (deriva de `enabledStudentIds().length`) y `totalStudents: computed<number>` (deriva de `students().length`).

El template del detail SHALL renderizar `[data-testid="students-counter"]` con el texto `"N habilitados de M"` en el header de la lista de alumnos.

#### Scenario: Counter refleja enabled/total

- **GIVEN** `students().length === 25` y `enabledStudentIds().length === 12`
- **WHEN** el detail renderiza la lista
- **THEN** `[data-testid="students-counter"]` contiene `"12 habilitados de 25"`
