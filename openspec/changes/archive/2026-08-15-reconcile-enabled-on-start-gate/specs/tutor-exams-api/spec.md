# Delta for tutor-exams-api

> Este delta extiende la capability existente `tutor-exams-api`.
> Al archivar este change, los requirements ADDED debajo se mergean en `openspec/specs/tutor-exams-api/spec.md`.
> Change: `reconcile-enabled-on-start-gate` — iniciado 2026-08-15.

## Context

La capability `tutor-exams-api` ya define 6 métodos en el puerto `TutorExamsApi` (ver `openspec/specs/tutor-exams-api/spec.md`). Este delta agrega el 7mo método `refreshEnabled(recordId)`, su helper de URL, su implementación HTTP y el use case L2 correspondiente. El puerto `ExamsApi` (alumno) sigue sin tocarse.

## ADDED Requirements

Ver `openspec/specs/tutor-exams-api/spec.md` (canonical) para los requirements mergeados:
- REQ-API-1: Método `refreshEnabled` en puerto `TutorExamsApi` (L1)
- REQ-API-3: Helper URL `virtualExamRefreshEnabled` en `api-paths.ts`
- REQ-API-2: Adapter HTTP `HttpTutorExamsApi.refreshEnabled`
- REQ-API-4: Use case `RefreshHabilitadosUseCase` (L2)
