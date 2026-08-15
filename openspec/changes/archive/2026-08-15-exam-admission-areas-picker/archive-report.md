# Archive Report: exam-admission-areas-picker

**Archived:** 2026-08-15  
**Change:** `exam-admission-areas-picker`  
**PR:** https://github.com/odiseo-peru/Fiovi/pull/62  
**Status:** Complete — SDD ligero (proposal + spec only, no design/tasks), all requirements implemented

## Change Summary

This change enables the admission area picker to accept a backend-provided subset of allowed admission areas (via learnex PR #816 rollout of `admission_areas: string[]` in exam responses). Students now see only the areas they can actually select for a given exam, preventing downstream validation errors on submit.

The change is 100% backward compatible: exams without `admission_areas` (FICHAS and legacy exams) continue to show all 16 hardcoded areas. The picker component gracefully adapts to both restricted and unrestricted scenarios without any breaking changes to existing workflows.

**Change scope:**
- L1 domain: `AdmissionArea` VO opens from closed 16-value union to `KnownAdmissionArea | (string & {})` with new `isKnownAdmissionArea` guard; `Exam` entity gains `allowedAdmissionAreas: readonly string[] | null`
- L3 HTTP adapter: `ExamDto` extended with `admission_areas` field; mapper applies minimal boundary validation (filter non-strings, pass nulls, treat missing as null)
- LR render: `AdmissionAreaPickerComponent` gains optional `@Input() allowedAreas` and computed `visibleAreas`; `SimulacroPageViewModel` exposes pure derived signal `allowedAdmissionAreas`; template binding in `simulacro.page.html`

Total production code: ~55 LOC across 7 files  
Test coverage: 91 test files, 1248 tests, all green (no regression)

## Specs Merged into Main Source of Truth

### admission-area (MODIFIED)
- **Location:** `openspec/specs/admission-area/spec.md`
- **Action:** Merged delta spec (3 MODIFIED + 3 ADDED requirements)
- **Modified requirements:**
  1. `AdmissionArea` VO — union now open with `KnownAdmissionArea` distinction, new `isKnownAdmissionArea()` helper, `isAdmissionArea` guard relaxed to accept any non-empty string
  2. `SeleccionarAdmissionAreaUseCase` — postcondition added: unknown areas now accepted (back is authority)
  3. `AdmissionAreaPickerComponent` — new optional `@Input() allowedAreas`, computed `visibleAreas`, type of `admissionArea` input widened
- **Added requirements:**
  1. `Exam.allowedAdmissionAreas: readonly string[] | null` with constructor invariants (normalizes `[]` to `null`, trims/filters empty strings, preserves unknown labels)
  2. `ExamDto` mapper extended with `admission_areas` field and minimal boundary filtering (no-strings filtered, nulls passed through, missing treated as null)
  3. `SimulacroPage` signal binding — pure computed derivation of exam's `allowedAdmissionAreas` passed to picker

## Verification Summary

**Build & Lint:** Clean  
- `tsc --noEmit`: no errors
- `ng lint`: no violations

**Test Results:** 1248 tests pass (91 files)
- L1 domain tests: `admission-area.spec.ts` covers all 8 scenarios (union open/closed guards, KnownAdmissionArea distinction)
- L1 entity tests: `exam.spec.ts` covers 7 scenarios (null, empty array, valid array, unknown labels, whitespace filtering, invalid input)
- L3 HTTP tests: `http-exams-api.spec.ts` covers 3 scenarios (null mapping, subset with unknowns, missing field)
- L2 use case tests: `seleccionar-admission-area.use-case.spec.ts` covers 2 scenarios (unknown area persistence, empty area rejection)
- LR component tests: `admission-area-picker.component.spec.ts` covers 5 scenarios (null/undefined/subset behavior, unknown labels, subset selection)
- LR view-model tests: `simulacro.view-model.spec.ts` covers 2 scenarios (subset propagation, null → 16 fallback)

**Hexagonal Boundary Audit:** CLEAN
- L1 (pure TS): `admission-area.ts` has zero imports (only `const`/`type`/`function` declarations); `exam.ts` imports only L1 types and errors
- L2 (pure TS): `seleccionar-admission-area.use-case.ts` imports only L1; no Angular, no RxJS, no browser APIs
- L3 (Angular allowed): HTTP adapter imports Angular + L1; no LR imports
- LR (UI allowed): Picker component imports `@angular/core` + L1 value-objects; view-model imports `@angular/core` + all L2 use cases (dependency injection correct)

**Hexagonal violations check:**
- ✓ No L1/L2 files import `@angular/*`, `rxjs`, or browser APIs
- ✓ LR picker component does NOT import L3 periphery
- ✓ View-model `allowedAdmissionAreas` signal is pure `computed()` derivation with no side effects
- ✓ Union opens safely: `KnownAdmissionArea` preserved for type-safe defaults, `AdmissionArea` abierto used only where backend data flows

**Project Rule Compliance:** All 5 rules pass
1. Hexagonal boundaries: PASS (L1/L2 pure TS, LR imports only L1 domain, L3 adapter wraps backend)
2. HTTP error classification: PASS (no changes to error paths; existing `INVALID_ADMISSION_AREA` classification from `add-admission-area` reused)
3. Cookies + interceptor: PASS (no auth changes)
4. UI strings in es-PE: PASS (no new UI strings requiring i18n)
5. No literal tenant slug: PASS (all paths via `apiPath` helper with injected slug)

**SDD Ligero Decision:**  
Per user request, this change skipped design and tasks phases due to the small, additive nature (~55 LOC). The change is a straightforward optional input + computed binding with no architectural reshaping. Proposal + spec + implementation + test coverage deemed sufficient for this scope.

## Artifacts in Archive

```
openspec/changes/archive/2026-08-15-exam-admission-areas-picker/
├── proposal.md (original proposal)
└── specs/
    └── admission-area/spec.md (delta spec, merged into main)
```

## Main Spec Files Updated

```
openspec/specs/
└── admission-area/spec.md ← MERGED (3 MODIFIED + 3 ADDED requirements)
```

**No other spec files required merging** — this change does not modify `exam-marking`, `exam-submission`, `http-client`, or `submit-progress-snapshot` at the spec level. Those capabilities remain unchanged; only `admission-area` capability extends.

## Rollback Plan

The change is strictly additive with no breaking changes:
- New VO distinction (`KnownAdmissionArea`), new guards, new union alias
- New entity field (`Exam.allowedAdmissionAreas`)
- New component input (`allowedAreas`), new computed property (`visibleAreas`)
- New view-model signal (`allowedAdmissionAreas`)
- New DTO field (`ExamDto.admission_areas`)
- All defaults and existing code paths continue unchanged

Rollback: revert the single PR. No data migration, no cleanup necessary.

## Deployment Status

**NOT YET DEPLOYED**

PR #62 is open against `odiseo-peru/Fiovi` branch `feat/exam-admission-areas-picker`. Backend contract (learnex PR #816 `admission_areas` field in exam responses) has already been deployed to both staging and production.

Fiovi frontend should merge and deploy as soon as PR review is complete. Zero risk of deployment friction: prod exams are 100% FICHAS with `admission_areas: null`, so the new path (subset filtering) is dormant until learnex creates the first virtual EXAMEN with a structure.

## Next Recommended Action

None. The change is complete and archived. The SDD cycle for `exam-admission-areas-picker` is closed.

Any follow-up changes (e.g., tutor dashboard enhancements, exam results UI, anti-fraude hardening) will start a new SDD cycle from `sdd-propose`.
