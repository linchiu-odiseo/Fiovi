# Archive Report: restyle-tutor-pages

**Date Archived:** 2026-07-09  
**Change Name:** `restyle-tutor-pages`  
**Branch:** `chore/restyle-tutor-pages`  
**Status:** COMPLETE — SDD cycle closed  
**Verdict:** Ready to merge into main branch

---

## Executive Summary

The `restyle-tutor-pages` change has successfully completed all 8 SDD phases (Explore → Propose → Spec → Design → Tasks → Apply → Verify → Archive). The change applies Native Excellence visual system alignment to tutor pages (`tutor-exams-list`, `tutor-exam-detail`) by replacing 15 hex color literals with design tokens, adding a localized Spanish status chip (Programado/En curso/Finalizado), and refining the header and navigation styling. All 984 feature tests pass. Zero hexagonal-guard violations. Delta specs have been merged into main specifications. The change is archived and ready for PR.

---

## Scope of the Change

### In Scope — 5 Core Restyle Files

The restyle is confined exclusively to the following 5 LR_render files:

1. **`src/LR_render/pages/tutor-exams-list/tutor-exams-list.page.html`**  
   - Removed `<span class="exam-card__course">{{ exam.courseId }}</span>` (UUID hidden from DOM)
   - Replaced `<dl>` profile metadata with `<ul class="user-info">` (Material Symbols icons: mail, badge)
   - Added `.exam-card__strip` span for lateral color indicator by exam state

2. **`src/LR_render/pages/tutor-exams-list/tutor-exams-list.page.scss`**  
   - Replaced 7 hex fallbacks → design tokens (`--color-error`, `--color-surface-container-*`, `--color-primary`, `--color-outline-variant`, `--color-on-surface-variant`, `--color-success`)
   - Added `.exam-card__strip` block with state-based background colors
   - Configured `opacity: 0.7` for scheduled exams

3. **`src/LR_render/pages/tutor-exam-detail/tutor-exam-detail.page.html`**  
   - Replaced `{{ detail.status.value }}` with `{{ statusChip(detail.status.value).label }}` (Spanish localization)
   - Updated btn-volver: `<span class="material-symbols-outlined">chevron_left</span> Volver`
   - Added `data-testid="status-chip"` container (no Material Symbols descendants for test compatibility)

4. **`src/LR_render/pages/tutor-exam-detail/tutor-exam-detail.page.scss`**  
   - Replaced 8 hex literals → design tokens across all sections (header, buttons, student list)
   - Added `:host { display: block; min-height: 100dvh }` (iOS overscroll fix)
   - Added `&__status-chip` BEM blocks with 3 state modifiers (`--scheduled`, `--in-progress`, `--finalized`)
   - Added `&__btn-volver` tinted button styling (transparent background, primary color, 44pt tap target)
   - Changed `max-width` from 42rem → 28rem (alignment with list and home)

5. **`src/LR_render/pages/tutor-exam-detail/tutor-exam-detail.page.ts`**  
   - Added `protected statusChip(status: ExamServerStatusValue): { label: string; modifier: string }` helper
   - Maps `'scheduled'` → "Programado" / `'in_progress'` → "En curso" / `'finalized'` → "Finalizado"

### Out of Scope

- No changes to `L1_domain`, `L2_application`, `L3_periphery` layers
- No changes to tutor view-models (`tutor-*.view-model.ts`)
- No changes to tutor store (`tutor-exams.store.ts`)
- No changes to test files (`tests/feature/LR_render/pages/tutor-*/*.spec.ts`) — tests are immutable and all pass
- No `data-testid` renamed or moved
- No new npm dependencies

---

## Requirements Met

### Spec: tutor-exam-list (MODIFIED + ADDED)

✓ **Tarjetas con 3 estados via Signals** — Exam cards render with lateral color strip; scheduled cards have opacity 0.7; strip colors via tokens (`--color-outline`, `--color-success`, `--color-outline-variant`)  
✓ **courseId NOT in DOM** — `<span class="exam-card__course">` removed; grep confirms 0 matches  
✓ **Ruta /tutor/home header completo** — kicker + greeting + `.user-info` (mail/badge icons) replaces `<dl>`  
✓ **Jerarquía visual Native Excellence** — kicker 0.75rem/700, greeting 1.625rem/700 via `--font-display`  
✓ **DOM order preserved** — profile → classrooms → exams, no reordering  
✓ **data-testid conservation** — 11 testids preserved in original elements  
✓ **Tests inmutables** — npm test: 984/984 pass; 0 test files modified

### Spec: tutor-exam-management (MODIFIED + ADDED)

✓ **Back button (iOS safe)** — `Router.navigate(['/tutor/home'])` (not `history.back()`)  
✓ **btn-volver styling** — chevron_left icon + "Volver" text, tinted primary color, transparent background, 44px tap target  
✓ **Chip de estado localizado** — data-testid="status-chip" renders Spanish labels only (no Material Symbols descendants)  
✓ **statusChip() in page.ts** — not in view-model (correct layer assignment)  
✓ **Chip modifiers** — BEM classes `--scheduled`, `--in-progress`, `--finalized`  
✓ **Tests inmutables** — 984/984 pass; 0 test files modified

### Spec: design-tokens (MODIFIED + ADDED)

✓ **Cero hex literales en LR_render** — Grep `#[0-9a-fA-F]{3,8}` in tutor pages = 0 matches  
✓ **Token substitution complete** — 15 hex → design tokens; all tokens pre-exist in `src/styles.scss`  
✓ **Spacing/radius/font via tokens** — `var(--space-*)`, `var(--radius-pill)`, `var(--font-display)`  
✓ **Restricciones de capa** — Only `src/LR_render/pages/tutor-{exams-list,exam-detail}/*` modified  
✓ **hexagonal-guard report** — 0 violations (100% LR_render, no boundary crossings)

---

## Test Coverage

| Layer | Result |
|-------|--------|
| Unit (L1/L2) | N/A — change is 100% LR_render |
| Feature (tutor-exams-list) | 984/984 PASS |
| Feature (tutor-exam-detail) | 984/984 PASS |
| Lint (`npm run lint`) | PASS — 0 errors, 0 warnings |
| Format (`npm run format:check`) | PASS |
| Hex audit (grep) | 0 matches in tutor SCSS files |

**Observation:** docs/agent-activity.md was modified in working tree by subagents (automatic logging). This file is NOT part of the restyle scope. Recommendation: exclude from restyle commit; stage/commit separately as `chore(logs)` if desired.

---

## Parallel Commits in Branch (Out of Scope Documentation)

The following 4 commits are committed in branch `chore/restyle-tutor-pages` but **NOT part of the declared scope of the restyle**. They were audited by `hexagonal-guard` during Apply phase: 0 violations. They implement dev-tools and demo-sheet features and should ideally be separated into future dedicated SDD changes for hygiene, but they are included in this PR for operational convenience.

| Commit Hash | Description | Files Affected |
|-------------|-------------|-----------------|
| 0fe2e42 | feat(env): DEV_TOOLS flag | `.env.example`, `scripts/build-env.mjs` |
| 0f5b788 | feat(LR/simulacro): Botón dado (dev) para marcar aleatoriamente cartilla | `src/LR_render/pages/simulacro/*`, `src/LR_render/view-models/simulacro.view-model.ts` |
| 744d37f | feat(LR): /demo-sheet mock sin back | `src/LR_render/pages/demo-sheet/*` (NEW), `src/LR_render/app.routes.ts`, `src/LR_render/view-models/demo-sheet.view-model.ts` (NEW) |
| af8b151 | feat(LR/home): Atajo dev 'Demo sheet' en header | `src/LR_render/pages/home/home.page.*` |

**Status:** All 4 commits are clean of boundary violations. Suggestion: Future PR should segregate dev-tools and demo-sheet into their own SDD changes for clearer commit history. Current PR is acceptable as-is because: (1) they were approved during Apply/Verify phases, (2) hexagonal-guard saw no violations, (3) they don't interfere with the restyle (different modules).

---

## Artifacts Archived

**Archived Folder Location:**  
`openspec/changes/archive/2026-07-09-restyle-tutor-pages/`

**Contents:**
- `proposal.md` — Original change intent and scope
- `design.md` — Technical decisions and architecture rationale
- `specs/tutor-exam-list/spec.md` — Merged into main spec (delta applied)
- `specs/tutor-exam-management/spec.md` — Merged into main spec (delta applied)
- `specs/design-tokens/spec.md` — Merged into main spec (delta applied)
- `tasks.md` — Checklist of implementation work
- `verify-report.md` — Verification evidence (0 blockers, 984/984 tests pass)
- `archive-report.md` — This document

**Main Specs Updated:**
- `openspec/specs/tutor-exam-list/spec.md` — MODIFIED + ADDED requirements merged
- `openspec/specs/tutor-exam-management/spec.md` — MODIFIED + ADDED requirements merged
- `openspec/specs/design-tokens/spec.md` — MODIFIED + ADDED requirements merged

---

## Key Design Decisions Retained in Archive

1. **statusChip() placement:** In `page.ts` (presentation layer), not view-model (prevents layer confusion)
2. **max-width alignment:** 28rem in detail to match list/home (mobile-first priority)
3. **Chip testid:** `status-chip` (distinct from legacy `status-badge` for independent assertion)
4. **Strip implementation:** `<span>` absolute vs `border-left` (border conflicts with card border; span allows independent styling)
5. **user-info class name:** Public class without BEM prefix (per spec requirement for literal DOM assertion)
6. **Chip modifier semantics:** `in-progress` is only state with highlight color (success-container); scheduled/finalized neutral

---

## Rollback Plan

Rollback is straightforward and low-risk:
- `git revert` of the commit range covering all 5 files + 4 parallel commits
- No data migration needed (purely cosmetic LR_render)
- No IndexedDB or server-side state affected
- Tests revert to original baseline automatically

Post-revert: All tests continue to pass against the original HTML/SCSS (the codebase before the PR).

---

## Follow-up Recommendations

1. **Separate SDD changes for dev-tools** — Create dedicated `sdd-new` changes for:
   - `add-dev-tools-env-flag` (env scaffolding)
   - `add-demo-sheet-page` (demo cartilla mock)
   - `add-simulacro-random-button` (dev helper for marking)

2. **Tutor feature expansion** — Once this PR merges, consider:
   - Tutor dashboard with class activation controls
   - Exam results post-submission
   - Student submission history
   - Anti-fraud hardening (if needed)

3. **docs/agent-activity.md** — Establish protocol for logging and commit strategy (currently uncommitted in working tree).

---

## Verification Checklist (Pre-Merge)

Before merging to `develop` and opening the PR:

- [ ] Branch name is `chore/restyle-tutor-pages`
- [ ] All 5 tutor page files are staged
- [ ] docs/agent-activity.md is excluded from restyle staging
- [ ] 4 parallel commits are staged separately or documented in PR description
- [ ] `npm test` = 984/984 PASS
- [ ] `npm run lint` = 0 errors, 0 warnings
- [ ] `npm run format:check` = PASS
- [ ] `grep -rE '#[0-9a-fA-F]{3,8}' src/LR_render/pages/tutor-*` = 0 matches
- [ ] `git log --oneline | head -10` shows expected commits
- [ ] `ls openspec/changes/` shows only `archive/` (no active changes)
- [ ] hexagonal-guard audit = 0 violations

---

## Engram / Memory Record

This archive report is saved to the memory system with topic key `sdd/restyle-tutor-pages/archive-report` for future reference and traceability. The report can be retrieved to answer questions about:
- What was in the restyle and why
- What architectural decisions were made
- How parallel commits fit into the history
- Rollback procedure if needed
- Follow-up work recommendations

---

**Signed Off By:** SDD Archive Executor (Claude Code)  
**Date:** 2026-07-09  
**Result:** Cycle Complete ✓
