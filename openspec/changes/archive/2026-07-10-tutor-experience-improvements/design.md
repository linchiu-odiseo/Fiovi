# Design: Tutor Experience Improvements

## 1. TutorExam schema — snapshots plain-text

**Antes:** `entryId`, `courseId` (UUID), `createdAt`.
**Después:** `course` (string plain-text | null), `area` (string plain-text | null), `scheduled` (Date).

Rationale: el back guarda `course` y `area` como snapshots en `virtual_exam_detail` al crear el examen — no hay resolución UUID en cliente. Esto permite agrupar por curso/área en cliente **sin request extra ni JOIN**. `scheduled` reemplaza `createdAt` porque semánticamente es el momento en que se programó el examen (created_at del traceability record), coincide con el `scheduled` que ve el alumno.

Getter derivado: `durationInMinutes = Math.round(duration / 60)` para presentar en UI.

`TutorExamDetail` recibe `course`/`area` en el mismo shape (pero NO trae `scheduled` — el detail no lo devuelve).

## 2. Aula → Curso → Examen navigation

Rutas:
- `/tutor/aulas/:classroomId` → cursos del aula.
- `/tutor/aulas/:classroomId/curso/:course` → exámenes filtrados.

VMs comparten patrón:
- Warm path: si `store.exams().length > 0`, no hacen request (el home tutor ya llenó el store).
- Cold path (deep-link, hard refresh): llaman `GetTutorExamsUseCase` una vez y llenan el store.
- Filtrado/agrupación es `computed()` derivado de `store.exams()` — reactivo a cualquier upsert del store.

`TutorAulaCoursesViewModel` agrupa por `exam.course ?? 'Sin curso'` con `Map<string, number>` acumulando `examCount`.
`TutorAulaCourseExamsViewModel` filtra por `(classroomId, course === course ?? 'Sin curso')` y ordena por `scheduled` desc.

Nombre del aula: se resuelve vía `GetProfileUseCase('tutor')` — si el perfil no está disponible (`ProfileNotAvailableError`), la lista sigue siendo funcional (solo pierde el `<h1>` con el nombre).

## 3. Modal Iniciar — edición mm+ss con validación

Estado en el VM (`TutorExamDetailViewModel`):
- `iniciarModalOpen: signal<boolean>`
- `pendingMinutes: signal<number | null>` / `pendingSeconds: signal<number | null>`
- `pendingTotalSeconds: computed<number | null>` — devuelve null si los inputs no son enteros válidos
- `durationError: signal<string | null>`
- Constantes: `DURATION_MIN_SECONDS = 60`, `DURATION_MAX_SECONDS = 7200`.

Flow:
1. `openIniciarModal()` precarga mm+ss desde `detail().duration`.
2. Tutor edita — el page parsea `<input type="number">` con `parseIntInput` que rechaza no-enteros, non-finite, y vacío.
3. `confirmIniciarModal()` valida: `s ∈ [0, 59]`, `m ≥ 0`, `total ∈ [60, 7200]`. Si el total no cambió respecto al `detail().duration`, `override` queda `undefined` → el back no recibe body (mantiene la duración original); si cambió, envía `{ duration: totalSeconds }`.

Fallback UI: `formatMmSs(seconds)` retorna `"m:ss"` con `String(s).padStart(2, '0')`, `"—"` cuando el total no está calculable.

## 4. Modal Finalizar — confirmación explícita

Estado: `finalizarModalOpen: signal<boolean>`. Handlers: `openFinalizarModal / cancelFinalizarModal / confirmFinalizarModal`. El botón "Sí, finalizar" queda `[disabled]="vm.isSaving()"` para prevenir double-tap.

Rationale: finalizar antes de tiempo congela el enabled set y dispara el grader — es irreversible. UX exige confirmación explícita.

## 5. Home tutor — solo in_progress + navegación aula

`examsInProgress = computed(() => exams().filter(e => e.serverStatus.value === 'in_progress'))` reemplaza el listado completo en el DOM. Los `scheduled` y `finalized` viven bajo la jerarquía aula→curso — el home resalta "qué está corriendo AHORA" para acceso rápido.

Aula cards ganan `(click)`, `(keydown.enter)`, `role="button"`, `tabindex="0"` y navegan por Router a `/tutor/aulas/:classroomId`.

Integración PWA: reutiliza `<app-update-banner>` + `<app-update-confirm-modal>` + `<app-version-footer>` — mismo pattern que `home.page.ts` del alumno. El VM inyecta `PwaUpdateService` (L3) siguiendo el precedente ya establecido para `pwa-shell-update`.

## 6. Detail tutor — metadata rica en el header

El header pasa a mostrar (todos condicionales por `@if` a excepción de count/duration que siempre existen):

- Área (chip `category`)
- Curso (chip `menu_book`)
- Count (`quiz`) — `"N preguntas"` o `"Preguntas: pendientes"` si `count === null`
- Duración (`timer`) — `"N min"` derivado de `duration / 60`
- Iniciado (`play_arrow`) — `formatDateTime(startedAt)` es-PE
- Finalizado (`flag`) — `formatDateTime(finishedAt)` es-PE

`formatDateTime` es una función pura del page (`dd/mm/yyyy hh:mm`) — evita dependencia con Intl para mantener el bundle chico y el output determinista en tests jsdom.

Contador en lista de alumnos: `<span>{{ vm.enabledCount() }} habilitados de {{ vm.totalStudents() }}</span>`. Ambos son `computed()` sobre `enabledStudentIds()` y `students()`.

## 7. Email fallback en tutor list

Antes: solo se llenaba `userEmail` desde el profile cuando ya estaba vacío. Bug: si `profile.email === null`, el header quedaba vacío.

Después: `resolveEmailFromIdentity()` privado — si `profile.email` es `null`, o si `getProfile` rechaza con `ProfileNotAvailableError`, llama `GetIdentityUseCase` que trae el email de login. Silencioso a errores adicionales — la UI usa `@if` para no renderizar la línea vacía.

## 8. Hexagonal compliance

- Nuevos VMs importan solo L1 (`TutorExam`, `NetworkError`, `TutorProfile`, `TutorClassroom`, `ProfileNotAvailableError`) y L2 (`GetTutorExamsUseCase`, `GetProfileUseCase`) — cero L3.
- `TutorExamsListPage` importa `PwaUpdateService` desde L3 — **sigue el patrón preexistente** de `home.page.ts` y `update-banner.component.ts`. No es una violación nueva.
- Ningún nuevo import de `@angular/*` o `rxjs` en L1/L2.
