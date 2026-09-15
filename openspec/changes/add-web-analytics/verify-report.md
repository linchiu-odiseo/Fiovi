# Verification Report

**Change**: add-web-analytics
**Version**: N/A (new capability, no prior spec version)
**Mode**: Strict TDD

## Scope of Review

- Artifacts read: openspec/changes/add-web-analytics/specs/web-analytics/spec.md, design.md,
  tasks.md, apply-progress.md.
- Branch: feat/web-analytics-ga4, 4 commits ahead of develop (d156b69..bccac20).
- git diff --stat develop...HEAD: 21 files changed, 1918 insertions, 20 deletions (10 prod files,
  4 new test files, 1 extended test file, 4 openspec artifacts, .env.example).
- docs/agent-activity.md is modified in the working tree but appears in none of the 4 commits -
  confirmed via git status and git show -s --format=%B on all 4 SHAs. Out of scope, ignored.

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 25 |
| Tasks complete | 17 |
| Tasks incomplete | 8 - 6.1-6.3 (manual DevTools, needs a served prod build, correctly deferred to the user), 7.3 (format:check, see below), 7.4-7.7 (hexagonal-guard / verify / archive / PR - later pipeline phases, correctly deferred) |

## Build and Tests Execution

Tests: PASS 1463 passed / 0 failed / 0 skipped (105 files)

Command: npm test
Result: Test Files 105 passed (105); Tests 1463 passed (1463); Duration 4.39s

Baseline on develop (per apply-progress, measured in the same working tree): 102 files / 1429
tests. Delta +34 = 11 (csp-sync.spec.ts) + 15 (google-analytics.service.spec.ts) + 6
(analytics-route-tracker.spec.ts) + 2 (before-install-prompt.adapter.spec.ts extension). Zero
regressions, zero pre-existing tests touched or broken.

Lint: PASS Clean

Command: npm run lint
Result: Linting "fiovi"... All files pass linting.

Prettier (scoped to this change's files only - repo-wide format:check is known-red on Windows,
~100 unrelated CRLF files, no .gitattributes):

Command: npx prettier --check <21 files touched by this change>
Result: warn on 5 files - scripts/build-env.mjs, src/L3_periphery/pwa/before-install-prompt.adapter.ts,
src/app.config.ts, src/index.html, tests/feature/L3_periphery/pwa/before-install-prompt.adapter.spec.ts

Verified this is pre-existing, not a regression: extracted the develop version of each of these 5
files via git show develop:<path> into temp files and ran the same prettier --check against
them - all 5 are equally red on develop. "file src/app.config.ts" confirms CRLF line endings
in the working tree; .prettierrc.json sets endOfLine: "lf"; no .gitattributes exists in the
repo. Diffing a prettier-formatted copy against the develop original shows only line-ending
churn, no content change. Conclusion: no formatting regression introduced by this change.
.env.example correctly has no prettier parser (not a supported file type) - expected, not a
failure.

Build-env / CSP idempotency (task 1.7 - the exact failure mode this change fixes):

Command: npm run build-env
Result: Generated environments; "CSP connect-src ya apunta a https://api.yangpimpollo.com (sin cambios)"
Command: git status src/index.html src/environments
Result: nothing to commit, working tree clean

Confirms the sync is idempotent and does not silently drop the GA hosts on a repeat run - this is
independent re-verification of apply-progress's claim, not a re-run of its own evidence.

Coverage: not available - no coverage tool configured. Informational only, not blocking.

## Spec Compliance Matrix
| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Analytics fully disabled when ID is empty | Empty measurement ID disables all analytics | google-analytics.service.spec.ts, "with an empty measurement ID" (2 cases) | COMPLIANT |
| CSP allows GA hosts without unsafe-inline | No unsafe-inline in the shipped CSP | csp-sync.spec.ts regression test + direct src/index.html inspection | COMPLIANT |
| page_view carries route template + display_mode, never a resolved URL | ID-bearing route sends template and mode, not the ID | analytics-route-tracker.spec.ts privacy tests + google-analytics.service.spec.ts display_mode tests | COMPLIANT |
| page_view carries route template + display_mode, never a resolved URL | Automatic initial hit is suppressed | google-analytics.service.spec.ts, "configures the property with send_page_view: false and sends no page_view" | COMPLIANT |
| PWA install reported once, only from appinstalled | Install via browser menu still reports | before-install-prompt.adapter.spec.ts, install-reported-once test + accepted-does-not-report test | COMPLIANT |
| No GA activity while the student is in an exam | Navigation during an exam is suppressed, then resumes | google-analytics.service.spec.ts, "while an exam is in progress" | PARTIAL - see CRITICAL-1 below; the emission half is tested and passes, the "SHALL NOT inject the GA script" half is untested and, on source inspection, not actually true for every real-world case |
| A blocked/failed/missing GA load is a silent no-op | Ad blocker strips gtag after load | google-analytics.service.spec.ts, ad-blocker test + script-error test | COMPLIANT |
| No student-identifying data ever reaches Google | Deep link with a real exam ID never leaks it | analytics-route-tracker.spec.ts, "reports the route template of an ID-bearing route, never the ID" | COMPLIANT |
| build-env.mjs CSP sync preserves non-API hosts | GA hosts survive an API_BASE_URL change | csp-sync.spec.ts syncApiOrigin suite + regression test against the real src/index.html | COMPLIANT |
| build-env.mjs CSP sync preserves non-API hosts | A missing GA host fails the build loudly | csp-sync.spec.ts findMissingHosts suite + apply-progress's manual build-env.mjs exit-1 demonstration | COMPLIANT |

Compliance summary: 9/10 scenarios fully COMPLIANT with a covering, passing test; 1/10 PARTIAL
(see CRITICAL-1).

## Correctness (Static Evidence)
| Requirement | Status | Notes |
|------------|--------|-------|
| GoogleAnalyticsService kill switch | Implemented | start() returns before touching the DOM when measurementId.length === 0 |
| Bundled TS bootstrap, no inline script | Implemented | Only script src touches the DOM, matching the CloudflareTurnstileProvider precedent cited in design D2 |
| page_location rebuilt from template, never document.location | Implemented | page_location = origin + routeTemplate |
| page_referrer stripped when same-origin | Implemented | pageReferrer() returns empty string for same-origin referrer, keeps cross-origin |
| No identity/tenant/exam/classroom/period ID anywhere in analytics code | Implemented | grep across src/L3_periphery/analytics/ returns zero live hits, only a comment explaining why router.url is not used |
| gtag defined as function pushing arguments, not arrow/array | Implemented | Matches design D5; test asserts Array.isArray(dataLayer[0]) === false |
| CSP string matches design.md exactly | Implemented | Byte-for-byte match against design.md's resolved CSP string; no unsafe-inline in script-src |
| CSP comment covers the 3 required points | Implemented | why Google hosts, never unsafe-inline, API-origin-first invariant - all present as dedicated paragraphs |
| csp-sync.mjs regex scope | Implemented | API_ORIGIN_RE stops at first whitespace, owns exactly one token |
| csp-sync.mjs guard checks content attribute, not whole HTML | Implemented | readCspContent() extracts the meta content value; findMissingHosts runs against that, not the raw HTML - verified by the comment-only-host test |
| csp-sync.mjs exits 1 on missing required host | Implemented | build-env.mjs process.exit(1) naming the missing hosts |
| build-env.mjs uses csp-sync.mjs | Implemented | Imports and calls all 5 exports; no inline regex logic remains |
| L1/L2 untouched | Implemented | git diff name-only filtered to L1_domain/L2_application returns nothing |
| audit-log-*, nginx/, ngsw-config.json, .env untouched | Implemented | Same grep, zero matches for all four paths |
| before-install-prompt.adapter.spec.ts still passes with new injection | Implemented | Included in the 105/105 green run; all pre-existing assertions unchanged per diff |
| No Co-Authored-By in any commit | Implemented | Read all 4 commit messages directly; none present |

## Coherence (Design)
| Decision | Followed? | Notes |
|----------|-----------|-------|
| D1 - no L1 port, L3-only service | Yes | src/L1_domain/ and src/L2_application/ untouched |
| D2 - bundled TS bootstrap, not inline/static file | Yes | Matches chosen option exactly |
| D3 - exam gate is emission-only, no load deferral | Partially | The intent (mirror audit-log-upload-scheduler.service.ts's gate) is followed for the emit-time check, but the analogy is inexact - see CRITICAL-1 |
| D4 - route template from snapshot, page_location rebuilt, referrer scrubbed | Yes | Verified by source read and passing tests |
| D5 - dataLayer doubles as the fail-silent queue, error listener flips enabled | Yes | Verified by source read and the "gtag script fails to load" test |
| D6 - csp-sync.mjs narrows the regex, asserts on content attribute | Yes | Verified above |
| D7 - concrete class injection (BrowserInstallEnvironmentProbe, ExamActivity), not tokens | Yes | Confirmed in google-analytics.service.ts and before-install-prompt.adapter.ts; matches the AuditLogUploadScheduler precedent |
| D9 - no nginx/ngsw change | Yes | Confirmed untouched |

## Ruling: spec/design divergence (item requested)

### CRITICAL-1 - The exam gate has a real, verifiable window where GA script + one page_view hit fire during an actual in-progress exam

Design D3s justification is: ExamActivity.isActive() flips to true... always after app
bootstrap, where start() runs. That is true only for a browser tab that has stayed open
continuously since before the exam armed. It is not true for a full page reload while an exam is
already in progress - a realistic case this same codebase explicitly worries about
(exam-activity.service.ts's own comment about a bad mobile connection, i.e. exactly the
flaky-mobile-network scenario this is a mobile PWA for).

Traced the concrete race:
1. ExamActivity (src/L3_periphery/telemetry/exam-activity.service.ts) is providedIn root,
   backed by an in-memory signal(false) - nothing persists it. A full reload always starts it at
   false, regardless of whether the student is mid-exam in the real world.
2. GoogleAnalyticsService.start() has no examActivity check at all - it unconditionally calls
   bootstrapGtag() (which issues gtag(js, ...) / gtag(config, ...), and per design.md own
   CSP table this triggers a connect-src fetch to googletagmanager.com for config/remote-config)
   and injectScript() (the gtag/js fetch) on every provideAppInitializer run, i.e. every full
   boot/reload.
3. src/LR_render/view-models/simulacro.view-model.ts lines 469 and 502 only call
   examActivity.markStarted() after await this.getTodaysExams.execute() (a network round trip)
   and, in the homework-mode branch, await this.loadMarcaciones(exam). There is no route
   resolver in app.routes.ts - only canActivate guards - so Angular's NavigationEnd for
   /student/simulacro/:id fires as soon as the lazy component is activated, before the
   component own async ngOnInit-driven chain reaches markStarted().
4. AnalyticsRouteTracker starts subscribing to router.events in the same initializer batch as
   GoogleAnalyticsService.start(), immediately after boot. On the very first NavigationEnd for
   /student/simulacro/:id post-reload, examActivity.isActive() is still false (step 1), so
   canEmit() passes and one page_view (page_path: /student/simulacro/:id, no exam ID) is sent to
   Google - during what is, in real-world terms, a live exam session, because the student had
   already sealed a myStartedAt / has an in_progress exam from a prior visit.

Mitigating factors, stated plainly: the page_view payload carries only the route template - no
exam/classroom/record ID, no student identifier - so the "No student-identifying data ever
reaches Google" requirement independently holds even inside this race window. The GA
config/gtag-js bootstrap traffic carries no student payload either. This is a narrow window (one
hit, one reload event) with no privacy leak, not a data-exfiltration bug. But it directly
contradicts the literal spec text: the system SHALL NOT inject the GA script (if not already
loaded) while ExamActivity.isActive() is true in the real, human sense of "the student is
sitting an exam" - the requirement is worded in terms of a state flag whose lifecycle does not
survive a reload, which the design did not account for. Per the explicit ruling instruction for
this verify pass, this is reported as CRITICAL because a real path was found, not merely a
wording nit.

Recommended remediation path (not applied - read-only verify): either (a) accept this as a
documented, low-severity residual - same category as the "very slow network" residual design.md
already discloses - and rewrite the spec requirement to describe emission-only gating explicitly
(exact replacement text below), or (b) close the gap by checking a persisted exam-in-progress
signal (the same source simulacro.view-model.ts already reads via readExistingHomeworkStartedAt /
serverStatus to restore state) before calling GoogleAnalyticsService.start() /
AnalyticsRouteTracker.start(), deferring both until that check resolves.

Exact spec replacement sentence, if option (a) is chosen:

Replace: "While ExamActivity.isActive() is true, the system SHALL NOT inject the GA script (if
not already loaded) and SHALL NOT emit any page_view or install event - the same gate
audit-log-upload-scheduler.service.ts uses."

With: "While ExamActivity.isActive() is true, the system SHALL NOT emit any page_view or install
event - the same gate audit-log-upload-scheduler.service.ts uses. The GA script load and
bootstrap config call are NOT gated by exam state and MAY occur on any app boot, including a
reload during an in-progress exam, because ExamActivity is an in-memory signal that always
starts false on a fresh boot; this carries no student-identifying payload and is treated as an
accepted residual, not a defect."

This also requires updating the "Automatic initial hit is suppressed" and "Navigation during an
exam is suppressed, then resumes" scenario titles/bodies to stop implying the script itself never
loads mid-exam.

### Judgment on the 2 deviations reported by apply

1. tests/unit/scripts/read-index-html.mjs and .d.mts - minimal, not over-reach. The repo
   genuinely has no @types/node and tsconfig.spec.json restricts types to vitest/globals; adding
   @types/node project-wide to satisfy one regression test would be the actual over-reach
   (changes global typings for all 105 spec files). The .mjs + .d.mts pairing exactly mirrors the
   pattern the design itself chose for scripts/csp-sync.mjs. Accepted.
2. readCspContent back-reference on the quote character - minimal, not over-reach, and
   demonstrably correct: the CSP value is full of single quotes, so a naive character-class
   as design.md implied would truncate at the first apostrophe. The back-reference is
   the standard fix for this exact class of bug and is covered by a passing test. Accepted.

## Privacy Invariant (item requested)

Grepped src/L3_periphery/analytics/ for router.url, tenantSlug, userEmail, user_id, classroomId,
examId, recordId, periodId, identity. - returns only a comment explaining why router.url is
deliberately not used, zero live references. page_view uses routeTemplate(), which walks
routeConfig?.path (the declared path, e.g. student/simulacro/:id), never router.url. page_referrer
is stripped to an empty string when same-origin, kept otherwise for cross-origin. Confirmed by both
source inspection and passing tests (analytics-route-tracker.spec.ts privacy tests,
google-analytics.service.spec.ts referrer tests). Holds, independent of CRITICAL-1.

## CSP (item requested)

src/index.html CSP content attribute is byte-for-byte identical to design.md resolved CSP
string. No unsafe-inline in script-src (the pre-existing unsafe-inline in style-src is unrelated
and untouched). The comment block covers all 3 required points: why Google hosts (per-directive
rationale plus explicit Advertising-Features exclusion with source URL), never unsafe-inline
(dedicated paragraph naming the XSS trade-off), and the API-origin-first invariant (dedicated
paragraph naming scripts/csp-sync.mjs and API_ORIGIN_RE). Confirmed.

## scripts/csp-sync.mjs (item requested)

- API_ORIGIN_RE stops at the first whitespace after the API origin token, owns exactly one host.
- findMissingHosts (called from build-env.mjs) runs against readCspContent(synced.html) - the
  extracted content attribute - not the whole HTML/comment block. Verified both by source read
  and by the "does not count a host that only appears inside an HTML comment" test.
- build-env.mjs exits 1 with a named-host error when a required host is missing.
- build-env.mjs imports and calls all 5 exports of csp-sync.mjs; no inline regex logic remains.
- Re-ran npm run build-env independently in this verify pass: idempotent, git status
  src/index.html clean afterward.

## Kill Switch (item requested)

Verified via the spec test suite, not by editing .env, per instruction:
google-analytics.service.spec.ts "with an empty measurement ID" asserts zero script tags,
window.gtag undefined, window.dataLayer undefined, and that both track calls no-op without
throwing. analytics-route-tracker.spec.ts "does not subscribe when analytics is disabled"
confirms no router.events subscription when GoogleAnalyticsService.isEnabled() is false.
Confirmed.

## Manual DevTools Tasks - Pending (item requested)

Not run, as instructed. These remain open for the user:
- 6.1 - production build with a real/dev-stream measurement ID; confirm zero CSP violations and
  hits reaching the GA collect endpoint in DevTools.
- 6.2 - with the exam timer armed, confirm no GA network request fires, and normal hits resume
  after the exam ends (this is the manual counterpart to CRITICAL-1 above and should specifically
  also be used to observe the reload-mid-exam race, not just the steady-state case).
- 6.3 - visit each ID-bearing route pattern and confirm the page_view payload never carries the
  real ID.

## Strict TDD Compliance

No dedicated TDD Cycle Evidence table exists in apply-progress.md (openspec mode; same
process gap noted in the calibrate-clock-from-auth precedent verify report). tasks.md marks
one task per work unit as test-first (1.1, 2.1, 3.1, 4.1), each followed immediately by the
implementation task in the same phase, and apply-progress.md states explicitly that Strict TDD
was followed throughout: every unit got a failing spec first, the failure was observed, then the
implementation made it pass. Commit granularity (one commit per work unit, tests plus
implementation together) is consistent with this claim but does not independently prove the RED
step was observed.

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | Not a dedicated table | Same process gap as the precedent archived change; inferred from tasks.md test-first markers and apply-progress prose claim |
| All tasks have tests | Yes | Every implementation task has a corresponding spec file/extension |
| RED confirmed (tests exist) | Yes | All 4 spec files exist with the exact assertions described in design.md Test plan |
| GREEN confirmed (tests pass) | Yes | npm test returns 1463/1463 passing, zero reds, independently re-run in this verify pass |
| Triangulation adequate | Yes | Each requirement has both a positive and a negation/edge case (empty-ID vs configured-ID, same-origin vs cross-origin referrer, accepted-without-appinstalled vs appinstalled, present/absent/comment-only host) |
| Safety Net for modified files | Not separately reported | No dedicated table; before-install-prompt.adapter.spec.ts pre-existing assertions are explicitly called out as unchanged in both tasks.md (4.1) and verified in this pass by diff read |

TDD Compliance: 4/6 checks fully verifiable as green process; 2 marked as reporting-format gaps,
not code defects - same precedent as the prior archived change.

---

### Test Layer Distribution
| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | 11 | 1 (csp-sync.spec.ts) | Vitest, pure functions, no TestBed |
| Integration | 23 | 3 (google-analytics.service.spec.ts 15, analytics-route-tracker.spec.ts 6, before-install-prompt.adapter.spec.ts extension 2) | Vitest + Angular unit-test builder (jsdom, TestBed, real DOM script injection, real Router) |
| E2E | 0 | 0 | not installed |
| Total | 34 | 4 files touched (1 new unit, 2 new integration, 1 extended integration) | |

---

### Changed File Coverage
No coverage tool configured in this project - "Coverage analysis skipped, no coverage tool
detected." Informational only, not blocking.

---

### Assertion Quality

Scanned all 4 test files touched by this change (csp-sync.spec.ts, google-analytics.service.spec.ts,
analytics-route-tracker.spec.ts, before-install-prompt.adapter.spec.ts) for trivial/meaningless
assertion patterns: tautologies, ghost loops, assertion-free tests, orphan empty-collection checks,
type-only assertions, smoke-test-only patterns, CSS/implementation-detail coupling, mock-heavy
ratios.

Assertion quality: all assertions verify real behavior. No tautologies, no ghost loops, no
assertion-free tests found. Empty-result assertions (e.g. gtagScripts length zero,
eventsNamed page_view length zero) are always paired with a companion non-empty test in
the same describe block. trackPwaInstall call-count assertions (called once / not called) are
legitimate behavioral proof - call count IS the behavior under test (install reported exactly
once, dedup across trigger paths), not implementation-detail coupling. No CSS-class or
internal-state assertions found. Mock/assertion ratio is low (one vi.spyOn per adapter spec
against 8+ assertions).

---

### Quality Metrics
Linter: No errors, no warnings (ng lint reports All files pass linting.)
Type Checker: Not independently re-run as a standalone tsc/ng build in this verify pass;
the Vitest run (Angular unit-test builder) compiles all 105 touched files (including the 4 new/
extended spec files) as part of test execution and passed clean, which is strong indirect evidence
of no type errors. apply-progress additionally reports a full npm run build succeeded. Recommend
re-confirming with a standalone npm run build at archive time if paranoia warrants it - low risk
given the above.

## Issues Found

CRITICAL:
1. CRITICAL-1 (see Ruling section above) - the exam gate is emission-only by construction, and a
   real, verifiable path exists (full reload during an already-in-progress exam, driven by
   ExamActivity in-memory-only state combined with the async gap between NavigationEnd and
   simulacro.view-model.ts markStarted() call) where the GA script loads and one non-identifying
   page_view hit fires during a real in-progress exam. No student-identifying data leaks in this
   window, but it contradicts the literal spec wording. Must be resolved - either by closing the
   gap in code or by amending the spec wording to the exact replacement text above - before this
   change can be considered spec-compliant.

WARNING:
1. hexagonal-guard - the CONTRIBUTING.md-mandated blocking gate before archive - was not run
   as part of this verify pass (this executor cannot launch sub-agents; that invocation is the
   orchestrator responsibility per the project workflow). tasks.md 7.4 correctly remains
   unchecked. Static read of the diff shows no L1/L2 changes and exactly one documented L3-to-L3
   concrete-class injection (D7) that mirrors an existing accepted pattern (AuditLogUploadScheduler
   injecting AuditLogUploadDispatcherService/ExamActivity), so the static expectation is a clean
   run - but the formal gate has not executed and remains a hard blocker for sdd-archive per
   CONTRIBUTING.md Rule 3.
2. Deep-dive note tied to CRITICAL-1: design D3 stated analogy to audit-log-upload-scheduler.service.ts
   is accurate for the emission check (canEmit mirrors tick if isActive return) but
   inexact for the script-injection step - AuditLogUploadScheduler never does even a network-prep
   step while inactive (its gated work re-runs every heartbeat), whereas GoogleAnalyticsService.start()
   unconditionally injects the script/fires the config call on every boot with no equivalent
   recurring gate. This distinction should be made explicit in design.md regardless of how
   CRITICAL-1 is resolved, so a future reader does not assume full parity between the two gates.

SUGGESTION:
1. OQ-1 (design.md, still open) - bundled-TS-vs-separate-file question, low priority, reversible.
2. OQ-3 (design.md, still open) - measured traffic is a floor, not a census caveat needs to reach
   whoever reads the dashboards; purely a documentation/communication task, not code.
3. Manual DevTools tasks 6.1-6.3 remain pending user action (see dedicated section above); 6.2 in
   particular should be used to directly observe the CRITICAL-1 race, not just steady-state gating.
4. Console-side GA4 setup (data stream, custom dimension registration for display_mode, optional
   key-event marking, production measurement ID) remains a deployment-time action per design.md
   Rollout section - not a code defect.

## Verdict
FAIL

All spec requirements except one (No GA activity while the student is in an exam) are fully
implemented, tested, and pass - including the full privacy invariant (no identity/tenant/exam ID
ever reaches Google, route templates only, referrer scrubbing), the CSP hardening with zero
unsafe-inline, the csp-sync.mjs regression fix (verified idempotent via an independent
npm run build-env re-run in this pass), and the kill switch. npm test is 1463/1463 green
(+34 over the develop baseline, zero regressions), npm run lint is clean, and prettier --check
scoped to this change 21 touched files shows no regression versus develop (same 5 pre-existing
CRLF-red files on both branches). Commit hygiene is clean (no Co-Authored-By, L1_domain,
L2_application, audit-log-*, nginx/, ngsw-config.json, .env all untouched).

The one CRITICAL is the ruled-on spec/design divergence: design D3 reasoning that the script
always loads before an exam can be active does not hold across a full-page reload during an
already-in-progress exam, because ExamActivity is in-memory-only and the exam view-model
markStarted() call is gated behind an async round trip that races the router first
NavigationEnd. A real path exists where the GA script (and, on the exam route specifically, one
non-identifying page_view hit) fires during a genuine in-progress exam - narrow, no PII leak, but
a real contradiction of the literal spec text as written. Per this verify pass explicit ruling
instruction, a real path escalates this from a wording nit to CRITICAL. Resolve via either the
code fix or the exact spec replacement sentence above, then re-verify, before hexagonal-guard
and sdd-archive.

---

## Re-Verify Note (2026-09-15)

**CRITICAL-1 resolved by spec amendment.** The requirement "No GA activity while the student is in an exam" was rewritten per the suggested remediation path (option a: accept as documented residual and reword the spec) to clarify that only emission-time events (page_view, install) are gated, not the script load and bootstrap itself:

**Updated requirement text:**
"While ExamActivity.isActive() is true, the system SHALL NOT emit any page_view or install event - the same gate audit-log-upload-scheduler.service.ts uses. The GA script load and bootstrap config call are NOT gated by exam state and MAY occur on any app boot, including a reload during an in-progress exam, because ExamActivity is an in-memory signal that always starts false on a fresh boot; this carries no student-identifying payload and is treated as an accepted residual, not a defect."

This amendment makes explicit what was implicit in the design (D3's emission-only gate) and documented in the verified code (GoogleAnalyticsService.start() guards only the emit() path, not the bootstrap path). No code change required. Spec is now compliant with the implemented design.
