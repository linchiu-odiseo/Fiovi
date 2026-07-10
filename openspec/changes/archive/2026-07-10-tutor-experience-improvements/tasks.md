# Tasks: Tutor Experience Improvements

> **Retrospective SDD** — todos los tasks reflejan trabajo ya aplicado en la rama `feat/tutor-experience-improvements`. Marcados `[x]` al momento de escribir este documento (2026-07-10).

## Phase 1: L1 domain — schema y port

- [x] T1.1 Rebautizar campos de `TutorExam` (`entryId` fuera; `courseId` → `course` string; agrega `area` string; `createdAt` → `scheduled` Date). Getter `durationInMinutes`. (`src/L1_domain/entities/tutor-exam.ts`)
- [x] T1.2 Idem para `TutorExamDetail`: agrega `course`/`area`, saca `courseId`. (`src/L1_domain/value-objects/tutor-exam-detail.ts`)
- [x] T1.3 Extender puerto `TutorExamsApi.iniciar` para aceptar `duration?: number` (segundos 60..7200). Documentar los códigos de error en comentario. (`src/L1_domain/ports/tutor-exams-api.ts`)

## Phase 2: L2 application

- [x] T2.1 `IniciarExamenUseCase.execute` acepta `{ recordId, duration? }` y pasa `duration` al puerto. (`src/L2_application/use-cases/iniciar-examen.use-case.ts`)

## Phase 3: L3 periphery — HTTP adapter

- [x] T3.1 Actualizar `TutorVirtualExamListItemDto` y `VirtualExamDetailDto`: agregar `course`, `area`, `scheduled` (list); sacar `entryId`, `courseId`, `createdAt`. (`src/L3_periphery/http/http-tutor-exams-api.ts`)
- [x] T3.2 Mapper `mapListItem` construye `TutorExam` con el nuevo shape.
- [x] T3.3 Mapper del detail construye `TutorExamDetail` con `course`/`area`.
- [x] T3.4 `iniciar(recordId, duration?)` — envía `{ duration }` en el body solo cuando viene el override; null cuando no.
- [x] T3.5 `FakeTutorExamsApi.iniciar` matchea firma nueva. (`src/L3_periphery/fakes/fake-tutor-exams-api.ts`)

## Phase 4: LR render — home tutor

- [x] T4.1 `tutor-exams-list.view-model.ts` agrega `examsInProgress` computed y `hasExamsInProgress`.
- [x] T4.2 Fallback de email — extraer `resolveEmailFromIdentity()`; usar tanto en `ProfileNotAvailableError` como en `profile.email === null`.
- [x] T4.3 `tutor-exams-list.page.ts` inyecta `PwaUpdateService`, importa `UpdateBanner/UpdateConfirmModal/VersionFooter`, agrega `onClassroomClick`.
- [x] T4.4 Template — reemplazar lista completa por `examsInProgress`, agregar `<app-update-banner>` y `<app-version-footer>`, aula cards clickeables (rol=button, keydown.enter).
- [x] T4.5 SCSS — nuevos estilos `aulas-grid`, `aula-card`, `exams-in-progress-section` (todo con design tokens, cero hex literales).

## Phase 5: LR render — detail tutor (metadata + modales)

- [x] T5.1 VM agrega estado del modal iniciar: `iniciarModalOpen`, `pendingMinutes`, `pendingSeconds`, `pendingTotalSeconds` (computed), `durationError`, constantes `DURATION_MIN/MAX_SECONDS`.
- [x] T5.2 VM agrega estado del modal finalizar: `finalizarModalOpen`.
- [x] T5.3 VM agrega computed `enabledCount` y `totalStudents`.
- [x] T5.4 VM acciones: `openIniciarModal / cancelIniciarModal / confirmIniciarModal` con validación (integer, s∈[0,59], m≥0, total∈[60,7200]) y override solo si el tutor cambió el valor.
- [x] T5.5 VM acciones: `openFinalizarModal / cancelFinalizarModal / confirmFinalizarModal`.
- [x] T5.6 VM `iniciar(newDuration?)` propaga el override al use case.
- [x] T5.7 `reloadDetail` upsertea al store con el nuevo shape (`course`/`area`/`scheduled` desde el store existente).
- [x] T5.8 Page helpers: `durationMinutes`, `countLabel`, `formatDateTime`, `formatMmSs`, `parseIntInput`, y handlers `onMinutesInput / onSecondsInput`.
- [x] T5.9 Template — header muestra área, curso, count, duración, `startedAt`, `finishedAt`. Modales iniciar y finalizar renderizan con `role="dialog" aria-modal="true"`. Contador de habilitados en el header de la lista.
- [x] T5.10 SCSS — modal backdrop, layout mm+ss, botones large stacked, error banner (todo con tokens).

## Phase 6: LR render — nueva capability aula-navigation

- [x] T6.1 `TutorAulaCoursesViewModel` — agrupa `store.exams()` por `(classroomId, course ?? 'Sin curso')` como `computed()`. Warm path del store.
- [x] T6.2 `TutorAulaCoursesPage` HTML/SCSS/TS — lista tarjetas de curso con navegación por click/keydown.enter.
- [x] T6.3 `TutorAulaCourseExamsViewModel` — filtra `store.exams()` por `(classroomId, course)` y ordena por `scheduled` desc.
- [x] T6.4 `TutorAulaCourseExamsPage` HTML/SCSS/TS — lista exam-cards con badge de estado y navegación al detail.
- [x] T6.5 Agregar rutas en `app.routes.ts` con `authGuard + roleGuard('tutor')` y `loadComponent`.

## Phase 7: Tests

- [x] T7.1 `tests/unit/L1_domain/entities/tutor-exam.spec.ts` — actualizado a nuevo shape.
- [x] T7.2 `tests/unit/L1_domain/value-objects/tutor-exam-detail.spec.ts` — idem.
- [x] T7.3 `tests/unit/L2_application/fakes.ts` + `iniciar-examen.use-case.spec.ts` — nueva firma con `duration?`.
- [x] T7.4 `tests/unit/L2_application/get-tutor-exam-detail.use-case.spec.ts` y `get-tutor-exams.use-case.spec.ts` — schema nuevo.
- [x] T7.5 `tests/feature/L3_periphery/http/http-tutor-exams-api.spec.ts` — DTOs con `course`/`area`/`scheduled`, iniciar con body de duration.
- [x] T7.6 `tests/feature/LR_render/state/tutor-exams.store.spec.ts` — factory al nuevo shape.
- [x] T7.7 `tests/feature/LR_render/view-models/tutor-exam-detail.view-model.spec.ts` — modales y flujos nuevos.
- [x] T7.8 `tests/feature/LR_render/view-models/tutor-exams-list.view-model.spec.ts` — email fallback + examsInProgress.
- [x] T7.9 `tests/feature/LR_render/pages/tutor-exam-detail/tutor-exam-detail.page.spec.ts` — DOM del header + modales.
- [x] T7.10 `tests/feature/LR_render/pages/tutor-exams-list/tutor-exams-list.page.spec.ts` — aulas clickeables + solo in_progress.

## Phase 8: Auditoría global

- [x] T8.1 `tsc --noEmit` — exit 0.
- [x] T8.2 `npm run lint` — exit 0.
- [x] T8.3 `npm test` — 1002/1002 tests (69 files) verdes.
- [x] T8.4 Verificar hexagonal — VMs nuevos solo importan L1/L2; `PwaUpdateService` desde LR sigue el patrón preexistente ya usado en `home.page.ts` y `update-banner.component.ts`.
