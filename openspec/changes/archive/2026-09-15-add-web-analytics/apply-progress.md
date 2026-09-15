# Apply progress: add-web-analytics

Batch 1 (and only batch). Branch `feat/web-analytics-ga4`, base `develop`.
Delivery: **single PR with `size:exception`** (decided by the user before apply), committed as three
work units. Not pushed, no PR opened, not archived — `sdd-verify` runs next.

Strict TDD was followed throughout: every unit got a failing spec first, the failure was observed,
then the implementation made it pass.

## Status: 17 of 25 checkboxes complete

Every implementation task (Phases 1–5) is done. The 8 pending are the manual DevTools checks, the
`format:check` gate, and the verify/archive/PR phases that come after apply.

| Phase | Tasks | State |
|---|---|---|
| 1 — Build-time CSP sync | 1.1 – 1.7 | done (1.7 with a substitution — see below) |
| 2 — `GoogleAnalyticsService` | 2.1 – 2.3 | done |
| 3 — `AnalyticsRouteTracker` | 3.1 – 3.2 | done |
| 4 — PWA-install hook | 4.1 – 4.2 | done |
| 5 — `app.config.ts` wiring | 5.1 | done |
| 6 — Manual verification (prod build + DevTools) | 6.1 – 6.3 | **pending — user action** |
| 7 — Final gates | 7.1 test ✓ · 7.2 lint ✓ · 7.3 format:check ✗ (see below) · 7.4 – 7.7 verify/archive/PR | partial |

## Commits

| SHA | Work unit | Subject |
|---|---|---|
| `d156b69` | 1 | `feat(infra): abre el CSP a los hosts de GA4 y hace sobrevivible el sync de connect-src` |
| `e342c85` | 2 | `feat(L3): agrega GoogleAnalyticsService con bootstrap bundleado y gate de examen` |
| `c3d8430` | 3 | `feat(L3): emite page_view por navegación y pwa_install desde appinstalled` |

The OpenSpec artifacts (`proposal.md`, `design.md`, `specs/web-analytics/spec.md`, `tasks.md`) went
into commit 1; `tasks.md` check-offs ride along with the commit that completed them.

## Files

Created:

- `scripts/csp-sync.mjs` · `scripts/csp-sync.d.mts`
- `src/L3_periphery/analytics/google-analytics.service.ts`
- `src/L3_periphery/analytics/analytics-route-tracker.ts`
- `src/L3_periphery/analytics/gtag.d.ts`
- `tests/unit/scripts/csp-sync.spec.ts`
- `tests/unit/scripts/read-index-html.mjs` · `tests/unit/scripts/read-index-html.d.mts` (not in the
  design — see Deviations)
- `tests/feature/L3_periphery/analytics/google-analytics.service.spec.ts`
- `tests/feature/L3_periphery/analytics/analytics-route-tracker.spec.ts`

Modified:

- `src/index.html` (CSP + comment) · `scripts/build-env.mjs` · `.env.example`
- `src/L3_periphery/pwa/before-install-prompt.adapter.ts`
- `tests/feature/L3_periphery/pwa/before-install-prompt.adapter.spec.ts`
- `src/app.config.ts`

Generated (gitignored): `src/environments/environment{,.production}.ts` now carry `gaMeasurementId`.

Untouched, as required: `src/L1_domain/`, `src/L2_application/`, `src/L3_periphery/telemetry/audit-log-*`,
`nginx/`, `ngsw-config.json`, `.env` (the user owns it — `PUBLIC_GA_MEASUREMENT_ID` still has to be
added there and in the deploy environment).

## Verified

- **Full suite green.** `npm test` → **105 files / 1463 tests passed**. Baseline on `develop` before
  this change, measured in the same working tree: **102 files / 1429 tests**. Delta +34 = 11
  (`csp-sync`) + 15 (`google-analytics.service`) + 6 (`analytics-route-tracker`) + 2
  (`before-install-prompt.adapter`). Zero failures, zero pre-existing tests touched.
- **`npm run lint`** → `All files pass linting.`
- **`npm run build`** → bundle generated, `ngsw.json appData.version` injected; `dist/fiovi/browser/index.html`
  ships the widened CSP.
- **The failure mode this change guards.** `npm run build-env` run twice in a row: both runs report
  `✓ CSP connect-src ya apunta a https://api.yangpimpollo.com (sin cambios)` and `connect-src` still
  reads `'self' https://api.yangpimpollo.com https://*.google-analytics.com https://*.analytics.google.com
  https://www.googletagmanager.com`. `git status` on `src/index.html` stays clean (idempotent).
- **The rewrite path, not just the no-op path.** With the origin manually set to a stale value, the
  script reported `✓ CSP connect-src actualizado: https://api.stale-origin.test → https://api.yangpimpollo.com`
  and left all three GA hosts untouched.
- **The loud-failure guard.** With `https://*.analytics.google.com` removed from `connect-src` by
  hand, `npm run build-env` printed
  `✘ Faltan hosts requeridos en el CSP de src/index.html: https://*.analytics.google.com.` and exited
  **1**. File restored afterwards.
- **No `'unsafe-inline'`** anywhere in `script-src`; `object-src 'none'`, `base-uri 'self'`,
  `form-action 'self'` unchanged; no wildcard in `script-src`.

Task 1.7 asked for `npm run dev`, `npm run build` and `npm test` in sequence. The dev server was not
started (it never exits); `npm run build` and `npm test` both ran, and the `predev` hook is literally
`npm run build-env` — the same command that ran twice back to back with the result above.

### `npm run format:check` — red, and it was red before this change

It reports **100 files**. This is the known Windows CRLF problem: the repo has no `.gitattributes`,
files are checked out with CRLF, and `.prettierrc.json` sets `endOfLine: "lf"`, so essentially every
checked-out file fails. Measured, not assumed: every file this change touches was normalized to LF
and checked with the repo config, both at `develop` and at HEAD — **all clean in both**. The change
introduces no formatting regression, and running `prettier --write` to make the gate green would
repaint ~100 unrelated files. `docs/agent-activity.md` also shows as modified in the working tree;
it is written by tooling outside this change and was left alone and uncommitted.

## Deviations from the design

1. **`tests/unit/scripts/read-index-html.{mjs,d.mts}` was added** (the design listed only the spec).
   The regression case must read the real `src/index.html`, but the repo has no `@types/node` and
   `tsconfig.spec.json` restricts `types` to `vitest/globals`, so `node:fs`, `node:path` and
   `process` have no typings inside a `.spec.ts`. The alternatives were adding a dependency plus
   `"node"` to `types` (which would change global typings for all 105 spec files) or faking ambient
   module declarations. Instead the file read lives in plain `.mjs` with a one-line `.d.mts` — the
   same pairing the design already chose for `scripts/csp-sync.mjs`.
2. **`readCspContent`'s regex back-references the quote character** instead of the design's implied
   `content="([^"']*)"`. Caught by the first red run: the CSP value is full of single quotes
   (`'self'`, `'none'`), so a `[^"']` class returned `default-src ` and the test failed.
3. **The exam gate is emission-only** (per the user's binding instruction and design D3), while
   spec.md's requirement "No GA activity while the student is in an exam" is worded as "SHALL NOT
   inject the GA script (if not already loaded)". No guard was added to `start()`. In practice the
   requirement holds by construction: `start()` runs in `provideAppInitializer` at bootstrap, and
   `ExamActivity` is an in-memory signal that is always `false` at that moment — it only flips when
   the simulacro view-model arms the timer, which is necessarily later, including after a reload
   mid-exam. Flagged here so `sdd-verify` can rule on the wording rather than discover it.

## Pending — user action

- **6.1 / 6.2 / 6.3 (manual, DevTools).** Not run: they need a real browser against a deployed or
  served production build with a non-empty measurement ID, which this environment cannot do. To
  close them: set `PUBLIC_GA_MEASUREMENT_ID` (dev/staging stream, not `G-LV9RXZP838`) in `.env`, run
  `npm run build`, serve `dist/fiovi/browser`, then with DevTools open confirm (a) zero CSP
  violations in the console and hits reaching `*.google-analytics.com/g/collect`, (b) no GA request
  while the exam timer is armed and normal hits once it ends, (c) on each ID-bearing route
  (`app.routes.ts:43`, `:64`, `:109`, `:117`) the `page_view` payload carries only the template.
- **Console-side setup** (design.md Rollout): create the dev/staging data stream, register
  `display_mode` as an event-scoped custom dimension — unregistered parameters are collected but
  never show up in reports — optionally mark `pwa_install` as a key event, and set
  `PUBLIC_GA_MEASUREMENT_ID=G-LV9RXZP838` in the production deploy environment.
- **7.4 `hexagonal-guard`, 7.5 `sdd-verify`, 7.6 `sdd-archive`, 7.7 PR** — later phases, untouched.

## Notes for verify

- `GoogleAnalyticsService` injects the concrete `BrowserInstallEnvironmentProbe` and `ExamActivity`
  (design D7) rather than `INSTALL_ENV_PROBE`. That is the documented L3→L3 exception; it is what
  keeps `before-install-prompt.adapter.spec.ts` building its TestBed with
  `providers: [BeforeInstallPromptAdapter]` and no analytics binding. Precedent:
  `AuditLogUploadScheduler` injects `AuditLogUploadDispatcherService` and `ExamActivity` the same way.
- OQ-1 stays open: the bootstrap is bundled TypeScript, not a separate `public/ga-bootstrap.js`.
- OQ-3 stays open and belongs in whatever document introduces the dashboards: measured traffic is a
  floor, not a census.
