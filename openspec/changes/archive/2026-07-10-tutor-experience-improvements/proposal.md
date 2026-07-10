# Proposal: Tutor Experience Improvements (aula navigation, iniciar duration, finalize confirm, metadata display)

> Retrospective SDD: los cambios ya se implementaron directo en la rama `feat/tutor-experience-improvements`. Este proposal subsana el flujo — 1002/1002 tests en verde, lint OK, tsc OK.

## Intent

Ampliar la experiencia del tutor con navegación jerárquica Aula → Curso → Examen, permitir editar la duración al iniciar, exigir confirmación explícita antes de finalizar antes de tiempo, y mostrar toda la metadata útil del examen en el detail. Aprovecha la reestructuración del DTO del back (`course`/`area` como snapshots plain-text, `scheduled` timestamp) para eliminar el UUID `entryId` del cliente y hacer agrupaciones sin request extra.

## Scope

### In Scope

- **Nueva capability `tutor-aula-navigation`**: dos rutas nuevas del tutor bajo `/tutor/aulas/`.
  - `/tutor/aulas/:classroomId` → `TutorAulaCoursesPage` — lista los cursos de un aula (agrupados desde el store).
  - `/tutor/aulas/:classroomId/curso/:course` → `TutorAulaCourseExamsPage` — exámenes filtrados por aula + curso, ordenados por `scheduled` desc.
  - Ambas usan `authGuard + roleGuard('tutor')` y VMs con warm-path del store (no hacen request si el store ya tiene data).
- **Home tutor (`tutor-exam-list`)**:
  - Filtra la lista principal a **solo `in_progress`** — los `scheduled` y `finalized` viven en la jerarquía aula→curso.
  - Aula cards se vuelven **clickeables** (rol=button, keydown.enter) y navegan a `/tutor/aulas/:classroomId`.
  - Reutiliza `<app-update-banner>`, `<app-update-confirm-modal>`, `<app-version-footer>` — mismos componentes que ya usa el home del alumno.
  - Bug fix: cuando `profile.email` es `null`, cae a `GetIdentityUseCase` en vez de dejar el header vacío. Refactor a helper `resolveEmailFromIdentity()`.
- **Detail tutor (`tutor-exam-management`)**:
  - Metadata visible en el header: área, curso, count, duración en minutos, `startedAt` y `finishedAt` formateados es-PE (`dd/mm/yyyy hh:mm`).
  - **Modal Iniciar con edición de duración** (mm+ss, rango 60..7200s validado en cliente). Confirma o override; solo envía `duration` al back si el tutor cambió el valor.
  - **Modal Finalizar de confirmación** — cerrar antes de tiempo es irreversible (congela enabled set, dispara grader), el tutor confirma explícitamente.
  - Contador en la lista de alumnos: `N habilitados de M`.
- **Contrato tutor (`tutor-exams-api`)**:
  - `TutorExam` cambia schema: `entryId` fuera, `courseId` → `course` (snapshot plain-text), agrega `area` (snapshot plain-text), `createdAt` → `scheduled`. Nuevo getter `durationInMinutes`.
  - `TutorExamDetail` idem: agrega `course`/`area`, saca `courseId`. (No incluye `scheduled` — el detail no lo devuelve.)
  - Port `iniciar(recordId, duration?)` — `duration` opcional en segundos, el back lo persiste atómicamente con la transición scheduled → in_progress.
  - HTTP adapter mapea el nuevo shape del DTO.

### Out of Scope

- Anti-fraude, dashboard de resultados post-envío, historial del alumno.
- Cambios en el flujo del alumno (cartilla, submit, login).
- I18n framework — strings siguen hardcoded es-PE.
- Modificar tests del backend (learnex) — este change asume el back ya devuelve el nuevo shape (`course`/`area`/`scheduled`).

## Capabilities

### New Capabilities

- **`tutor-aula-navigation`** — jerarquía Aula → Curso → Examen con dos rutas nuevas, VMs con warm-path del store, sin llamadas HTTP adicionales cuando el store ya está poblado.

### Modified Capabilities

- **`tutor-exams-api`** — schema de `TutorExam` y `TutorExamDetail` (course/area/scheduled), firma de `iniciar()` con `duration?`.
- **`tutor-exam-list`** — home tutor filtrado a `in_progress`, aulas clickeables, integración con `pwa-shell-update`.
- **`tutor-exam-management`** — modal duración, modal confirmación finalizar, metadata rica en el header, contador de habilitados.

## Approach

Cambios ya aplicados en 32 archivos (16 src, 11 tests, 5 nuevos):

1. **L1**: `TutorExam` y `TutorExamDetail` migraron a `course`/`area`/`scheduled`; puerto agrega `duration?` a `iniciar`.
2. **L2**: `IniciarExamenUseCase.execute` acepta `duration?` y lo pasa al puerto.
3. **L3**: `HttpTutorExamsApi` mapea el nuevo shape del DTO; `iniciar` envía `{ duration }` solo cuando viene el override.
4. **LR**:
   - Rutas nuevas en `app.routes.ts`.
   - `TutorAulaCoursesViewModel` agrupa `store.exams()` por `(classroomId, course)`.
   - `TutorAulaCourseExamsViewModel` filtra por `(classroomId, course)` y ordena por `scheduled` desc.
   - `TutorExamDetailViewModel` gana modal `iniciar` (mm+ss + validación) y modal `finalizar` (confirm).
   - `TutorExamsListViewModel` gana `examsInProgress` computed y helper `resolveEmailFromIdentity`.
   - `TutorExamsListPage` importa `UpdateBanner/UpdateConfirmModal/VersionFooter` y agrega `onClassroomClick`.
   - `TutorExamDetailPage` agrega helpers `durationMinutes`, `countLabel`, `formatDateTime`, `formatMmSs`, `parseIntInput`.

## Affected Areas

| Area | Impact |
|---|---|
| `src/L1_domain/entities/tutor-exam.ts` | Modified — schema breaking (entryId out, course/area/scheduled in, `durationInMinutes` getter) |
| `src/L1_domain/value-objects/tutor-exam-detail.ts` | Modified — course/area in, courseId out |
| `src/L1_domain/ports/tutor-exams-api.ts` | Modified — `iniciar(recordId, duration?)` |
| `src/L2_application/use-cases/iniciar-examen.use-case.ts` | Modified — accepts `duration?` |
| `src/L3_periphery/http/http-tutor-exams-api.ts` | Modified — DTO mapping + iniciar body |
| `src/L3_periphery/fakes/fake-tutor-exams-api.ts` | Modified — signature parity |
| `src/LR_render/app.routes.ts` | Modified — 2 rutas nuevas de aula |
| `src/LR_render/pages/tutor-aula-courses/` | **New** — page HTML/SCSS/TS |
| `src/LR_render/pages/tutor-aula-course-exams/` | **New** — page HTML/SCSS/TS |
| `src/LR_render/view-models/tutor-aula-courses.view-model.ts` | **New** |
| `src/LR_render/view-models/tutor-aula-course-exams.view-model.ts` | **New** |
| `src/LR_render/pages/tutor-exams-list/*` | Modified — solo in_progress, aulas clickeables, update banner |
| `src/LR_render/pages/tutor-exam-detail/*` | Modified — modales iniciar/finalizar + metadata |
| `src/LR_render/view-models/tutor-exams-list.view-model.ts` | Modified — `examsInProgress`, email fallback |
| `src/LR_render/view-models/tutor-exam-detail.view-model.ts` | Modified — modales, contadores, guards |
| `tests/**/*tutor*` | Modified — 11 archivos actualizados a nuevo schema y flujos |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| R1 — Back no devuelve el nuevo shape (course/area/scheduled) en producción | High | Coordinar con learnex ANTES del deploy: DTO `TutorVirtualExamListItemDto` debe incluir `course`, `area`, `scheduled` (no `entryId`, no `courseId`, no `createdAt`). |
| R2 — Ruta `/curso/:course` rompe con nombres que traen `/`, `?` o `#` | Low-Med | Aceptado — el back garantiza cursos alfanuméricos + espacios. Fix futuro con slug si aparece un caso. |
| R3 — Collision entre `course: null` (mapeado a `"Sin curso"`) y un curso real llamado literalmente `"Sin curso"` | Low | Aceptado — improbable en producción. Fix futuro con sentinel dedicado. |
| R4 — Validación mm+ss del modal permite valores fuera de rango | Low | Cliente valida 60..7200s, s∈[0,59], m≥0. Back también valida (defensa en profundidad). |

## Rollback Plan

`git revert` del merge. Los cambios son aditivos en L1/L2/L3 salvo el rename de campos del `TutorExam` — si el back ya migró al nuevo shape antes del revert, revertir cliente rompe la lista. El plan de rollback preferido es un fix-forward.

## Success Criteria

- [x] `tsc --noEmit` sin errores.
- [x] `npm run lint` sin warnings nuevos.
- [x] `npm test` — 1002/1002 tests verdes (69 archivos).
- [x] `hexagonal-guard` no reporta violaciones nuevas (los imports `L3_periphery/pwa/*` desde LR siguen el patrón preexistente de `home.page.ts`).
- [x] Rutas nuevas cargan con lazy `loadComponent` y guards correctos.
- [x] Modal iniciar valida 60..7200s antes de enviar al back.
- [x] Modal finalizar exige confirmación explícita.
- [x] `TutorExam` DOM del listado NO expone UUIDs (entryId eliminado del tipo).
