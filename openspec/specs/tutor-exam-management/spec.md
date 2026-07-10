# tutor-exam-management — Specification

## Purpose

Defines the tutor exam detail / management screen: `TutorExamDetailViewModel` with store-based `classroomId` resolution (warm path) and list-refetch fallback (cold deep-link), start / finalize / enable-students actions, copy-by-action error messages in Spanish, and `TutorExamDetailPage` with iOS-safe back button. Depends on `tutor-exams-api` and `tutor-exam-list` capabilities.

## Requirements

### Requirement: TutorExamDetailViewModel — resolución de classroomId con fallback a refetch (D1)

`TutorExamDetailViewModel` (`src/LR_render/tutor/tutor-exam-detail/tutor-exam-detail.view-model.ts`) SHALL:
- Recibir `recordId` desde los route params (`ActivatedRoute` o `inject(ActivatedRoute)`).
- Resolver `classroomId` y `detailId` siguiendo la estrategia D1:
  1. Consultar el store compartido (`TutorExamsStore`) por `recordId`.
  2. Si el store tiene el dato → usar `classroomId` y `detailId` directamente.
  3. Si el store está vacío (deep-link, refresh) → invocar `GetTutorExamsUseCase.execute()` para refetchear la lista, poblar el store, y luego extraer `classroomId`/`detailId`.
- Una vez resuelto `classroomId` y `detailId`, cargar en paralelo (o secuencialmente):
  - `GetTutorExamDetailUseCase.execute({ recordId })` → `TutorExamDetail` (para `enabledStudentIds` y status actualizado).
  - `ListClassroomStudentsUseCase.execute({ classroomId, virtualExamDetailId: detailId })` → `ClassroomStudent[]`.

#### Scenario: Store vacío en deep-link → refetch list resuelve classroomId

- **GIVEN** el tutor navega directamente a `/tutor/exams/rec-1` sin haber visitado `/tutor/home`
- **AND** el store compartido está vacío
- **WHEN** `TutorExamDetailViewModel` se inicializa
- **THEN** el VM invoca `GetTutorExamsUseCase.execute()` para refetchear la lista
- **AND** localiza el item con `recordId === "rec-1"` y obtiene su `classroomId`
- **AND** continúa con la carga normal del detalle y los alumnos

#### Scenario: Store poblado → classroomId resuelto sin request extra

- **GIVEN** el store compartido contiene el TutorExam con `recordId === "rec-1"` y `classroomId === "cls-1"`
- **WHEN** `TutorExamDetailViewModel` se inicializa con `recordId = "rec-1"`
- **THEN** el VM NO invoca `GetTutorExamsUseCase.execute()`
- **AND** usa `classroomId = "cls-1"` directamente del store

#### Scenario: recordId no encontrado ni en store ni en refetch → error

- **GIVEN** el store está vacío
- **AND** `GetTutorExamsUseCase.execute()` resuelve con una lista que NO contiene `recordId = "rec-xxx"`
- **WHEN** `TutorExamDetailViewModel` busca `recordId = "rec-xxx"`
- **THEN** el VM entra en estado de error (`error() = true`)
- **AND** NOT navega silenciosamente

---

### Requirement: TutorExamDetailViewModel — Signals expuestos

El VM SHALL exponer las Signals siguientes:
- `detail: Signal<TutorExamDetail | null>` — detalle cargado (null hasta cargar).
- `students: Signal<readonly ClassroomStudent[]>` — lista de alumnos del aula.
- `loading: Signal<boolean>` — true durante la carga inicial.
- `error: Signal<'network' | 'notFound' | 'forbidden' | null>` — null si todo OK.
- `enabledStudentIds: WritableSignal<readonly string[]>` — set local mutable de IDs habilitados (inicializa desde `detail().enabledStudentIds`).
- `isSaving: Signal<boolean>` — true mientras un PATCH/POST esté en vuelo.
- `actionError: Signal<string | null>` — mensaje de error en español para la última acción fallida (null si no hay error).

#### Scenario: Carga exitosa popula detail y students

- **GIVEN** ambos use-cases resuelven exitosamente
- **WHEN** el VM finaliza la carga
- **THEN** `detail()` es un `TutorExamDetail` no null
- **AND** `students()` es la lista de `ClassroomStudent[]`
- **AND** `loading()` es `false`
- **AND** `error()` es `null`

#### Scenario: enabledStudentIds inicializa desde detail.enabledStudentIds

- **GIVEN** `detail().enabledStudentIds === ["s-1","s-2"]`
- **WHEN** el VM completa la carga
- **THEN** `enabledStudentIds()` es `["s-1","s-2"]`

---

### Requirement: Iniciar examen — lógica de habilitación y manejo de errores (D5)

**Habilitación del botón Iniciar**: el botón "Iniciar" SHALL estar disponible SOLO si `detail().serverStatus.is('scheduled')`. El botón SHALL estar deshabilitado (`disabled`) si `enabledStudentIds().length === 0`. El VM SHALL NOT hacer ninguna llamada HTTP mientras el botón esté deshabilitado.

**Acción**: al presionar "Iniciar", el VM invoca `IniciarExamenUseCase.execute({ recordId })`. En caso de éxito (204 → void), el VM recarga el detalle y la lista (para reflejar el nuevo status). En caso de error, setea `actionError` con el copy en español correspondiente (ver Requirement: Copy de errores por acción).

#### Scenario: Botón Iniciar habilitado solo con scheduled y ≥1 alumno habilitado

- **GIVEN** `detail().serverStatus.value === 'scheduled'` y `enabledStudentIds().length > 0`
- **WHEN** se evalúa el estado del botón "Iniciar"
- **THEN** el botón está habilitado

#### Scenario: Botón Iniciar deshabilitado si 0 alumnos habilitados (D5)

- **GIVEN** `detail().serverStatus.value === 'scheduled'` y `enabledStudentIds().length === 0`
- **WHEN** se evalúa el estado del botón "Iniciar"
- **THEN** el botón está deshabilitado (`disabled`)
- **AND** el VM NOT llama a `IniciarExamenUseCase` mientras esté deshabilitado

#### Scenario: Botón Iniciar NO aparece si status es in_progress o finalized

- **GIVEN** `detail().serverStatus.value === 'in_progress'` o `'finalized'`
- **WHEN** la página renderiza
- **THEN** el botón "Iniciar" no es visible (o está oculto/ausente)

#### Scenario: Iniciar exitoso → status pasa a in_progress

- **GIVEN** `IniciarExamenUseCase.execute()` resuelve con `void`
- **WHEN** el VM procesa el éxito
- **THEN** el VM recarga el detalle
- **AND** `actionError()` es `null`

---

### Requirement: Finalizar examen — idempotencia y manejo de errores

**Habilitación del botón Finalizar**: el botón "Finalizar" SHALL estar disponible SOLO si `detail().serverStatus.is('in_progress')`.

**Acción**: al presionar "Finalizar", el VM SHALL mostrar un diálogo de confirmación antes de invocar `FinalizarExamenUseCase.execute({ recordId })`. En caso de éxito:
- Si `result.transitioned === true` → el examen se finalizó ahora; recargar detail.
- Si `result.transitioned === false` → el examen ya estaba finalizado (idempotente); recargar detail sin mostrar error.
En caso de error, setear `actionError` con el copy correspondiente (ver Requirement: Copy de errores por acción).

#### Scenario: Botón Finalizar habilitado solo con in_progress

- **GIVEN** `detail().serverStatus.value === 'in_progress'`
- **WHEN** se evalúa el estado del botón "Finalizar"
- **THEN** el botón está habilitado

#### Scenario: Botón Finalizar NO aparece si status es scheduled o finalized

- **GIVEN** `detail().serverStatus.value !== 'in_progress'`
- **WHEN** la página renderiza
- **THEN** el botón "Finalizar" no es visible

#### Scenario: Finalizar con transitioned:true — éxito normal

- **GIVEN** `FinalizarExamenUseCase.execute()` resuelve con `{ transitioned: true }`
- **WHEN** el VM procesa el éxito
- **THEN** `actionError()` es `null`
- **AND** el VM recarga el detalle (detail refrescado)

#### Scenario: Finalizar con transitioned:false — idempotente, no es error

- **GIVEN** `FinalizarExamenUseCase.execute()` resuelve con `{ transitioned: false }`
- **WHEN** el VM procesa el resultado
- **THEN** `actionError()` es `null` — no se muestra mensaje de error
- **AND** el VM recarga el detalle (ya estaba finalizado; UI refleja finalized)

---

### Requirement: Habilitar/deshabilitar alumnos — checkboxes y PATCH (D5)

Los alumnos del aula se muestran como una lista de checkboxes:
- El checkbox de cada alumno refleja si su `studentId` está en `enabledStudentIds()`.
- El checkbox de un alumno con `hasSubmitted === true` SHALL estar deshabilitado (no se puede desmarcar — el backend tiraría 409).
- Si `detail().serverStatus.is('finalized')` → todos los checkboxes están deshabilitados (read-only).
- Al cambiar el estado de un checkbox (marcar/desmarcar), el VM actualiza `enabledStudentIds` localmente y dispara `ActualizarAlumnosHabilitadosUseCase.execute({ recordId, enabledStudentIds })`.
- En caso de éxito (200 → void) → noop, la Signal local ya está actualizada.
- En caso de error → revertir `enabledStudentIds` al estado anterior y setear `actionError`.

#### Scenario: Checkbox de alumno con hasSubmitted deshabilitado (D5)

- **GIVEN** un `ClassroomStudent` con `hasSubmitted === true`
- **WHEN** la lista de alumnos se renderiza
- **THEN** el checkbox de ese alumno está `disabled`
- **AND** el usuario no puede desmarcarlo desde la UI

#### Scenario: Checkboxes deshabilitados en modo finalized (D5)

- **GIVEN** `detail().serverStatus.value === 'finalized'`
- **WHEN** la página renderiza
- **THEN** todos los checkboxes de la lista de alumnos están `disabled` (read-only)

#### Scenario: Marcar alumno habilitado — PATCH exitoso

- **GIVEN** `detail().serverStatus.is('scheduled')` y `enabledStudentIds` no contiene `"s-3"`
- **WHEN** el usuario marca el checkbox del alumno `"s-3"`
- **THEN** el VM añade `"s-3"` a `enabledStudentIds()` localmente
- **AND** invoca `ActualizarAlumnosHabilitadosUseCase.execute({ recordId, enabledStudentIds: [..., "s-3"] })`
- **AND** en caso de éxito `actionError()` es `null`

#### Scenario: PATCH falla — enabledStudentIds se revierte

- **GIVEN** `ActualizarAlumnosHabilitadosUseCase.execute()` rechaza con `ExamConflictError`
- **WHEN** el VM procesa el error
- **THEN** `enabledStudentIds()` vuelve al valor que tenía antes del cambio
- **AND** `actionError()` tiene el copy en español para acción "habilitar" + error 409

---

### Requirement: Copy de errores por acción en español (D2)

El VM SHALL seleccionar el mensaje de error (`actionError`) según `acción × tipo-de-error`. El clasificador SHALL:
- Usar el tipo del error de dominio (instancia de la clase de error), NOT el `message` del backend.
- NO hacer comparaciones de strings sobre `body.message` ni `body.code`.

La tabla de copy SHALL ser (valores orientativos — el copy exacto puede ajustarse en implementación, pero la LÓGICA de mapping acción × tipo es la spec):

| Acción | Error | Copy en español |
|---|---|---|
| Iniciar | `ExamPreconditionError` | "No podés iniciar el examen: configurá las claves o habilitá al menos un alumno." |
| Iniciar | `ExamConflictError` | "El examen ya está en curso o finalizado." |
| Iniciar | `VirtualExamNotFoundError` | "No se encontró el examen. Volvé a la lista." |
| Iniciar | `NetworkError` | "Sin conexión. Verificá tu red y volvé a intentar." |
| Iniciar | `TutorExamForbiddenError` | "No tenés permiso para iniciar este examen." |
| Finalizar | `ExamConflictError` | "El examen ya fue finalizado o hubo un conflicto." |
| Finalizar | `ExamPreconditionError` | "El examen no está en curso. Inicialo primero." |
| Finalizar | `VirtualExamNotFoundError` | "No se encontró el examen. Volvé a la lista." |
| Finalizar | `NetworkError` | "Sin conexión. Verificá tu red y volvé a intentar." |
| Finalizar | `TutorExamForbiddenError` | "No tenés permiso para finalizar este examen." |
| Habilitar alumnos | `ExamConflictError` | "Un alumno que ya entregó no puede ser deshabilitado." |
| Habilitar alumnos | `ExamPreconditionError` | "El examen está finalizado. No se pueden cambiar los alumnos." |
| Habilitar alumnos | `VirtualExamNotFoundError` | "No se encontró el examen. Volvé a la lista." |
| Habilitar alumnos | `NetworkError` | "Sin conexión. Los cambios no se guardaron. Intentá de nuevo." |
| Habilitar alumnos | `TutorExamForbiddenError` | "No tenés permiso para modificar los alumnos de este examen." |

#### Scenario: Copy para iniciar × ExamPreconditionError (422)

- **GIVEN** `IniciarExamenUseCase.execute()` rechaza con `ExamPreconditionError`
- **WHEN** el VM procesa el error
- **THEN** `actionError()` contiene un mensaje sobre configuración/alumnos habilitados
- **AND** el copy NOT hace referencia a `body.message` del backend

#### Scenario: Copy para iniciar × ExamConflictError (409)

- **GIVEN** `IniciarExamenUseCase.execute()` rechaza con `ExamConflictError`
- **WHEN** el VM procesa el error
- **THEN** `actionError()` contiene un mensaje sobre el estado actual del examen

#### Scenario: Copy para finalizar × ExamPreconditionError (422)

- **GIVEN** `FinalizarExamenUseCase.execute()` rechaza con `ExamPreconditionError`
- **WHEN** el VM procesa el error
- **THEN** `actionError()` contiene un mensaje indicando que el examen debe iniciarse primero

#### Scenario: Copy para finalizar × NetworkError

- **GIVEN** `FinalizarExamenUseCase.execute()` rechaza con `NetworkError`
- **WHEN** el VM procesa el error
- **THEN** `actionError()` contiene un mensaje sobre falta de conexión
- **AND** `actionError()` NOT es `null`

#### Scenario: Copy para habilitar × ExamConflictError (409)

- **GIVEN** `ActualizarAlumnosHabilitadosUseCase.execute()` rechaza con `ExamConflictError`
- **WHEN** el VM procesa el error
- **THEN** `actionError()` referencia al alumno que ya entregó (o la situación de conflicto)

#### Scenario: Acción exitosa limpia actionError

- **GIVEN** `actionError()` tenía un mensaje previo
- **WHEN** cualquier acción (iniciar/finalizar/habilitar) completa exitosamente
- **THEN** `actionError()` vuelve a `null`

#### Scenario: Clasificador por tipo de error, NOT por body.message

- **WHEN** se inspecciona la lógica de `actionError` en `TutorExamDetailViewModel`
- **THEN** no aparecen comparaciones de strings sobre `body.message` ni `body.code`
- **AND** la selección de copy usa `instanceof ExamPreconditionError`, `instanceof ExamConflictError`, etc.

---

### Requirement: Estado de error de red + reintentar (D3 online-only)

Cuando cualquier carga inicial (detail o classroom students) falla con `NetworkError`, el VM SHALL mostrar un estado de error visible con botón "Reintentar". El botón SHALL invocar de nuevo la carga completa. El VM SHALL NOT enqueue ninguna acción, NOT escribir en IndexedDB.

#### Scenario: Error de red en carga inicial → estado de error con botón reintentar

- **GIVEN** `GetTutorExamDetailUseCase.execute()` rechaza con `NetworkError`
- **WHEN** el VM intenta cargar el detalle
- **THEN** `error()` es `'network'`
- **AND** la UI muestra un mensaje de error y un botón "Reintentar"

#### Scenario: Reintentar dispara nueva carga

- **GIVEN** el VM está en estado `error()` de red
- **WHEN** el usuario presiona "Reintentar"
- **THEN** el VM invoca nuevamente la secuencia de carga completa
- **AND** si tiene éxito, `error()` vuelve a `null`

#### Scenario: VM NOT encola acciones fallidas (D3)

- **GIVEN** `IniciarExamenUseCase.execute()` rechaza con `NetworkError`
- **WHEN** el VM procesa el error
- **THEN** no se escribe nada en IndexedDB
- **AND** no se enqueue ninguna acción en outbox
- **AND** `actionError()` muestra el mensaje de error visible

---

### Requirement: TutorExamDetailPage provee la VM como provider local

`TutorExamDetailPage` SHALL declarar `providers: [TutorExamDetailViewModel]` en su decorador `@Component`. El VM SHALL NOT ser `providedIn: 'root'`.

#### Scenario: VM es local al componente page

- **WHEN** se inspecciona el decorador de `TutorExamDetailPage`
- **THEN** `TutorExamDetailViewModel` aparece en `providers: [...]`
- **AND** TypeScript compila sin error con la inyección del VM en la vista

---

### Requirement: Back button en la pantalla de detalle (iOS standalone PWA)

`TutorExamDetailPage` SHALL mostrar un botón visible "Volver" (data-testid="btn-volver") en la parte superior de la pantalla, SIEMPRE presente (no condicional a la carga ni al estado de error).

El botón SHALL renderizar `<span class="material-symbols-outlined">chevron_left</span>` seguido del texto literal `Volver`, tinted con `var(--color-primary)`, sin borde ni background sólido (transparent), con tap-target mínimo de 44px de altura.

Al presionar el botón, la página SHALL navegar a `/tutor/home` usando `Router.navigate(['/tutor/home'])`. NOT SHALL usar `history.back()`. El método `onVolver()` de `TutorExamDetailPage` SHALL seguir existiendo con la misma signatura que antes del restyle.

(Previously: el botón Volver no tenía icono chevron_left ni estilo tinted; usaba estilo con borde o background sólido.)

**Rationale**: En iOS instalado como PWA standalone no existe gesto del sistema para navegar atrás ni barra de Safari — el usuario queda atrapado si no hay botón de volver explícito. `Router.navigate` funciona incluso en deep-links donde no hay historial previo; `history.back()` en ese caso no hace nada (o navega fuera de la app).

#### Scenario: btn-volver existe en estado normal

- **GIVEN** el examen cargó correctamente
- **WHEN** la página renderiza
- **THEN** existe un botón con data-testid="btn-volver"

#### Scenario: btn-volver existe en estado de error

- **GIVEN** `error()` está seteado (ej. "network")
- **WHEN** la página renderiza
- **THEN** existe un botón con data-testid="btn-volver" (el usuario puede escapar incluso sin datos)

#### Scenario: btn-volver contiene el texto Volver

- **GIVEN** el botón (data-testid="btn-volver") es visible
- **WHEN** se lee su `textContent.trim()`
- **THEN** contiene el string `"Volver"`

#### Scenario: btn-volver navega a /tutor/home

- **GIVEN** el botón (data-testid="btn-volver") es visible
- **WHEN** el usuario hace click
- **THEN** `Router.navigate(['/tutor/home'])` es invocado
- **AND** NOT se invoca `history.back()`

#### Scenario: btn-volver usa Router.navigate (no history.back)

- **WHEN** se inspecciona `TutorExamDetailPage.onVolver()`
- **THEN** el método existe y llama `Router.navigate(['/tutor/home'])`
- **AND** no hay ninguna referencia a `history.back()` en el componente

#### Scenario: btn-volver no tiene border ni background sólido

- **GIVEN** el botón (data-testid="btn-volver") renderiza
- **WHEN** se inspeccionan sus estilos computados
- **THEN** `border` es `none` o equivalente transparent
- **AND** `background` es `transparent` o equivalente sin color sólido

---

## ADDED Requirements

### Requirement: Chip de estado localizado en español

`TutorExamDetailPage` SHALL renderizar el estado del examen dentro de un elemento con data-testid="status-chip". El chip SHALL mostrar ÚNICAMENTE el label en español correspondiente a `detail.status.value`:
- `'scheduled'` → `"Programado"` con clase modificadora BEM `--scheduled`.
- `'in_progress'` → `"En curso"` con clase modificadora BEM `--in-progress`.
- `'finalized'` → `"Finalizado"` con clase modificadora BEM `--finalized`.

El elemento con data-testid="status-chip" SHALL NOT contener elementos `<span class="material-symbols-outlined">` como hijos directos o descendientes — los íconos quedan fuera del contenedor assertable.

El helper `statusChip(status): { label: string; modifier: string }` SHALL vivir en `tutor-exam-detail.page.ts` (no en el view-model).

#### Scenario: Chip scheduled renderiza label Programado

- **GIVEN** `detail.status.value === 'scheduled'`
- **WHEN** `TutorExamDetailPage` renderiza
- **THEN** el elemento (data-testid="status-chip") tiene `textContent.trim() === "Programado"`
- **AND** el elemento tiene la clase modificadora `--scheduled`

#### Scenario: Chip in_progress renderiza label En curso

- **GIVEN** `detail.status.value === 'in_progress'`
- **WHEN** `TutorExamDetailPage` renderiza
- **THEN** el elemento (data-testid="status-chip") tiene `textContent.trim() === "En curso"`
- **AND** el elemento tiene la clase modificadora `--in-progress`

#### Scenario: Chip finalized renderiza label Finalizado

- **GIVEN** `detail.status.value === 'finalized'`
- **WHEN** `TutorExamDetailPage` renderiza
- **THEN** el elemento (data-testid="status-chip") tiene `textContent.trim() === "Finalizado"`
- **AND** el elemento tiene la clase modificadora `--finalized`

#### Scenario: Chip no contiene Material Symbols como hijos

- **GIVEN** cualquier valor de `detail.status.value`
- **WHEN** `TutorExamDetailPage` renderiza
- **THEN** el elemento (data-testid="status-chip") NO tiene descendientes con clase `material-symbols-outlined`

---

### Requirement: Tests de tutor-exam-management son inmutables

Los archivos `tests/feature/LR_render/pages/tutor-exam-detail/**/*.spec.ts` MUST NOT ser modificados por este change. Todos los asserts existentes en esos archivos MUST seguir pasando sin alteración de su código fuente.

#### Scenario: npm test pasa sin modificar specs del detail

- **GIVEN** el restyle es aplicado al HTML, SCSS y TS del detail
- **WHEN** se ejecuta `npm test` con los archivos de spec intactos
- **THEN** todos los tests de `tutor-exam-detail` pasan en verde
- **AND** no se modificó ninguna línea en `tests/feature/LR_render/pages/tutor-exam-detail/`

---

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
