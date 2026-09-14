# Archive Report: calibrate-clock-from-auth

**Archived:** 2026-09-14  
**Change:** `calibrate-clock-from-auth`  
**Status:** Complete — all implementation phases passed (verify-report PASS, 1429/1429 tests green, no CRITICAL issues); hexagonal-guard APROBADO

## Change Summary

This change fixes session expiration and refresh-scheduler timing bugs caused by skewed device clocks by introducing the `AuthSession` value object, calibrating the server-anchored `Clock` from `serverTime` in auth responses (`/auth/login`, `/auth/select-tenant`, `/auth/refresh`, `/auth/me`), and updating session expiration checks and refresh delay computation to use the calibrated `Clock` instead of raw `Date.now()`.

**Change scope:**
- Added L1 value object `AuthSession` (identity + optional serverTime)
- Modified L1 `AuthRepository` port signatures to return `AuthSession` instead of `Identity`
- Updated L3 `HttpAuthRepository` adapter to parse `serverTime` from auth responses and wrap results in `AuthSession`; invalid `serverTime` values are silently logged and discarded
- Created test fixture `authSession()` helper to simplify new `AuthSession`-returning test call sites
- Updated 4 L2 auth use cases (`LoginUseCase`, `SelectTenantUseCase`, `RefreshIdentityUseCase`, `InitializeSessionUseCase`) to inject `Clock` and calibrate before persisting and scheduling
- Refactored `GetIdentityUseCase` to accept `Clock` and use `clock.now()` for expiration evaluation instead of `nowMs()` closure
- Updated `BrowserSessionRefreshScheduler` to inject `Clock` (CLOCK token from app.config) and compute delay from calibrated clock
- Wired `Clock` as a dependency for 5 use case factories in `app.config.ts`
- Documented `serverTime` field in `agents/api-contract.md`

Estimated volume: ~400 changed lines (~180 prod + ~220 test) across ~16 files. Single PR (size:exception decision by user).

## Specs Merged into Main Source of Truth

### auth-session
- **Location:** `openspec/specs/auth-session/spec.md`
- **Action:** MODIFIED + ADDED
- **Modified sections:**
  - "Puerto `AuthRepository` evolucionado" — updated signature to return `AuthSession` instead of `Identity`; added scenarios for plain signature exposure and `AuthSession.identity` preservation
  - "`GetIdentityUseCase`" — added Clock parameter, replaced `nowMs()` closure with Clock port; added two skew scenarios (calibrated and uncalibrated device clock)
- **Added sections:**
  - "`AuthSession` empareja `Identity` con el `serverTime`" — new L1 VO definition, three scenarios (present+valid, absent, invalid)
  - "`login`, `selectTenant`, `refresh` y `me` calibran el `Clock`" — calibration order (before persist, before schedule), seven scenarios covering all 4 use cases and the failure case
- **Capabilities:** auth-session (OAuth/session management with server-anchored time)

### server-time-sync
- **Location:** `openspec/specs/server-time-sync/spec.md`
- **Action:** MODIFIED
- **Modified sections:**
  - "Captura del `serverTime`" — expanded scope from GET /simulacros only to include auth endpoints; documented optional/invalid field handling
  - "Countdowns en la UI usan el `Clock`" — added two new scenarios (session expiration and refresh scheduler delay) to demonstrate cross-layer benefit of calibration
- **Capabilities:** server-time-sync (clock calibration from server responses)

## Verification Summary

**Verify Result:** PASS (0 CRITICAL, 0 WARNING, 2 SUGGESTION)

**Test Results:** 1429/1429 tests pass
- The 7 pre-existing reds in `cloudflare-turnstile-provider.spec.ts` were already fixed in develop's commit 3dd175c before this branch
- Zero new test failures introduced

**Static Compliance Verified:**
- All 21 spec scenarios have covering, passing tests
- Calibration order enforced: explicit order-array assertion in `login.use-case.spec.ts`; equivalent blocks in `select-tenant`, `refresh-identity`, `initialize-session` specs
- `GetIdentityUseCase` and `BrowserSessionRefreshScheduler` read time exclusively through `Clock` port; zero `Date.now()` remains in either file
- `ServerAnchoredClock` unchanged; still anchors to `Date.now()`; only offset updated via `setServerTime()`
- Guards and credentials interceptor byte-for-byte unchanged from develop
- TDD Mode: tasks.md test-first markers and passing tests verify RED→GREEN path

**Warnings (informational, not blocking):**
1. No dedicated `apply-progress.md` TDD evidence table produced (same process gap noted in prior archived change; does not block archive)
2. Task 8.5 (`hexagonal-guard`) was deferred to orchestrator per rule #3; now APROBADO

**Hexagonal-Guard Verdict:**
- APROBADO — no critical violations
- `AuthSession` is a plain L1 VO (same shape as `SelectionChallenge`); zero behavior
- No new mapper violations
- `BrowserSessionRefreshScheduler`'s `CLOCK` import from `app.config.ts` matches pre-existing accepted pattern (`envio-retry-dispatcher.service.ts` imports `CONNECTIVITY` the same way)

## Artifacts in Archive

```
openspec/changes/archive/2026-09-14-calibrate-clock-from-auth/
├── proposal.md
├── design.md
├── tasks.md (all 27 tasks documented; 25 complete, 2 deferred/orchestrator)
├── verify-report.md (PASS; 0 CRITICAL, 0 WARNING, 2 SUGGESTION; 1429/1429 tests green)
├── archive-report.md (this file)
└── specs/
    ├── auth-session/spec.md (delta, merged into main)
    └── server-time-sync/spec.md (delta, merged into main)
```

## Main Spec Files Updated

```
openspec/specs/
├── auth-session/spec.md ← MODIFIED + ADDED (5 new requirements, 2 modified)
└── server-time-sync/spec.md ← MODIFIED (2 requirements updated with auth+scheduler scenarios)
```

## Rollback Plan

The change is strictly additive with no breaking changes:
- `AuthSession` VO is new; existing `Identity` consumers within those use cases are wrapped, not refactored
- `Clock` injection is additive to existing constructor parameters in all 5 use cases
- Calibration from `serverTime` is conditional (silently skipped if `null`); guards old behavior without requiring backend upgrade
- No data migrations, no localStorage schema changes, no backend contract beyond optional `serverTime` field

Rollback: revert the single PR. No residual state changes to clean up.

## Deployment Dependency

**Critical order:** Learnex must ship `serverTime` in auth responses (`/auth/login`, `/auth/select-tenant`, `/auth/refresh`, `/auth/me`) BEFORE this PR is merged, or AFTER (either order is safe). Fiovi treats `serverTime` as optional, so:
- If learnex deploys first: Fiovi will calibrate from day one
- If Fiovi deploys first: calibration will be silent no-op until learnex ships `serverTime`
- Once both are live: session expiry and refresh scheduling will be correctly anchored to server time, fixing the device-clock-skew bug

Recommendation: learnex deploys `serverTime` support, then Fiovi merges this PR.

## Technical Debt (Pre-existing)

None introduced by this change. All pre-existing technical debt (e.g., hexagonal-guard findings from prior changes) remains unmodified.

## Known Limitations

1. If a student's device clock is skewed but learnex has not yet deployed `serverTime`, the calibration will not happen and the session will remain vulnerable to local clock drift. Mitigation: learnex deployment is the gate (noted in Deployment Dependency above).

## Next Recommended Action

1. Verify learnex has merged PR adding `serverTime` to auth responses
2. Merge this PR to `develop` (single PR, ~400 changed lines, decided as size:exception by user)
3. Deploy to testing/staging for integration verification
4. Monitor for any clock-related session issues in production
5. Next candidate change: dashboard tutor real, results post-envío, or anti-fraude hardening

## SDD Cycle Complete

The change has been fully planned (proposal), designed (design.md decisions), tasked (tasks.md with workload forecast), implemented (1429/1429 tests passing), verified (PASS, no CRITICAL), and archived. It is ready for merge.
