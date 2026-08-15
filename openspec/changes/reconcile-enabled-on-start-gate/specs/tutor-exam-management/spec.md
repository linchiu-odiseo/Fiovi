# Delta for tutor-exam-management

> Este delta extiende la capability existente `tutor-exam-management`.
> Al archivar este change, los requirements ADDED debajo se mergean en `openspec/specs/tutor-exam-management/spec.md`.
> Change: `reconcile-enabled-on-start-gate` — iniciado 2026-08-15.

## Context

La capability `tutor-exam-management` ya define `TutorExamDetailViewModel` con signals de carga, detalle, alumnos, acciones de iniciar/finalizar/habilitar, y `TutorExamDetailPage` con su template (ver `openspec/specs/tutor-exam-management/spec.md`). Este delta agrega el gate de reconciliación de alumnos habilitados que se activa cuando el examen está en status `scheduled`.

El gate no interfiere con ningún signal, computed, effect ni método existente del VM. La lógica de countdown ticker, D1 cold/warm store resolution, effect diferido con jitter, y optimistic updates + rollback de checkboxes permanecen exactamente iguales.

## Non-goals explícitos (UNCHANGED)

Los siguientes elementos del VM y la página NO deben modificarse como parte de este change:

- Countdown ticker.
- D1 cold/warm store resolution (GetTutorExamsUseCase → classroomId).
- Effect diferido con jitter para thundering herd.
- Optimistic updates + rollback de checkboxes (`enabledStudentIds`, `ActualizarAlumnosHabilitadosUseCase`).
- Métodos existentes: `iniciar`, `finalizar`, `archivar`, `toggleStudent`, `openIniciarModal`, `confirmIniciarModal`, `openFinalizarModal`, `confirmFinalizarModal`, y cualquier otro método público declarado antes de este change.
- El contrato público del VM (ninguna firma existente cambia).
- Rutas, `authGuard`, `roleGuard('tutor')`.
- La vista del alumno.

## ADDED Requirements

---

### Requirement: REQ-VM-1 — Signal `gateState` en `TutorExamDetailViewModel`

`TutorExamDetailViewModel` SHALL exponer:

- Un signal privado interno `_gateState: WritableSignal<'idle' | 'refreshing' | 'ready'>`, inicializado en `'idle'`.
- Un signal público readonly `gateState: Signal<'idle' | 'refreshing' | 'ready'>` derivado de `_gateState.asReadonly()`.

El signal es completamente local al VM — sin persistencia en `localStorage`, `sessionStorage`, `IndexedDB`, ni en ningún store o context compartido. Su única fuente de verdad es la instancia del VM en memoria.

Los 3 valores posibles:
- `'idle'` — estado inicial al montar el componente; el gate está activo y esperando acción del tutor.
- `'refreshing'` — la llamada a `refreshEnabled` está en vuelo.
- `'ready'` — la llamada completó exitosamente; el gate está superado.

#### Scenario: `gateState` inicia en `'idle'` al montar el VM

- **GIVEN** se monta `TutorExamDetailPage` para un examen cualquiera
- **WHEN** el VM se inicializa
- **THEN** `vm.gateState()` es `'idle'`

#### Scenario: `gateState` es readonly públicamente

- **WHEN** se inspecciona la API pública del VM
- **THEN** `gateState` expone solo `Signal<...>` (no `WritableSignal`)
- **AND** `_gateState` no es accesible desde fuera del VM

---

### Requirement: REQ-VM-2 — Computed `showRoster` en `TutorExamDetailViewModel`

`TutorExamDetailViewModel` SHALL exponer `showRoster: Signal<boolean>` (computed) con la siguiente lógica:

- Retorna `true` cuando `detail().status.value !== 'scheduled'`.
- Retorna `true` cuando `detail().status.value === 'scheduled'` Y `gateState() === 'ready'`.
- Retorna `false` solo cuando `detail().status.value === 'scheduled'` Y `gateState() !== 'ready'` (es decir, `'idle'` o `'refreshing'`).

`detail()` puede ser `null` durante la carga inicial; cuando es `null`, `showRoster` SHALL retornar `false` (el roster no es mostrable sin datos).

El computed NO modifica ningún otro computed existente (countdown, enabledCount, totalStudents, etc.).

#### Scenario: `showRoster` es `false` para examen `scheduled` en estado `idle`

- **GIVEN** `detail().status.value === 'scheduled'`
- **AND** `gateState() === 'idle'`
- **WHEN** se evalúa `vm.showRoster()`
- **THEN** retorna `false`

#### Scenario: `showRoster` es `false` para examen `scheduled` en estado `refreshing`

- **GIVEN** `detail().status.value === 'scheduled'`
- **AND** `gateState() === 'refreshing'`
- **WHEN** se evalúa `vm.showRoster()`
- **THEN** retorna `false`

#### Scenario: `showRoster` es `true` para examen `scheduled` en estado `ready`

- **GIVEN** `detail().status.value === 'scheduled'`
- **AND** `gateState() === 'ready'`
- **WHEN** se evalúa `vm.showRoster()`
- **THEN** retorna `true`

#### Scenario: `showRoster` es `true` para examen `in_progress` (sin gate)

- **GIVEN** `detail().status.value === 'in_progress'`
- **AND** `gateState()` tiene cualquier valor
- **WHEN** se evalúa `vm.showRoster()`
- **THEN** retorna `true`

#### Scenario: `showRoster` es `true` para examen `finalized` (sin gate)

- **GIVEN** `detail().status.value === 'finalized'`
- **AND** `gateState()` tiene cualquier valor
- **WHEN** se evalúa `vm.showRoster()`
- **THEN** retorna `true`

#### Scenario: `showRoster` es `false` cuando `detail()` es `null`

- **GIVEN** `detail()` es `null` (carga en progreso o error)
- **WHEN** se evalúa `vm.showRoster()`
- **THEN** retorna `false`

---

### Requirement: REQ-VM-3 — Método `handleRefresh()` en `TutorExamDetailViewModel`

`TutorExamDetailViewModel` SHALL exponer el método `handleRefresh(): Promise<void>`. La secuencia obligatoria es:

1. Setea `_gateState` a `'refreshing'`.
2. Invoca `RefreshHabilitadosUseCase.execute(recordId)`.
3. **En éxito**: setea `_gateState` a `'ready'`. Luego dispara `reloadDetail()` (mecanismo existente de recarga del detalle) para que la lista renderizada refleje los alumnos nuevamente habilitados. `actionError` se limpia a `null`.
4. **En `ExamConflictError` (409)**: setea `_gateState` a `'idle'`. Setea `actionError` con el copy en español para este caso (ver tabla de copy).
5. **En `NetworkError` u otro error**: setea `_gateState` a `'idle'`. Setea `actionError` con el copy en español correspondiente.

El método solo debe ser invocado cuando `gateState() === 'idle'`. La UI lo garantiza al deshabilitar el botón durante `'refreshing'` (REQ-PAGE-2). El VM no necesita guardia interna adicional, pero la implementación SHOULD ser idempotente ante llamadas concurrentes.

#### Scenario: Transición A→B en éxito (`idle` → `refreshing` → `ready`)

- **GIVEN** `detail().status.value === 'scheduled'` y `gateState() === 'idle'`
- **AND** `RefreshHabilitadosUseCase.execute("rec-1")` resuelve con `{ addedCount: 3, totalEnabledCount: 12 }`
- **WHEN** `vm.handleRefresh()` se invoca
- **THEN** durante la llamada asíncrona `gateState()` es `'refreshing'`
- **AND** al resolver `gateState()` es `'ready'`
- **AND** `vm.showRoster()` es `true`
- **AND** `reloadDetail()` se dispara para traer la lista actualizada
- **AND** `vm.actionError()` es `null`

#### Scenario: Transición A→A en `ExamConflictError` (409)

- **GIVEN** `gateState() === 'idle'`
- **AND** `RefreshHabilitadosUseCase.execute("rec-1")` rechaza con `ExamConflictError`
- **WHEN** `vm.handleRefresh()` se invoca y completa
- **THEN** `gateState()` vuelve a `'idle'`
- **AND** `vm.showRoster()` es `false`
- **AND** `vm.actionError()` contiene un mensaje en español sobre el estado del examen

#### Scenario: Transición A→A en `NetworkError`

- **GIVEN** `gateState() === 'idle'`
- **AND** `RefreshHabilitadosUseCase.execute("rec-1")` rechaza con `NetworkError`
- **WHEN** `vm.handleRefresh()` se invoca y completa
- **THEN** `gateState()` vuelve a `'idle'`
- **AND** `vm.actionError()` contiene un mensaje en español sobre falta de conexión

---

### Requirement: REQ-VM-4 — Reset natural del gate por desmontaje (sin persistencia)

El signal `_gateState` vive exclusivamente en la instancia del VM. Al destruirse el componente `TutorExamDetailPage` (por navegación, refresh de browser, cierre de tab), la instancia del VM se destruye junto.

Al re-montar el componente (volver a navegar a `/tutor/exams/:recordId`), el VM se re-crea y `_gateState` comienza nuevamente en `'idle'`.

SHALL NOT usarse `localStorage`, `sessionStorage`, `IndexedDB`, Context compartido, ni ningún servicio singleton para persistir el valor de `gateState`.

#### Scenario: Al re-montar, el gate vuelve a `idle`

- **GIVEN** un tutor en `/tutor/exams/rec-1` con `gateState() === 'ready'`
- **WHEN** el tutor navega a `/tutor/home` y luego vuelve a `/tutor/exams/rec-1`
- **THEN** `vm.gateState()` es `'idle'` (nueva instancia del VM)
- **AND** el DOM muestra el Estado A del gate (card "Actualizar lista antes de iniciar")

#### Scenario: `gateState` NO persiste en ningún storage

- **WHEN** se inspecciona `TutorExamDetailViewModel`
- **THEN** no hay ninguna escritura a `localStorage`, `sessionStorage`, `IDBObjectStore`, ni a ningún store/context compartido relacionado con `gateState`

---

### Requirement: REQ-VM-5 — Contratos existentes del VM son inmutables

Los siguientes elementos del VM SHALL NOT ser modificados por este change:

- La signatura de todos los métodos públicos existentes.
- Los computeds `enabledCount`, `totalStudents`, `pendingTotalSeconds`, `durationError`.
- El effect diferido con jitter para thundering herd.
- La estrategia D1 de resolución de `classroomId`.
- La lógica de optimistic updates + rollback en `enabledStudentIds`.
- Los signals `loading`, `error`, `isSaving`, `actionError` (forma, no valor), `enabledStudentIds`, `detail`, `students`.
- Los signals de los modales: `iniciarModalOpen`, `finalizarModalOpen`, `pendingMinutes`, `pendingSeconds`.

Este requirement aplica también a los tests existentes en `tests/feature/LR_render/pages/tutor-exam-detail/`: todos deben seguir pasando sin modificar su código fuente.

#### Scenario: Tests existentes del detail pasan sin modificar sus fuentes

- **GIVEN** el gate es implementado en el VM y el template
- **WHEN** se ejecuta el suite de tests de `tutor-exam-detail`
- **THEN** todos los tests existentes pasan en verde
- **AND** no se modificó ninguna línea en los archivos `.spec.ts` del detail

---

### Requirement: REQ-PAGE-1 — Conditional render en `tutor-exam-detail.page.html`

`tutor-exam-detail.page.html` SHALL envolver el bloque del roster y los botones "Finalizar"/"Archivar" en `@if (vm.showRoster())`.

Cuando `vm.showRoster()` es `false` (Estado A del gate — examen `scheduled`, `gateState` no `ready`):

- SHALL renderizar un card con el título `"Actualizar lista antes de iniciar"`.
- SHALL renderizar un único botón CTA dentro del card (ver REQ-PAGE-2 para el detalle del botón).
- SHALL NOT renderizar el roster de alumnos.
- SHALL NOT renderizar los botones "Finalizar" ni "Archivar".
- El botón "Iniciar examen" (que abre el modal de duración) SHALL NOT estar presente.

Cuando `vm.showRoster()` es `true` (Estado B ready, o examen `in_progress` / `finalized`):

- SHALL renderizar el roster completo actual (sin cambios en su estructura interna).
- SHALL renderizar el botón "Iniciar examen" si `detail().status.value === 'scheduled'` (condicional ya existente).
- SHALL renderizar los botones "Finalizar"/"Archivar" según el status actual (comportamiento preexistente).

#### Scenario: Estado A — DOM cuando examen es `scheduled` y `gateState` es `idle`

- **GIVEN** un tutor autenticado con rol tutor
- **AND** un examen "E" con `status === 'scheduled'`
- **WHEN** navega a `/tutor/exams/E` y el VM inicializa
- **THEN** `vm.gateState()` es `'idle'`
- **AND** `vm.showRoster()` es `false`
- **AND** el DOM contiene un card con el texto `"Actualizar lista antes de iniciar"`
- **AND** el DOM NO contiene la lista de alumnos habilitados/deshabilitados
- **AND** el DOM NO contiene el botón de finalizar (`[data-testid="btn-finalizar"]`)
- **AND** el DOM NO contiene el botón de archivar (si existe en el template)

#### Scenario: Estado B — DOM cuando `showRoster` es `true` por gate completado

- **GIVEN** un examen con `status === 'scheduled'` y `vm.gateState() === 'ready'`
- **WHEN** la página renderiza
- **THEN** el DOM contiene la lista de alumnos
- **AND** el DOM contiene el botón `[data-testid="btn-iniciar"]` (abre el modal)
- **AND** `vm.showRoster()` es `true`

#### Scenario: Examen `in_progress` — roster visible sin gate

- **GIVEN** un tutor que navega a un examen con `status === 'in_progress'`
- **WHEN** la página renderiza
- **THEN** `vm.showRoster()` es `true` (sin importar `gateState`)
- **AND** el DOM contiene la lista de alumnos
- **AND** el DOM contiene el botón `[data-testid="btn-finalizar"]`
- **AND** el DOM NO contiene el card `"Actualizar lista antes de iniciar"`

#### Scenario: Examen `finalized` — roster visible sin gate

- **GIVEN** un tutor que navega a un examen con `status === 'finalized'`
- **WHEN** la página renderiza
- **THEN** `vm.showRoster()` es `true` (sin importar `gateState`)
- **AND** el DOM contiene la lista de alumnos en modo read-only
- **AND** el DOM NO contiene el card `"Actualizar lista antes de iniciar"`

---

### Requirement: REQ-PAGE-2 — CTA transformable — un solo botón con label y handler derivados de `gateState`

El CTA principal de la página SHALL ser implementado como un **único elemento `<button>`** cuyo label y handler se derivan del estado combinado `{ gateState, status }`. No son dos botones distintos con `@if` separados.

Los tres estados del botón único:

| Condición | Label | Handler | Estado disabled |
|---|---|---|---|
| `status === 'scheduled'` Y `gateState === 'idle'` | `"Actualizar lista"` | `vm.handleRefresh()` (via `onRefresh()` en el page) | `false` |
| `status === 'scheduled'` Y `gateState === 'refreshing'` | `"Actualizando..."` | ninguno (disabled) | `true` |
| `status === 'scheduled'` Y `gateState === 'ready'` | `"Iniciar examen"` | `vm.openIniciarModal()` | según `canIniciar()` |

Cuando `status !== 'scheduled'` (examen `in_progress` o `finalized`), el CTA transformable NO aplica — los botones de acción en esos estados siguen el comportamiento preexistente y el gate card no se muestra.

El botón EXISTS solo cuando `vm.showRoster()` es `false` (Estado A/refreshing del gate). Cuando `vm.showRoster()` es `true` y `status === 'scheduled'`, el botón que abre el modal de iniciar es el existente `[data-testid="btn-iniciar"]` — puede ser el mismo elemento reutilizado o estar dentro del bloque `@if (vm.showRoster())`.

El page SHALL exponer el método `onRefresh(): void` que invoca `vm.handleRefresh()`.

#### Scenario: Botón muestra "Actualizar lista" en Estado A

- **GIVEN** `vm.showRoster()` es `false` (examen scheduled, gateState idle)
- **WHEN** el DOM renderiza
- **THEN** existe un botón con texto `"Actualizar lista"`
- **AND** el botón NO está disabled
- **AND** al hacer click, se invoca `onRefresh()` del page

#### Scenario: Botón muestra "Actualizando..." y queda disabled durante refreshing

- **GIVEN** `vm.gateState()` es `'refreshing'`
- **WHEN** el DOM renderiza
- **THEN** el botón CTA muestra el texto `"Actualizando..."`
- **AND** el botón tiene el atributo `disabled`

#### Scenario: Botón muestra "Iniciar examen" en Estado B con status scheduled

- **GIVEN** `vm.showRoster()` es `true` y `detail().status.value === 'scheduled'`
- **WHEN** el DOM renderiza
- **THEN** existe un botón que abre el modal de iniciar (ya sea el botón transformado o `[data-testid="btn-iniciar"]`)
- **AND** el texto del CTA visible es equivalente a `"Iniciar examen"` (o el label preexistente del btn-iniciar)

#### Scenario: `onRefresh` en el page delega a `vm.handleRefresh`

- **WHEN** se inspecciona `TutorExamDetailPage.onRefresh()`
- **THEN** el método invoca `this.vm.handleRefresh()` (o equivalente)

---

### Requirement: REQ-PAGE-3 — Gate NO aplica a exámenes `in_progress` ni `finalized`

El gate de reconciliación es exclusivo para exámenes con `status === 'scheduled'`. Para cualquier otro status:

- El bloque `@if (vm.showRoster())` retorna `true` (via el computed del VM) y el roster es siempre visible.
- No se renderiza el card "Actualizar lista antes de iniciar".
- No se renderiza el botón "Actualizar lista".
- Los botones de acción propios de cada status (finalizar en `in_progress`, archivar en `finalized`) se mantienen igual.
- Los checkboxes de alumnos funcionan según el comportamiento preexistente (toggleables en `in_progress` con confirmación, read-only en `finalized`).

Este requirement es consecuencia directa del computed `showRoster` (REQ-VM-2) y el conditional render (REQ-PAGE-1), pero se declara explícitamente para que sea verificable en un test de feature.

#### Scenario: Tutor en examen `in_progress` — flujo sin gate, checkboxes toggleables

- **GIVEN** un examen con `status === 'in_progress'`
- **WHEN** el tutor navega a la página
- **THEN** el roster es visible inmediatamente (`vm.showRoster() === true`)
- **AND** los checkboxes de alumnos sin `hasSubmitted` son interactuables
- **AND** el botón `[data-testid="btn-finalizar"]` es visible
- **AND** NO existe el card "Actualizar lista antes de iniciar"
- **AND** `vm.handleRefresh` no es invocado automáticamente

#### Scenario: Tutor en examen `finalized` — flujo sin gate, checkboxes read-only

- **GIVEN** un examen con `status === 'finalized'`
- **WHEN** el tutor navega a la página
- **THEN** el roster es visible inmediatamente (`vm.showRoster() === true`)
- **AND** todos los checkboxes están disabled (read-only según comportamiento preexistente)
- **AND** NO existe el card "Actualizar lista antes de iniciar"

---

### Requirement: Copy de errores del gate en español

El VM SHALL seleccionar `actionError` para los errores de `handleRefresh()` según tipo de error. La clasificación SHALL usar `instanceof` sobre la clase de error de dominio — NOT leer `body.message` ni `body.code`.

La tabla de copy para esta acción SHALL ser:

| Acción | Error | Copy en español |
|---|---|---|
| Actualizar lista | `ExamConflictError` | "El examen ya fue iniciado. Recargá la página para ver el estado actual." |
| Actualizar lista | `NetworkError` | "Sin conexión. Verificá tu red y volvé a intentar." |
| Actualizar lista | `VirtualExamNotFoundError` | "No se encontró el examen. Volvé a la lista." |
| Actualizar lista | `TutorExamForbiddenError` | "No tenés permiso para actualizar la lista de este examen." |
| Actualizar lista | `ExamPreconditionError` | "Hay un problema con los datos del examen. Volvé a la lista." |

(El copy exacto puede ajustarse en implementación; la lógica de mapping acción × tipo es la spec.)

#### Scenario: Copy correcto para `handleRefresh` × `ExamConflictError`

- **GIVEN** `RefreshHabilitadosUseCase.execute()` rechaza con `ExamConflictError`
- **WHEN** el VM procesa el error
- **THEN** `actionError()` contiene un mensaje sobre el examen ya iniciado / estado no compatible
- **AND** `gateState()` es `'idle'`

#### Scenario: Copy correcto para `handleRefresh` × `NetworkError`

- **GIVEN** `RefreshHabilitadosUseCase.execute()` rechaza con `NetworkError`
- **WHEN** el VM procesa el error
- **THEN** `actionError()` contiene un mensaje sobre falta de conexión
- **AND** `gateState()` es `'idle'`

#### Scenario: Acción exitosa limpia `actionError`

- **GIVEN** `actionError()` tenía un mensaje previo (de un intento fallido)
- **WHEN** `RefreshHabilitadosUseCase.execute()` resuelve exitosamente
- **THEN** `actionError()` es `null`

#### Scenario: Clasificación por tipo, NOT por `body.message`

- **WHEN** se inspecciona la lógica de `actionError` para `handleRefresh` en el VM
- **THEN** no aparecen comparaciones de strings sobre `body.message` ni `body.code`
- **AND** la selección de copy usa `instanceof ExamConflictError`, `instanceof NetworkError`, etc.
