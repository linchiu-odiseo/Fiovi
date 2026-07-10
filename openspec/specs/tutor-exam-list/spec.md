# tutor-exam-list — Specification

## Purpose

Defines the tutor exam list screen: `TutorExamsListViewModel` with 120s polling and tab-visibility pause, `TutorExamsStore` (root singleton for `classroomId` resolution), `TutorExamsListPage` with 3-state status cards, routing at `/tutor/home`, and the complete profile header (name, email, code, classrooms, logout). Depends on `tutor-exams-api` capability.

## Requirements

### Requirement: TutorExamsListViewModel — carga y polling

`TutorExamsListViewModel` (`src/LR_render/tutor/tutor-exams-list/tutor-exams-list.view-model.ts`) SHALL:
- Inyectar `GetTutorExamsUseCase` y `GetProfileUseCase('tutor')`.
- Exponer la Signal `exams: Signal<readonly TutorExam[]>` (inicializa `[]`).
- Exponer la Signal `loading: Signal<boolean>` (inicializa `true` hasta el primer load).
- Exponer la Signal `error: Signal<boolean>` (inicializa `false`).
- Cargar la lista en `ngOnInit` (o en el constructor via `afterNextRender`/`effect`) invocando `GetTutorExamsUseCase.execute()`.
- Publicar la lista cargada en el store compartido (ver Requirement: Store compartido de la lista).
- Sondear la lista cada 120 000 ms (`POLL_INTERVAL_MS = 120_000`) — mismo patrón que `StudentExamsListViewModel`.
- Pausar el polling cuando el tab está oculto (`document.visibilityState === 'hidden'`), reanudarlo al volver a `'visible'`.
- En caso de error de red, setear `error = true` sin interrumpir el polling (el próximo tick intenta de nuevo).

#### Scenario: Lista cargada correctamente al iniciar

- **GIVEN** `GetTutorExamsUseCase.execute()` resuelve con `[exam1, exam2]`
- **WHEN** `TutorExamsListViewModel` se inicializa
- **THEN** `exams()` contiene `[exam1, exam2]`
- **AND** `loading()` es `false`
- **AND** `error()` es `false`

#### Scenario: Error de red — error Signal activa, polling continúa

- **GIVEN** `GetTutorExamsUseCase.execute()` rechaza con `NetworkError`
- **WHEN** el VM intenta cargar la lista
- **THEN** `error()` es `true`
- **AND** `exams()` permanece como estaba antes del error (no se limpia)
- **AND** el próximo tick de polling a los 120 s intenta de nuevo

#### Scenario: Polling se pausa al ocultar el tab

- **GIVEN** el VM tiene polling activo
- **WHEN** `document.visibilityState` cambia a `'hidden'`
- **THEN** el VM NO emite requests HTTP mientras el tab esté oculto

#### Scenario: Polling se reanuda al volver al tab

- **GIVEN** el polling estaba pausado por tab oculto
- **WHEN** `document.visibilityState` cambia a `'visible'`
- **THEN** el VM dispara inmediatamente una carga y reanuda el intervalo 120 s

#### Scenario: Polling cada 120 s emite nuevo request

- **GIVEN** el VM inicializado con datos
- **WHEN** transcurren 120 000 ms
- **THEN** se dispara un nuevo `GetTutorExamsUseCase.execute()`
- **AND** la lista se actualiza con el resultado

---

### Requirement: Store compartido de la lista (TutorExamsStore)

SHALL existir un store compartido de la lista (`src/LR_render/tutor/tutor-exams.store.ts` o similar) que:
- Expose una Signal `list: Signal<readonly TutorExam[]>` (inicializa `[]`).
- Permita a `TutorExamsListViewModel` publicar la lista cargada vía `setList(exams)`.
- Permita a `TutorExamDetailViewModel` leer `classroomId` y `detailId` de un `TutorExam` por `recordId`.
- Sea providedIn root (singleton de sesión, sin IndexedDB, sin persistencia) — cero outbox.

#### Scenario: Store permite resolver classroomId por recordId

- **GIVEN** el store contiene `[{ recordId: "rec-1", classroomId: "cls-1", detailId: "det-1", ... }]`
- **WHEN** `TutorExamDetailViewModel` consulta por `recordId = "rec-1"`
- **THEN** obtiene `classroomId = "cls-1"` y `detailId = "det-1"` sin hacer un request HTTP extra

#### Scenario: Store vacío — classroomId no resuelve desde store

- **GIVEN** el store está vacío (deep-link, primer acceso)
- **WHEN** `TutorExamDetailViewModel` consulta por cualquier `recordId`
- **THEN** la búsqueda retorna `undefined` y el VM activa el fallback (refetch)

#### Scenario: Store actualizado tras polling

- **GIVEN** el polling dispara una nueva carga
- **WHEN** `GetTutorExamsUseCase.execute()` resuelve con una lista actualizada
- **THEN** el store refleja la nueva lista inmediatamente

---

### Requirement: Tarjetas con 3 estados via Signals

`TutorExamsListPage` SHALL renderizar una tarjeta por cada `TutorExam` en `exams()`. Cada tarjeta SHALL reflejar el estado del examen según `serverStatus.value`:
- `'scheduled'` → visual "Programado" (badge + strip con `var(--color-outline)` + card opacity 0.7).
- `'in_progress'` → visual "En curso" (badge + strip con `var(--color-success)`).
- `'finalized'` → visual "Finalizado" (badge + strip distinto según token).
- `count === null` → renderizar `"—"` en lugar del número.
- `courseId` SHALL NOT ser expuesto en el DOM — el elemento `<span class="exam-card__course">` está prohibido.

(Previously: courseId podía renderizarse en `<span class="exam-card__course">{{ exam.courseId }}</span>`; no había strip lateral de color.)

#### Scenario: Lista renderizada en el orden devuelto por el backend

- **GIVEN** `GetTutorExamsUseCase.execute()` resuelve con `[examA, examB, examC]` (en ese orden)
- **WHEN** `TutorExamsListPage` renderiza
- **THEN** las tarjetas aparecen en el orden `[examA, examB, examC]` sin reordenamiento por la UI

#### Scenario: count null renderiza "—"

- **GIVEN** un `TutorExam` con `count === null`
- **WHEN** la tarjeta se renderiza
- **THEN** el campo de número de preguntas muestra `"—"` (no `null`, no `undefined`, no `0`)

#### Scenario: Tarjeta scheduled

- **GIVEN** un `TutorExam` con `serverStatus.value === 'scheduled'`
- **WHEN** la tarjeta se renderiza
- **THEN** el badge/estado muestra "Programado" o equivalente visual

#### Scenario: Tarjeta in_progress

- **GIVEN** un `TutorExam` con `serverStatus.value === 'in_progress'`
- **WHEN** la tarjeta se renderiza
- **THEN** el badge/estado muestra "En curso" o equivalente visual

#### Scenario: Tarjeta finalized

- **GIVEN** un `TutorExam` con `serverStatus.value === 'finalized'`
- **WHEN** la tarjeta se renderiza
- **THEN** el badge/estado muestra "Finalizado" o equivalente visual

#### Scenario: courseId UUID no aparece en el DOM

- **GIVEN** el backend devuelve un exam con `courseId = "0b1e8c0c-041a-4893-b7b9-593592fa6a70"`
- **WHEN** la exam-card se renderiza
- **THEN** el `textContent` de la tarjeta NO contiene el string `"0b1e8c0c"`
- **AND** no existe ningún elemento hijo con clase `exam-card__course`

#### Scenario: Strip scheduled — color outline y card semitransparente

- **GIVEN** un `TutorExam` con `serverStatus.value === 'scheduled'`
- **WHEN** la exam-card se renderiza
- **THEN** el elemento `.card__strip` tiene `background` con `var(--color-outline)`
- **AND** la tarjeta aplica `opacity: 0.7` al contenedor de la card

#### Scenario: Strip in_progress — color success

- **GIVEN** un `TutorExam` con `serverStatus.value === 'in_progress'`
- **WHEN** la exam-card se renderiza
- **THEN** el elemento `.card__strip` tiene `background` con `var(--color-success)`

---

### Requirement: Tap en tarjeta navega a /tutor/exams/:recordId

Al tocar una tarjeta, la app SHALL navegar a `/tutor/exams/<recordId>`. La VM o el componente SHALL usar `Router.navigate(['/tutor/exams', recordId])` o equivalente Angular.

#### Scenario: Tap en tarjeta navega a la ruta de gestión

- **GIVEN** una tarjeta con `recordId = "rec-1"`
- **WHEN** el usuario toca la tarjeta
- **THEN** el router navega a `/tutor/exams/rec-1`

#### Scenario: Tap en tarjeta NOT navega fuera de /tutor

- **GIVEN** una tarjeta cualquiera
- **WHEN** el usuario toca la tarjeta
- **THEN** la URL resultante sigue el patrón `/tutor/exams/<recordId>` (no `/tutor/home/:id` ni rutas del alumno)

---

### Requirement: Ruta /tutor/home — header completo con perfil, aulas y logout

La configuración de rutas SHALL mantener `/tutor/home` cargando `TutorExamsListPage` (lazy `loadComponent`). La página SHALL renderizar el perfil COMPLETO del tutor con jerarquía visual alineada al home del alumno:
- Kicker uppercase 0.75rem/700/letter-spacing 0.05em usando `var(--color-on-surface-variant)`.
- Saludo principal renderizado con `var(--font-display)` 1.625rem/700/letter-spacing -0.01em.
- Fila `.user-info` con ícono+texto para email y código — implementado como `<ul class="user-info">` con Material Symbols (`mail`, `badge`).
- La estructura anterior basada en `<dl>` SHALL ser reemplazada por `.user-info`.

La sección de aulas, la lista de exámenes y el botón de logout siguen presentes con los mismos `data-testid`.

(Previously: la jerarquía visual usaba `<dl>` para el profile-card sin kicker ni jerarquía tipográfica del sistema Native Excellence.)

El VM SHALL inyectar `GetProfileUseCase('tutor')` y exponer:
- `classrooms: Signal<readonly TutorClassroom[]>` — lista de aulas del perfil.
- `classroomCount: Signal<number>` — computed de `classrooms().length`.
- `studentTotal: Signal<number>` — computed de suma de `studentCount` por aula.
- `hasClassrooms: Signal<boolean>` — computed de `classrooms().length > 0`.
- `userCode: Signal<string | null>` — código interno del tutor.
- `profileEmail: Signal<string | null>` — email del perfil (puede diferir del identity email).
- `isSigningOut: Signal<boolean>` — estado de logout en progreso.
- `signOut(): Promise<void>` — invoca `LogoutUseCase.execute()` y navega a `/login`.

El VM SHALL también inyectar `LogoutUseCase` y `GetIdentityUseCase` (fallback de email en estado degraded).

#### Scenario: /tutor/home carga TutorExamsListPage

- **WHEN** el tutor navega a `/tutor/home`
- **THEN** `TutorExamsListPage` se renderiza
- **AND** el header de perfil del tutor es visible
- **AND** la lista de exámenes se carga

#### Scenario: Profile card muestra nombre, email y código del tutor

- **GIVEN** `GetProfileUseCase('tutor')` resuelve con un `TutorProfile`
- **WHEN** `TutorExamsListPage` renderiza
- **THEN** la profile card (data-testid="profile-card") muestra el nombre completo (`firstName lastName`)
- **AND** muestra el `profileEmail` o `userEmail` como fallback
- **AND** muestra el `code` del tutor (DNI / Código)

#### Scenario: profile-card renderiza user-info con íconos mail y badge

- **GIVEN** `GetProfileUseCase('tutor')` resuelve con un `TutorProfile` completo
- **WHEN** `TutorExamsListPage` renderiza el profile-card normal (data-testid="profile-card")
- **THEN** existe un elemento `<ul class="user-info">` dentro del profile-card
- **AND** contiene un `<span class="material-symbols-outlined">` con texto `mail`
- **AND** contiene un `<span class="material-symbols-outlined">` con texto `badge`
- **AND** NO existe ningún elemento `<dl>` dentro del profile-card

#### Scenario: Profile card — skeleton mientras carga

- **GIVEN** `profileLoading()` es `true`
- **WHEN** la página renderiza
- **THEN** se muestra el skeleton (data-testid="profile-skeleton") en lugar de la profile card

#### Scenario: Profile card — degraded cuando perfil no disponible

- **GIVEN** `profileUnavailable()` es `true`
- **WHEN** la página renderiza
- **THEN** se muestra la tarjeta degraded (data-testid="profile-card-degraded") con el email de identity como fallback

#### Scenario: Mis aulas — lista de aulas con nombre, ciclo y alumnos

- **GIVEN** el perfil tiene `classrooms = [aulaA, aulaB]`
- **WHEN** `TutorExamsListPage` renderiza
- **THEN** se muestran dos filas (data-testid="classroom-item")
- **AND** cada fila muestra el `name` del aula
- **AND** cada fila muestra el `cycleName` del aula
- **AND** cada fila muestra el `studentCount` del aula

#### Scenario: Mis aulas — línea de resumen

- **GIVEN** el tutor tiene 2 aulas con 30 y 25 alumnos respectivamente
- **WHEN** la página renderiza
- **THEN** el resumen (data-testid="classrooms-summary") contiene "2" aulas y "55" alumnos

#### Scenario: Mis aulas — empty-state cuando no hay aulas

- **GIVEN** `classrooms()` está vacío
- **WHEN** la página renderiza
- **THEN** se muestra el empty-state (data-testid="classrooms-empty")

#### Scenario: DOM order — perfil y aulas ANTES de los exámenes

- **GIVEN** el perfil y los exámenes están disponibles
- **WHEN** la página renderiza
- **THEN** la profile card (data-testid="profile-card") aparece ANTES de la lista de exámenes (data-testid="exams-list") en el DOM
- **AND** la sección de aulas (data-testid="classrooms-section") aparece ANTES de la lista de exámenes

#### Scenario: Logout — botón "Cerrar sesión" existe y funciona

- **WHEN** la página renderiza
- **THEN** existe el botón de logout (data-testid="btn-logout")

- **GIVEN** el tutor hace click en "Cerrar sesión"
- **WHEN** `signOut()` es invocado
- **THEN** `LogoutUseCase.execute()` es llamado una vez
- **AND** la app navega a `/login`

#### Scenario: Logout — botón disabled durante logout en progreso

- **GIVEN** `isSigningOut()` es `true`
- **WHEN** la página renderiza
- **THEN** el botón (data-testid="btn-logout") está `disabled`

#### Scenario: data-testid existentes conservan elemento raíz y semántica

- **WHEN** se inspecciona el template después del restyle
- **THEN** los data-testid `profile-card`, `profile-card-degraded`, `profile-skeleton`, `classrooms-summary`, `classroom-item`, `classrooms-empty`, `classrooms-section`, `exams-list`, `exam-card`, `status-badge`, `btn-logout` existen en los mismos elementos raíz con la misma semántica assertable que antes del restyle

---

### Requirement: TutorExamsListPage provee la VM como provider local

`TutorExamsListPage` SHALL declarar `providers: [TutorExamsListViewModel]` en su decorador `@Component`. El VM SHALL NOT ser `providedIn: 'root'`.

#### Scenario: VM es local al componente page

- **WHEN** se inspecciona el decorador de `TutorExamsListPage`
- **THEN** `TutorExamsListViewModel` aparece en `providers: [...]`
- **AND** `TutorExamsListViewModel` no tiene `providedIn: 'root'` en su decorador (si lo tiene)

---

## ADDED Requirements

### Requirement: Tests de tutor-exam-list son inmutables

Los archivos `tests/feature/LR_render/pages/tutor-exams-list/**/*.spec.ts` MUST NOT ser modificados por este change. Todos los asserts existentes en esos archivos MUST seguir pasando sin alteración de su código fuente.

#### Scenario: npm test pasa sin modificar specs del listado

- **GIVEN** el restyle es aplicado al HTML y SCSS del listado
- **WHEN** se ejecuta `npm test` con los archivos de spec intactos
- **THEN** todos los tests de `tutor-exams-list` pasan en verde
- **AND** no se modificó ninguna línea en `tests/feature/LR_render/pages/tutor-exams-list/`
