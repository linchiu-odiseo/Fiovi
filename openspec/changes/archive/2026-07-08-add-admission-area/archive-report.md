# Archive Report: add-admission-area

**Archived:** 2026-07-08  
**Change:** `add-admission-area`  
**Status:** Complete — all phases passed (verify-report PASS, 984/984 tests, hexagonal-guard clean)

## Change Summary

This change introduces the admission area (area de postulación) feature: students now select the career they are applying to (one of 16 fixed values: A, A1, B, C, D, E, I, II, III, IV, V, APT, CIE, MAT, G, GENERAL) in the exam marking UI. The selection is persisted locally to IndexedDB and transmitted with draft snapshots and exam submissions to learnex, enabling the backend to segment scoring and ranking by admission area.

**Change scope:** 
- New domain VO `AdmissionArea` (16-value union) + error `InvalidAdmissionAreaError`
- New L2 use case `SeleccionarAdmissionAreaUseCase` (validate + persist)
- Extended L2 use cases `EnviarSimulacroUseCase` and `GuardarDraftUseCase` (read admission area with GENERAL default, no persist)
- New L3 storage methods on `MarkingsStorage` port (get/set admission area)
- Extended L3 HTTP adapter `HttpExamsApi` (admission_area field in body for `/submit` and `/draft`)
- New LR component `AdmissionAreaPickerComponent` (2-state UI: collapsed pill ↔ expanded 3×6 grid, long-press 500ms to toggle)
- Extended `/simulacro/:id` view-model (signal hydration, `seleccionarArea()` method, draft notification integration)
- Updated error classifier for HTTP 400 `INVALID_ADMISSION_AREA` in both endpoints

## Specs Merged into Main Source of Truth

### admission-area (NEW)
- **Location:** `openspec/specs/admission-area/spec.md`
- **Action:** Created (promoted from delta spec in change folder)
- **Content:** Full specification of `AdmissionArea` VO, `InvalidAdmissionAreaError`, `MarkingsStorage` extension, `SeleccionarAdmissionAreaUseCase`, and `AdmissionAreaPickerComponent` with all scenarios
- **Capabilities:** admission-area (selection, persistence, UI, integration)

### exam-marking (MODIFIED)
- **Location:** `openspec/specs/exam-marking/spec.md`
- **Action:** Appended new requirement "Pantalla `/simulacro/:id` renderiza `AdmissionAreaPickerComponent`"
- **Changes:** Signal `admissionArea`, hydration from storage, method `seleccionarArea()`, view-model wiring, draft dispatcher integration, component placement in DOM
- **Scenarios:** 6 new scenarios for signal lifecycle, use case invocation, draft notification, and picker rendering

### exam-submission (MODIFIED)
- **Location:** `openspec/specs/exam-submission/spec.md`
- **Action:** Updated 2 existing requirements, added 1 new requirement
- **Changes:** 
  - `EnvioRequest` now includes required field `admissionArea: AdmissionArea`
  - New requirement "POST envío real con contrato learnex" (body order: code, admission_area, responses, client_finished_at)
  - New requirement "`EnviarSimulacroUseCase` resuelve `admissionArea` con default `GENERAL`" (read from storage, fallback, no persist)
- **Scenarios:** 3 new scenarios (EnvioRequest.admissionArea, body exact match, use case read logic)

### http-client (MODIFIED)
- **Location:** `openspec/specs/http-client/spec.md`
- **Action:** Updated 2 existing requirements, added exception documentation update
- **Changes:**
  - Updated "Clasificación de errores HTTP" to note the `/submit` endpoint exception
  - Updated "Clasificación POST submit" table to add row: 400 + `INVALID_ADMISSION_AREA` → `InvalidAdmissionAreaError`
  - Updated "Excepción documentada a la regla" to list 6 values: `INVALID_ADMISSION_AREA`, `STUDENT_NOT_ENROLLED`, `STUDENT_MISMATCH`, `SESSION_NOT_ACTIVE`, `CLOCK_SKEW_BEFORE_START`, `CLOCK_SKEW_TOO_FAR_FUTURE`
- **Scenarios:** 2 new scenarios (400 + INVALID_ADMISSION_AREA, 400 + unknown message)

### submit-progress-snapshot (MODIFIED)
- **Location:** `openspec/specs/submit-progress-snapshot/spec.md`
- **Action:** Updated 3 existing requirements, added 1 new requirement
- **Changes:**
  - Updated "Contrato HTTP del endpoint `/draft`" to include `admission_area` field in body (order: code, admission_area, responses)
  - Updated "ExamsApi.guardarDraft en L1" to include `admissionArea: AdmissionArea` as required field in `DraftRequest`
  - Updated "Clasificación de errores POST draft" table to add row: 400 + `INVALID_ADMISSION_AREA` → `InvalidAdmissionAreaError`
  - Updated enum in classifier to include `INVALID_ADMISSION_AREA` in the 6-value set
  - New requirement "`GuardarDraftUseCase` resuelve `admissionArea` con default `GENERAL`" (read from storage, fallback, no persist)
- **Scenarios:** 3 new scenarios for draft (400 + INVALID_ADMISSION_AREA, 400 + unknown message, use case read logic)

## Verification Summary

**Test Results:** 984/984 tests pass (69 files, 14.58s)

**Hexagonal Boundary Audit:** CLEAN
- L1 (pure TS): `admission-area.ts`, `invalid-admission-area.error.ts` have zero imports; ports import only L1 types
- L2 (pure TS): All use cases import only L1; no Angular, no RxJS, no browser APIs
- L3 (Angular DI allowed): HTTP and storage adapters use Angular but no LR imports
- LR (no direct L3): Picker component imports only @angular/core and L1 value-objects

**Project Rule Compliance:** All 5 rules pass
1. Hexagonal boundaries (new code): PASS
2. HTTP errors by (status, endpoint, enum set): PASS — Set.has() + === only
3. Cookies via single interceptor: PASS — no manual withCredentials in adapter
4. UI strings in es-PE: PASS — "Área:", "Mantén presionado para cambiar", "Toca para cambiar"
5. No literal vonex in non-generated src/: PASS — only in src/environments/ (auto-generated)

**Spec Compliance:** All requirements verified PASS per verify-report

**Pre-existing findings (noted in verify-report):**
- W-01: 8 lint errors in 2 files not touched by this change (tutor-exam-detail.view-model.spec.ts, fakes.ts)
- S-01: DraftAutoSaveDispatcher imported from L3 in view-model (deferred architectural refactor)
- S-02: LONG_PRESS_DURATION_MS duplicated (future directive extraction noted in design.md)

## Artifacts in Archive

```
openspec/changes/archive/2026-07-08-add-admission-area/
├── .openspec.yaml
├── proposal.md
├── design.md
├── tasks.md (all 15 task groups marked [x])
├── verify-report.md (PASS, 984/984 tests, hexagonal clean)
├── archive-report.md (this file)
└── specs/
    ├── admission-area/spec.md (new)
    ├── exam-marking/spec.md (delta)
    ├── exam-submission/spec.md (delta)
    ├── http-client/spec.md (delta)
    └── submit-progress-snapshot/spec.md (delta)
```

## Main Spec Files Updated

```
openspec/specs/
├── admission-area/spec.md ← NEW (promoted from delta)
├── exam-marking/spec.md ← merged
├── exam-submission/spec.md ← merged
├── http-client/spec.md ← merged
└── submit-progress-snapshot/spec.md ← merged
```

## Rollback Plan

The change is strictly additive with no breaking changes to existing behavior:
- New VO, error, use case, storage methods, HTTP body field, component, and view-model signal
- Existing enum `EnvioRequest`/`DraftRequest` extended (no removal)
- Existing use cases extended (fallback to GENERAL; no change to error handling or dispatch)
- Existing component rendering locations unchanged (picker inserted, not replacing)
- Default admission area (`GENERAL`) ensures backward compatibility (student can submit without explicit selection)

Rollback: revert the single PR. No data migration, no backfill, no cleanup necessary.

## Deployment Dependency

Backend contract must be deployed BEFORE PWA merge:
- learnex must accept `admission_area` field in POST `/t/{slug}/student/exam-sessions/{sessionId}/submit` and `/draft`
- learnex must validate against the 16-value enum and reject 400 + `INVALID_ADMISSION_AREA` if invalid
- The field is required in the request body (no optional handling in PWA)

## Next Recommended Action

None. The change is complete and archived. The SDD cycle for `add-admission-area` is closed.

Any follow-up changes (e.g., dashboard tutor real, results post-envío, anti-fraude hardening) will start a new SDD cycle from `sdd-propose`.
