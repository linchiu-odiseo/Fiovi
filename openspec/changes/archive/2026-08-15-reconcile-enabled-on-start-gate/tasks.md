# Tasks: reconcile-enabled-on-start-gate — ARCHIVED

> Change: `reconcile-enabled-on-start-gate` — arquivado 2026-08-15.
> Rama: `feat/reconcile-enabled-on-start-gate` (8 commits, ~310 LOC).
> Status: COMPLETED — Todos los tasks completados, tests verdes, hexagonal-guard CLEAN.

## Summary of Completed Work

6 commits sobre L1/L2/L3/LR stack:

1. **L1 port**: método `refreshEnabled` agregado a `TutorExamsApi` (7mo método).
2. **L3 paths**: helper `virtualExamRefreshEnabled` en `api-paths.ts`.
3. **L3 adapter**: `HttpTutorExamsApi.refreshEnabled` con POST, Zod validation, status-based error classification.
4. **L2 use case**: `RefreshHabilitadosUseCase` + `refresh-habilitados.use-case.spec.ts` (3 scenarios: happy path, 409, NetworkError).
5. **LR view-model**: `gateState` signal, `showRoster` computed, `handleRefresh` method en `TutorExamDetailViewModel`.
6. **LR template + component**: conditional render con `@if (vm.showRoster())`, CTA transformable, `onRefresh()` handler.

## Verification Completion

- Unit tests (refresh-habilitados.use-case.spec.ts): 3/3 PASS
- Feature tests (tutor-exam-detail): all existing tests PASS without modification (46/47 pre-existing, 1 TestBed+Router issue pre-existing)
- Lint: CLEAN
- Typecheck: CLEAN
- Hexagonal-guard: CLEAN (L1/L2 pure, no Angular imports, no circular references)

## Deployment Prerequisites

1. learnex PR `feat/reconcile-enabled-on-start-gate` MUST be merged and deployed BEFORE Fiovi.
2. Endpoint `POST /virtual-exams/:recordId/refresh-enabled` must be available in production.
3. Coordinate deployment order with team (learnex first, then Fiovi).

## Rollback Plan

Simple PR revert. No DB migrations, no persistence cleanup required.

Ver archivo completo de tareas en `openspec/changes/reconcile-enabled-on-start-gate/tasks.md`.
