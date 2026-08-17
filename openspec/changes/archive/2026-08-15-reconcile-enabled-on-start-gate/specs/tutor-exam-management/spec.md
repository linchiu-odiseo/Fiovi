# Delta for tutor-exam-management

> Este delta extiende la capability existente `tutor-exam-management`.
> Al archivar este change, los requirements ADDED debajo se mergean en `openspec/specs/tutor-exam-management/spec.md`.
> Change: `reconcile-enabled-on-start-gate` — iniciado 2026-08-15.

## Context

La capability `tutor-exam-management` ya define `TutorExamDetailViewModel` con signals de carga, detalle, alumnos, acciones de iniciar/finalizar/habilitar, y `TutorExamDetailPage` con su template (ver `openspec/specs/tutor-exam-management/spec.md`). Este delta agrega el gate de reconciliación de alumnos habilitados que se activa cuando el examen está en status `scheduled`.

El gate no interfiere con ningún signal, computed, effect ni método existente del VM. La lógica de countdown ticker, D1 cold/warm store resolution, effect diferido con jitter, y optimistic updates + rollback de checkboxes permanecen exactamente iguales.

## ADDED Requirements

Ver `openspec/specs/tutor-exam-management/spec.md` (canonical) para los requirements mergeados:
- REQ-VM-1: Signal `gateState` en `TutorExamDetailViewModel`
- REQ-VM-2: Computed `showRoster` en `TutorExamDetailViewModel`
- REQ-VM-3: Método `handleRefresh()` en `TutorExamDetailViewModel`
- REQ-VM-4: Reset natural del gate por desmontaje (sin persistencia)
- REQ-VM-5: Contratos existentes del VM son inmutables
- REQ-PAGE-1: Conditional render en `tutor-exam-detail.page.html`
- REQ-PAGE-2: CTA transformable — un solo botón
- REQ-PAGE-3: Gate NO aplica a `in_progress` / `finalized`
- Copy de errores del gate en español
