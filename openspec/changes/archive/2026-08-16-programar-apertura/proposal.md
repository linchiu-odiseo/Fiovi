# Proposal: Programar apertura del simulacro (modo Tarea)

## Intent

Hoy el tutor solo puede fijar `openUntil` (cierre) para un examen; el `started` queda pegado al `POST /start`. El backend learnex ya soporta programar `started_at` a futuro (ventana `now-5min` .. `now+15d`, `< openUntil`) y devuelve HTTP 422 `{ code: 'exam_not_open_yet', startedAt }` en submit/draft cuando el alumno intenta operar antes de la apertura.

Fiovi debe (a) permitirle al tutor **programar la apertura** desde el modal "Iniciar actividad" del tab Tarea y (b) mostrarle al alumno un **estado "programada"** con countdown/fecha de apertura, sin poder iniciar hasta que `now >= started`. Sin esto, la feature server queda inutilizable desde la PWA.

## Scope

### In Scope
- Modal tutor "Iniciar actividad" (tab Tarea): ocultar `HWheelComponent` de fecha/hora límite tras flag; agregar 2 `<input type="datetime-local">` nativos ("Fecha de inicio", "Fecha de cierre"); validaciones inline es-PE con botón disabled.
- Enviar `started_at?: string` (ISO) en `POST /start` solo cuando el tutor lo modificó.
- Nuevo estado `'programada'` en `StudentTasksListViewModel` — badge, fecha de apertura formateada es-PE, countdown si `< 24h`, botón Iniciar deshabilitado.
- Auto-transición reactiva `programada → abierto` reutilizando el ticker de 30s existente (sin timers nuevos).
- Nuevo error de dominio `ExamNotOpenYetError` (L1) con `startedAt: Date`; clasificación 422 `body.code === 'exam_not_open_yet'` en `classifySubmitError` + `classifyDraftError` (L3).
- Manejo de `ExamNotOpenYetError` en `SimulacroPageViewModel` con toast: "Este examen abre el sáb 16 · 8:00 a. m." (fallback sin fecha si el payload no trae `startedAt`).
- Tests Vitest: nueva branch de `composeEstado` (LR), clasificador 422 (L3), validación client-side del modal (LR).

### Out of Scope
- Home del alumno (posible follow-up si tiene lista similar).
- Cambios en learnex server (ya desplegado).
- I18n del toast/labels (strings hardcoded es-PE, Fase 1+).
- Analytics/telemetría del nuevo estado.
- Estilos custom para `datetime-local` (se usa UI nativa del OS).
- Migración de datos, nuevas deps, feature flags remotos.

## Capabilities

### New Capabilities
- Ninguna.

### Modified Capabilities
- `tutor-exam-management`: el modal "Iniciar actividad" acepta programar `startedAt` a futuro; `POST /start` incluye `started_at?` opcional; validaciones client-side (`>= now-5min`, `< openUntil`, `openUntil <= now+15d`).
- `exam-list`: `StudentTasksListViewModel` agrega el estado derivado `'programada'` (cuando `serverStatus === 'in_progress' && !exam.hasStartedBy(now)`); auto-transición vía ticker de 30s existente; countdown/fecha de apertura en la card.
- `exam-submission`: clasificar HTTP 422 `code: 'exam_not_open_yet'` en `classifySubmitError` como `ExamNotOpenYetError` (L1) con `startedAt: Date` mapeado en el adapter L3.
- `submit-progress-snapshot`: mismo tratamiento del 422 en `classifyDraftError` para `HttpExamsApi.guardarDraft`.

## Approach

- **L1 (domain)**: agregar `ExamNotOpenYetError` con campo `startedAt: Date`.
- **L2 (application)**: extender el request de `IniciarExamenUseCase` con `startedAt?: Date` opcional; se pasa al puerto tal cual.
- **L3 (adapters)**: `http-tutor-exams-api.ts` serializa `started_at` a ISO en el body de `/start` cuando viene; `http-exams-api.ts` mapea 422 `exam_not_open_yet` parseando `startedAt` como `Date` antes de instanciar `ExamNotOpenYetError` (para no romper boundaries L1↔L3).
- **LR (render)**:
  - `TutorExamDetailViewModel`: signals `pendingStartedAt`/`pendingOpenUntil`, `startedAtError`/`openUntilError`, `isSubmitDisabled` reactivo; template usa 2 `<input type="datetime-local">` mobile-first, ocultando las ruedas via flag booleano (no borrar, condicional en DOM).
  - `StudentTasksListViewModel`: `composeEstado` retorna `'programada'` cuando el examen está `in_progress` pero `now < exam.started`; card renderiza badge "PROGRAMADA", "Abre el {fecha corto es-PE}", countdown "Faltan Xh Ym" solo si `< 24h`, botón Iniciar deshabilitado.
  - `SimulacroPageViewModel`: catch específico de `ExamNotOpenYetError` en submit y save-draft → toast con fecha formateada; fallback "Este examen aún no abre" si `startedAt` viene undefined.
- **Decisiones cerradas** (no reevaluar): `<input type="datetime-local">` nativo; estado nuevo `'programada'` (no reutilizar `'pendiente'` que corresponde a `serverStatus === 'scheduled'`); ticker 30s existente; clasificación por `body.code` (regla #3 de CLAUDE.md).

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/L1_domain/errors/exam-not-open-yet.error.ts` | New | Error con `startedAt: Date` |
| `src/L2_application/use-cases/iniciar-examen.use-case.ts` | Modified | Request extendido con `startedAt?: Date` |
| `src/L3_periphery/http/http-tutor-exams-api.ts` | Modified | Payload `started_at` en POST `/start` |
| `src/L3_periphery/http/http-exams-api.ts` | Modified | `classifySubmitError` + `classifyDraftError` mapean 422 `exam_not_open_yet` |
| `src/LR_render/view-models/tutor-exam-detail.view-model.ts` | Modified | Signals + validaciones `pendingStartedAt` |
| `src/LR_render/pages/tutor-exam-detail/tutor-exam-detail.page.html` | Modified | 2 `datetime-local` + flag oculta ruedas |
| `src/LR_render/pages/tutor-exam-detail/tutor-exam-detail.page.ts` | Modified | Handlers y binding de signals |
| `src/LR_render/view-models/student-tasks-list.view-model.ts` | Modified | Estado `'programada'` + `formatOpensIn` |
| `src/LR_render/pages/student-tasks-list/student-tasks-list.page.html` | Modified | UI card programada |
| `src/LR_render/view-models/simulacro.view-model.ts` | Modified | Catch `ExamNotOpenYetError` + toast |

Volumen estimado: ~200 LOC prod + ~120 LOC test en ~10 archivos. Un solo PR.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `datetime-local` en iOS Safari no respeta `min/max` de forma consistente | Media | Validación server-side ya existe (server valida ventana). Client valida como defensa, pero la verdad la tiene el server. UX degradada, no rota. |
| Alumno con la card abierta cuando cruza `started` | Baja | Ticker de 30s recomputa `cards`; peor caso el alumno espera ≤30s a que el botón se habilite. |
| Payload 422 sin `startedAt` (server viejo o error inesperado) | Baja | Toast fallback: "Este examen aún no abre" sin fecha si `body.startedAt` es undefined. |
| `startedAt` viaja L3 → L1 sin mapeo intermedio | Media | Parseo `new Date(body.startedAt)` ocurre en el adapter L3 antes de instanciar `ExamNotOpenYetError`. Tests del clasificador cubren este parseo. |

## Rollback Plan

- Sin migración de datos, sin cambios de contrato irreversibles. Revert del PR restaura comportamiento previo: el tutor solo fija `openUntil` (ruedas visibles), el `POST /start` no envía `started_at`, el alumno no ve estado `'programada'`.
- El server sigue soportando `started_at` opcional aunque Fiovi no lo mande — cero coordinación cross-service.
- Flag booleano de "ocultar ruedas" queda en el código (condicional en DOM) por si se quiere volver rápido al UI viejo sin revert.

## Dependencies

- learnex server con feature `homework-scheduled-open-window` desplegado (confirmado por el usuario).

## Success Criteria

- [ ] Tutor puede programar `startedAt` a futuro (hasta 15 días) desde el modal Tarea; POST `/start` incluye `started_at` ISO cuando aplica.
- [ ] Validaciones client-side muestran mensajes es-PE y deshabilitan el botón cuando hay error.
- [ ] Alumno ve el estado `'programada'` con badge, fecha de apertura formateada es-PE y countdown si `< 24h`; botón Iniciar deshabilitado.
- [ ] Auto-transición `programada → abierto` ocurre dentro de los 30s posteriores a `now >= started`, sin refresh manual.
- [ ] HTTP 422 `exam_not_open_yet` en submit/draft muestra toast con fecha formateada (o fallback sin fecha).
- [ ] Tests Vitest verdes: nueva branch `composeEstado`, clasificador 422 (submit + draft), validación client-side del modal.
- [ ] `hexagonal-guard` sin violaciones (L1/L2 sin `@angular/*`, adapters mapean primitivos → dominio).
