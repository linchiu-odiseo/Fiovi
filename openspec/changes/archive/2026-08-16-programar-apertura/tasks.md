# Tasks: Programar apertura del simulacro (modo Tarea)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~320 (200 prod + 120 test) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

---

## Phase 1: Domain (L1 puro)

- [x] 1.1 **CREATE** `src/L1_domain/errors/exam-not-open-yet.error.ts` — clase `ExamNotOpenYetError extends Error` con campo `startedAt: Date`; constructor acepta `{ startedAt: Date }`. Patrón idéntico a `InvalidSubmissionTimeError`. Cubre REQ-PA-03-L1.
- [x] 1.2 **ADD** caso `ExamNotOpenYetError` en `tests/unit/L1_domain/errors/errors.spec.ts` — instanciar con `startedAt` válido y `new Date(undefined)` (Invalid Date); verificar `error.startedAt` y `error.name`. Cubre REQ-PA-03-L1 scenarios.

## Phase 2: Adapters L3

- [x] 2.1 **MODIFY** `src/L3_periphery/http/http-exams-api.ts` — en `classifySubmitError`: antes del bloque `status === 422` existente, añadir rama `body.code === 'exam_not_open_yet'` → `new ExamNotOpenYetError({ startedAt: new Date(body.startedAt) })`; leer `body` como `{ message?: string; code?: string; startedAt?: string }`. Cubre REQ-PA-03-SUBMIT.
- [x] 2.2 **MODIFY** `src/L3_periphery/http/http-exams-api.ts` — en `classifyDraftError`: ídem lógica anterior para `body.code === 'exam_not_open_yet'`. Cubre REQ-PA-03-DRAFT.
- [x] 2.3 **MODIFY** `tests/feature/L3_periphery/http/http-exams-api-enviar.spec.ts` — añadir 3 tests: 422 con `code=exam_not_open_yet` + `startedAt` → `ExamNotOpenYetError` con Date válido; 422 sin `startedAt` → `ExamNotOpenYetError` con Invalid Date; 422 sin `code` → `InvalidSubmissionTimeError` (no-regresión). Cubre REQ-PA-03-SUBMIT scenarios.
- [x] 2.4 **MODIFY** `tests/feature/L3_periphery/http/http-exams-api-draft.spec.ts` — añadir 2 tests: 422 `exam_not_open_yet` con `startedAt` → `ExamNotOpenYetError`; sin `startedAt` → `ExamNotOpenYetError` con Invalid Date. Cubre REQ-PA-03-DRAFT scenarios.
- [x] 2.5 **MODIFY** `src/L3_periphery/http/http-tutor-exams-api.ts` — método `iniciar`: extender `opts` con `startedAt?: Date`; añadir `if (opts?.startedAt !== undefined) payload.started_at = opts.startedAt.toISOString()`. Cubre REQ-PA-01 (payload).

## Phase 3: Use Case L2

- [x] 3.1 **MODIFY** `src/L2_application/use-cases/iniciar-examen.use-case.ts` — extender `execute` request con `startedAt?: Date`; pasar al adapter: `this.api.iniciar(req.recordId, { duration: req.duration, openUntil: req.openUntil, startedAt: req.startedAt })`. Cubre REQ-PA-01.
- [x] 3.2 **MODIFY** `tests/unit/L2_application/iniciar-examen.use-case.spec.ts` — añadir test: `startedAt` presente → adapter recibe `started_at`; `startedAt` ausente → adapter no recibe `started_at`. Cubre REQ-PA-01 scenarios "payload incluye started_at" y "payload NO incluye started_at".

## Phase 4: ViewModel Tutor (LR)

- [x] 4.1 **MODIFY** `src/LR_render/view-models/tutor-exam-detail.view-model.ts` — añadir: constantes `CLOCK_SKEW_MS = 5*60*1000` y `HOMEWORK_MAX_WINDOW_MS = 15*24*60*60*1000`; signals `pendingStartedAt: WritableSignal<string | null>` y `showHwheels: Signal<boolean>` (computed: `pendingMode() !== 'tarea'` o lógica equivalente); computeds `startedAtError: Signal<string | null>` (valida `>= now-CLOCK_SKEW_MS` y `< openUntil`) y `isScheduledSubmitDisabled: Signal<boolean>`; reset en `openIniciarModal` y `closeIniciarModal`; pasar `startedAt` a use case en `confirmIniciarModal` solo si difiere del default. Cubre REQ-PA-01.
- [x] 4.2 **MODIFY** `tests/feature/LR_render/view-models/tutor-exam-detail.view-model.spec.ts` — añadir tests: `startedAt >= openUntil` → `startedAtError = 'Debe ser antes del cierre'` + `isScheduledSubmitDisabled = true`; `startedAt < now-5min` → `startedAtError = 'No puede ser en el pasado'`; `openUntil > now+15d` → `openUntilError = 'Tope 15 días'`; unmodified default → use case sin `startedAt`. Cubre REQ-PA-01 scenarios.

## Phase 5: Template Tutor (LR)

- [x] 5.1 **MODIFY** `src/LR_render/pages/tutor-exam-detail/tutor-exam-detail.page.html` — en sección del modal Tarea: envolver `HWheelComponent`(s) existentes en `@if (showHwheels())`; añadir `@if (!showHwheels() && exam().type === 'homework')` con 2 `<input type="datetime-local">` para `startedAt` y `openUntil`, mensajes de error inline (es-PE), y bind a `isScheduledSubmitDisabled()` en el botón confirmar. Cubre REQ-PA-01 (UI).
- [x] 5.2 **MODIFY** `src/LR_render/pages/tutor-exam-detail/tutor-exam-detail.page.ts` — añadir handlers `onStartedAtChange(value: string)` y `onOpenUntilChange(value: string)` que llamen a `vm.pendingStartedAt.set(value)` / `vm.pendingOpenUntil.set(value)`. Cubre REQ-PA-01 (binding).

## Phase 6: ViewModel Alumno (LR)

- [x] 6.1 **MODIFY** `src/LR_render/view-models/student-tasks-list.view-model.ts` — ampliar `TareaEstado` con `'programada'`; añadir constante `SCHEDULED_COUNTDOWN_THRESHOLD_MS = 24*60*60*1000`; modificar `composeEstado`: `in_progress` → si `exam.started !== null && now < exam.started.getTime()` → `'programada'`, si no → `'abierto'`; añadir a `TareaCard` los campos `opensAt: Date | null` y `opensInText: string | null`; en `buildCard`: computar `opensAt` y `opensInText` (formato `"Faltan Xh Ym"` solo si `< 24h`) usando `Intl.DateTimeFormat('es-PE', ...)`; `clickable = estado === 'abierto'`. Cubre REQ-PA-02.
- [x] 6.2 **CREATE** `tests/feature/LR_render/view-models/student-tasks-list.view-model.spec.ts` — añadir tests: `in_progress` con `started > now` → `'programada'`; `in_progress` con `started <= now` → `'abierto'`; countdown `< 24h` → texto `"Faltan Xh Ym"`; countdown `>= 24h` → `opensInText = null`. Cubre REQ-PA-02 scenarios.

## Phase 7: Template Alumno (LR)

- [x] 7.1 **MODIFY** `src/LR_render/pages/student-tasks-list/student-tasks-list.page.html` — añadir bloque `@case ('programada')` (o `@if`) en la card: badge `"PROGRAMADA"`, línea `"Abre el {fecha es-PE}"`, línea countdown `"Faltan Xh Ym"` solo si `card.opensInText !== null`, botón `disabled` con label `"No disponible aún"`. Cubre REQ-PA-02 (UI).

## Phase 8: ViewModel Simulacro (LR)

- [x] 8.1 **MODIFY** `src/LR_render/view-models/simulacro.view-model.ts` — añadir `SimulacroErrorState` variant `'not-open-yet'`; añadir signal `notOpenYetMessage: WritableSignal<string | null>`; en `handleSubmissionError`: rama `instanceof ExamNotOpenYetError` → formatear fecha con `Intl.DateTimeFormat('es-PE', { dateStyle: 'short', timeStyle: 'short' })` si `isNaN(error.startedAt.getTime())` → `"Este examen aún no abre"`, si no → `"Este examen abre el {fecha}"`; set `notOpenYetMessage` (o errorState según patrón del VM); también interceptar en el error path del `draftDispatcher`. Cubre REQ-PA-03-VM.
- [x] 8.2 **MODIFY** `tests/feature/LR_render/view-models/simulacro.view-model.spec.ts` — añadir tests: `ExamNotOpenYetError` con `startedAt` válido → `notOpenYetMessage` con fecha es-PE; `ExamNotOpenYetError` con Invalid Date → `"Este examen aún no abre"`; verificar que no hay comparación de `error.message`. Cubre REQ-PA-03-VM scenarios.

## Phase 9: Verify

- [x] 9.1 Tests L1+L2: `errors.spec.ts` (61 pass), `iniciar-examen.use-case.spec.ts` (7 pass), `tutor-exams-api.spec.ts` (2 pass) — verde.
- [x] 9.2 Tests L3: `http-exams-api-enviar.spec.ts` (24 pass), `http-exams-api-draft.spec.ts` (27 pass) — verde.
- [x] 9.3 Tests LR: `student-tasks-list.view-model.spec.ts` (6 pass), `simulacro.view-model.spec.ts` (51 pass), `tutor-exam-detail.view-model.spec.ts` (51 pass) — verde. Total: 214 tests across 8 files.
- [x] 9.4 `npm run lint` — sin errores ESLint.
- [x] 9.5 `npm run format:check` — sin drift en archivos modificados (pre-existing drift en archivos no tocados no bloqueante).
- [x] 9.6 `npx tsc --noEmit` — sin errores de tipos.
