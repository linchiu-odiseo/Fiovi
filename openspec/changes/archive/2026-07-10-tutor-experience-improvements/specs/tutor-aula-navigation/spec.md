# Delta for tutor-aula-navigation

## ADDED Requirements

### Requirement: Ruta /tutor/aulas/:classroomId — cursos del aula

La configuración de rutas (`src/LR_render/app.routes.ts`) SHALL exponer `/tutor/aulas/:classroomId` protegida por `authGuard + roleGuard('tutor')` y cargando `TutorAulaCoursesPage` mediante `loadComponent`.

`TutorAulaCoursesPage` SHALL renderizar:
- Botón "Volver" (`[data-testid="btn-volver"]`) con ícono `chevron_left` que navega a `/tutor/home`.
- Header con kicker `"Aula"` + `<h1>` con `vm.classroomName() ?? "Aula sin nombre"`.
- Sección "Cursos" con lista `[data-testid="courses-list"]` de tarjetas por curso, o el copy `"Esta aula todavía no tiene exámenes."` en `[data-testid="courses-empty"]`.
- Estados: loading (`aria-busy`), error `"network"` con botón `[data-testid="btn-retry"]`, error `"notFound"` con copy `"No encontramos esta aula en tu perfil."`.

`TutorAulaCoursesViewModel` (`src/LR_render/view-models/tutor-aula-courses.view-model.ts`) SHALL:
- Inyectar `ActivatedRoute`, `Router`, `GetTutorExamsUseCase`, `GetProfileUseCase`, `TutorExamsStore`.
- Exponer `classroomId`, `classroomName`, `loading`, `error` como signals.
- Exponer `courses: computed<readonly AulaCourseItem[]>` donde `AulaCourseItem = { name: string; examCount: number }`.
- Warm path: si `store.exams().length > 0`, NO llama al back — deriva `courses` filtrando por `classroomId` y agrupando por `exam.course ?? 'Sin curso'`.
- Cold path (store vacío): llama `GetTutorExamsUseCase.execute()` una sola vez y hace `store.setExams(list)`.
- Resuelve `classroomName` desde `GetProfileUseCase('tutor')`; si el aula no existe en el profile → setea `error = 'notFound'`; si el profile no está disponible → deja `classroomName` en null y sigue funcional.
- `goToCourse(course)` navega a `/tutor/aulas/:classroomId/curso/:course`.
- `goBack()` navega a `/tutor/home`.

#### Scenario: Ruta protegida por authGuard + roleGuard('tutor')

- **WHEN** se inspecciona la ruta `/tutor/aulas/:classroomId` en `app.routes.ts`
- **THEN** su `canActivate` incluye `authGuard` y `roleGuard('tutor')`

#### Scenario: Warm path — no llama al back si el store ya está poblado

- **GIVEN** `store.exams().length > 0`
- **WHEN** `vm.load()` es invocado
- **THEN** `GetTutorExamsUseCase.execute` NO es llamado

#### Scenario: Cold path — llama al back cuando el store está vacío

- **GIVEN** `store.exams().length === 0`
- **WHEN** `vm.load()` es invocado
- **THEN** `GetTutorExamsUseCase.execute` es llamado exactamente una vez
- **AND** el resultado se pushea al store con `store.setExams(list)`

#### Scenario: Agrupación por course con clave "Sin curso" para null

- **GIVEN** el store tiene 3 exámenes en `classroomId = "cls-1"`: dos con `course: "Álgebra"` y uno con `course: null`
- **WHEN** `vm.courses()` computa
- **THEN** retorna `[{ name: "Álgebra", examCount: 2 }, { name: "Sin curso", examCount: 1 }]`

#### Scenario: Aula no encontrada en profile → error notFound

- **GIVEN** el profile del tutor NO incluye `cls-1` en `classrooms`
- **WHEN** `vm.load()` termina de resolver `classroomName`
- **THEN** `vm.error()` es `'notFound'`

#### Scenario: goBack navega a /tutor/home

- **WHEN** `vm.goBack()` es invocado
- **THEN** `Router.navigate` es llamado con `['/tutor/home']`

---

### Requirement: Ruta /tutor/aulas/:classroomId/curso/:course — exámenes del curso

La ruta `/tutor/aulas/:classroomId/curso/:course` SHALL cargar `TutorAulaCourseExamsPage` (lazy), protegida por `authGuard + roleGuard('tutor')`.

`TutorAulaCourseExamsPage` SHALL renderizar:
- Botón "Volver" que navega a `/tutor/aulas/:classroomId`.
- Header con kicker `"Curso"` + `<h1>` con `vm.course()`.
- Lista `[data-testid="exams-list"]` de `[data-testid="exam-card"]`, cada card con nombre, badge de estado (`Programado / En curso / Finalizado`), área (si existe), count, duración en minutos.
- Empty state `[data-testid="exams-empty"]` con copy `"No hay exámenes de este curso en esta aula."`.
- Estados de loading y error análogos a `TutorAulaCoursesPage`.

`TutorAulaCourseExamsViewModel` SHALL:
- Exponer `classroomId`, `course`, `loading`, `error` como signals.
- Exponer `exams: computed<readonly TutorExam[]>` filtrando `store.exams()` por `classroomId` y comparando `exam.course ?? 'Sin curso' === course` (URL param).
- Ordenar por `scheduled` desc (`.getTime()`) para mostrar los más recientes primero.
- Warm path como en `TutorAulaCoursesViewModel`.
- `goToExam(exam)` navega a `/tutor/exams/:recordId`.
- `goBack()` navega a `/tutor/aulas/:classroomId`.

#### Scenario: Filtro por classroomId y course

- **GIVEN** store con 4 exámenes:
  - A: `classroomId="cls-1"`, `course="Álgebra"`
  - B: `classroomId="cls-1"`, `course="Geometría"`
  - C: `classroomId="cls-2"`, `course="Álgebra"`
  - D: `classroomId="cls-1"`, `course=null`
- **WHEN** ruta activa es `cls-1 / "Álgebra"` y `vm.exams()` computa
- **THEN** retorna únicamente `[A]`

#### Scenario: `"Sin curso"` como URL param mapea a `course: null`

- **GIVEN** un examen con `classroomId="cls-1"`, `course: null`
- **WHEN** ruta activa es `cls-1 / "Sin curso"` y `vm.exams()` computa
- **THEN** el examen aparece en la lista

#### Scenario: Orden por scheduled desc

- **GIVEN** dos exámenes del mismo aula+curso con `scheduled` en `2026-07-01T10:00` y `2026-07-05T10:00`
- **WHEN** `vm.exams()` computa
- **THEN** el primero del array es el de `2026-07-05T10:00`

#### Scenario: goToExam navega al detail

- **GIVEN** un exam con `recordId = "rec-1"`
- **WHEN** `vm.goToExam(exam)` es invocado
- **THEN** `Router.navigate` es llamado con `['/tutor/exams', 'rec-1']`

#### Scenario: goBack navega al aula (cursos)

- **GIVEN** `classroomId = "cls-1"`
- **WHEN** `vm.goBack()` es invocado
- **THEN** `Router.navigate` es llamado con `['/tutor/aulas', 'cls-1']`
