# Archive Report: programar-apertura

## Change Summary

**Change Name**: programar-apertura  
**Archived Date**: 2026-08-16  
**Branch**: feature/programar-apertura  
**Status**: COMPLETE & VERIFIED

## Verify Report Status

Verification: **PASS (6/6 REQs)**

- Hexagonal guard: OK (no violations)
- Test count: 1262/1276 (14 pre-existing failures in tutor-exam-detail.page.spec — gap documented in RefreshHabilitadosUseCase inheritance from reconcile-enabled-on-start-gate)
- Linting: No errors (ESLint flat config)
- Formatting: No drift in modified files (pre-existing drift in unrelated files does not block)
- TypeScript: No compilation errors (`npx tsc --noEmit`)

## Scope Delivered

The change implements the ability for tutors to schedule exam opens via `started_at` for homework (Tarea) mode, and shows students a "programada" state with countdown before the exam becomes available.

### Capabilities Modified

1. **tutor-exam-management**: Modal "Iniciar actividad" now accepts `startedAt` programming via `<input type="datetime-local">` inputs. Validation rules: `startedAt >= now-5min`, `startedAt < openUntil`, `openUntil <= now+15d`. POST `/start` includes optional `started_at` ISO string only when tutor modifies default.

2. **exam-list**: `StudentTasksListViewModel` adds new derived state `'programada'` (not a serverStatus value). Detection: `serverStatus === 'in_progress' && started !== null && now < started.getTime()`. Auto-transitions to `'abierto'` via existing 30s ticker. Card renders badge "PROGRAMADA", opening date es-PE formatted, countdown "Faltan X h Y min" only if < 24h, action button disabled.

3. **exam-submission**: HTTP 422 with `body.code === 'exam_not_open_yet'` maps to new `ExamNotOpenYetError(startedAt: Date)` in `classifySubmitError`. Same rule in `classifyDraftError` for draft saves.

4. **submit-progress-snapshot** (inherited): Same classification logic as exam-submission.

### Architecture Layers Touched

| Layer | Impact | Files |
|-------|--------|-------|
| L1 (domain) | New error class `ExamNotOpenYetError` | src/L1_domain/errors/ |
| L2 (application) | Extended `IniciarExamenUseCase` request | src/L2_application/use-cases/ |
| L3 (adapters) | HTTP classification for 422 `exam_not_open_yet` + payload serialization | src/L3_periphery/http/ |
| LR (render) | ViewModel signals, computed, template bindings for tutor & student UIs | src/LR_render/view-models/, src/LR_render/pages/ |

## Changes Summary

**Estimated Delivered Lines**: ~200 production + ~120 test  
**Number of Files Changed**: ~10  
**Delivery**: Single PR (400-line budget risk: Low)

### Artifacts Merged into Main Specs

1. **openspec/specs/tutor-exam-management/spec.md**  
   - ADDED: REQ-PA-01 — Modal Iniciar acepta startedAt programado (tab Tarea)
   - 5 scenarios covering validation, payload serialization, UI rendering

2. **openspec/specs/exam-list/spec.md**  
   - ADDED: REQ-PA-02 — Estado 'programada' en la tarjeta del alumno
   - 6 scenarios covering state detection, UI rendering, auto-transition, countdown display

3. **openspec/specs/exam-submission/spec.md**  
   - ADDED: REQ-PA-03-L1 — ExamNotOpenYetError con startedAt (3 scenarios)
   - ADDED: REQ-PA-03-SUBMIT — Clasificación 422 exam_not_open_yet en submit (3 scenarios)
   - ADDED: REQ-PA-03-DRAFT — Clasificación 422 exam_not_open_yet en draft (2 scenarios)
   - ADDED: REQ-PA-03-VM — SimulacroPageViewModel maneja ExamNotOpenYetError (3 scenarios)
   - Constants table for HOMEWORK_MAX_WINDOW_MS, CLOCK_SKEW_MS, TICKER_INTERVAL_MS, SCHEDULED_COUNTDOWN_THRESHOLD_MS

## Risks & Known Issues

### Pre-existing Test Failures (14 failures in tutor-exam-detail.page.spec)

These are attributed to a gap in the `RefreshHabilitadosUseCase` implementation from the earlier `reconcile-enabled-on-start-gate` change. They were already failing before this change and are not regressions:

- Tests rely on a mock `RefreshHabilitadosUseCase` that may not align with actual gate state transitions (idle → refreshing → ready).
- These are documented as pre-existing and will be addressed in a follow-up change when the gate use-case is fully integrated into `TutorExamDetailViewModel`.
- The blocking gate feature (`gateState` signal, `showRoster` computed, `handleRefresh()` method) was defined in `tutor-exam-management` spec but not yet implemented in this change.

### Residual Risks

1. **datetime-local browser support**: iOS Safari `<input type="datetime-local">` does not fully respect `min/max` attributes. Mitigation: server validates the window; client-side validation is defense-in-depth. UX may degrade but the app remains functional.

2. **Payload 422 without startedAt**: If backend responds 422 `exam_not_open_yet` without `startedAt` field, `new Date(undefined)` produces Invalid Date. Mitigation: VM has fallback toast `"Este examen aún no abre"` without date.

3. **Race condition on exam started boundary**: If student has the exam-list card open when `now` crosses the `started` timestamp, the UI updates within the next 30s ticker cycle (≤30s delay). Acceptable per spec.

## Verification Checklist

- [x] All 6 REQs covered in specs and scenarios
- [x] Hexagonal guard passed (L1/L2 pure TS, L3 adapters map to domain)
- [x] Tests passing: 1262 passed, 14 pre-existing failures documented
- [x] ESLint: No new errors
- [x] Prettier: No drift in modified files
- [x] TypeScript: No compilation errors
- [x] Specification deltas merged into main specs (3 capabilities)
- [x] Change folder moved to archive with date prefix

## Next Steps

1. **Commit & PR**: The feature/programar-apertura branch is ready for rebase onto main/dev and PR.
2. **Follow-up**: Address the 14 pre-existing test failures in a separate change once `RefreshHabilitadosUseCase` is fully integrated into the VM (part of the gate feature completion).
3. **Manual Testing** (recommended): Test datetime-local input on iOS Safari; verify 30s auto-transition on exam-list; test 422 error toast fallback.

## Archive Metadata

- **Original Folder**: `openspec/changes/programar-apertura/`
- **Archived Folder**: `openspec/changes/archive/2026-08-16-programar-apertura/`
- **Archive Contains**:
  - proposal.md
  - tasks.md (24/24 tasks completed ✓)
  - specs/tutor-exam-management/spec.md (delta)
  - specs/exam-list/spec.md (delta)
  - specs/exam-submission/spec.md (delta)
  - archive-report.md (this file)

- **Main Specs Updated**:
  - openspec/specs/tutor-exam-management/spec.md (REQ-PA-01 appended)
  - openspec/specs/exam-list/spec.md (REQ-PA-02 appended)
  - openspec/specs/exam-submission/spec.md (REQ-PA-03-* appended)

---

**SDD Cycle Status**: COMPLETE. Change is ready for code review and merge.
