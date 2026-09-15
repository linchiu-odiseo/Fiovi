# Proposal: Add Google Analytics 4 for traffic, device and PWA-install measurement

## Intent

Fiovi has zero visibility into its own audience. Nobody can answer three basic product questions:

1. **How many people arrive** (sessions / unique users over time).
2. **From what devices** they arrive (mobile vs desktop, OS, browser).
3. **How many install the PWA** — the metric that justifies the install card work already shipped
   (`openspec/specs/pwa-install-prompt/spec.md`).

Question 2 is free in GA4 (automatic device/platform dimensions, no code). Questions 1 and 3 need a
tag on the page and one event, respectively. That is the entire ask.

This is deliberately **not** a telemetry program. Fiovi already has its own audit log
(`src/L3_periphery/telemetry/audit-log-*`, capability `audit-log-capture`) for forensic marking
data uploaded to learnex. GA answers an unrelated, coarse, marketing-level question and must stay
separate from it.

Two facts make this non-trivial and worth a change instead of a one-line paste:

- **The stock Google snippet cannot run in this app.** `src/index.html:41-44` ships a meta CSP with
  `script-src 'self' https://challenges.cloudflare.com` and `connect-src 'self' https://api.yangpimpollo.com`.
  Google's snippet fails twice: the external `googletagmanager.com` script is blocked, and the inline
  bootstrap block is blocked.
- **`scripts/build-env.mjs:173` rewrites `connect-src` on every run.** The regex
  `/(connect-src\s+'self'\s+)([^;"']+)/` captures *everything* between `connect-src 'self' ` and the
  next `;` and replaces it with the origin derived from `API_BASE_URL` (rewrite at `:184-190`), on
  every `predev` / `prebuild` / `pretest` hook. GA hosts added to that directive by hand are silently
  deleted on the next build.

## Scope

### In Scope

- **CSP**: extend `src/index.html`'s meta CSP with the Google hosts strictly required
  (`script-src` += `https://www.googletagmanager.com`; `connect-src` += the GA4 collection hosts).
  Exact host list is pinned in `design.md` from observed DevTools blocks — no speculative wildcards.
- **`scripts/build-env.mjs`**: make the `connect-src` sync narrow enough to survive extra hosts.
  Today it owns the whole directive tail; it must own only the API origin token. Plus a guard that
  fails loudly if the GA hosts disappear from the rewritten CSP.
- **Config**: new optional `PUBLIC_GA_MEASUREMENT_ID` in `.env` → `environment.gaMeasurementId`,
  following the exact precedent of `PUBLIC_CAPTCHA_SITE_KEY` (`scripts/build-env.mjs:100-101`):
  public material, empty by default, empty ⇒ feature is a no-op. Production uses `G-LV9RXZP838`;
  dev/staging uses a second GA4 data stream so dev traffic never lands in the student property.
- **L3 adapter** (`src/L3_periphery/analytics/`): defines `dataLayer`/`gtag` **in bundled TypeScript**
  (see the security decision below), injects the `googletagmanager.com` script tag once, configures
  with `send_page_view: false`, and exposes two calls: `trackPageView(routeTemplate)` and
  `trackPwaInstall()`. Every path is `try/catch`-wrapped and no-ops when the ID is empty, when the
  script fails to load, or when an ad blocker removes `gtag`.
- **SPA page_view**: emitted on Angular `NavigationEnd`, sending the **route template**
  (`/student/simulacro/:id`), never the resolved URL — see Privacy below.
- **PWA install event**: hooked at the single place where a completed install is already known —
  `BeforeInstallPromptAdapter.onAppInstalled` (`src/L3_periphery/pwa/before-install-prompt.adapter.ts:52-55`,
  listener registered at `:62`). That handler fires once per install via *any* path, including the
  browser menu. `trigger()`'s `'accepted'` outcome (`:81`) is **not** used — accepted means the user
  tapped Install, not that the install completed.
- **iOS install visibility**: `appinstalled` never fires on iOS. A single `display_mode`
  (`standalone` | `browser`) parameter on `page_view`, read from the existing
  `BrowserInstallEnvironmentProbe.isStandalone()` (`src/L3_periphery/pwa/browser-install-environment-probe.ts:27-40`),
  lets GA segment sessions running as an installed app. This is the one addition beyond the literal
  three metrics; without it question 3 is unanswerable for every iOS student.
- **Exam gate**: no GA script injection and no event emission while the student is taking an exam.
  Reuses `ExamActivity.isActive()` (`src/L3_periphery/telemetry/exam-activity.service.ts:18`),
  the same signal `audit-log-upload-scheduler.service.ts:42` already uses for this exact reason.

### Out of Scope

- **Any backend work.** GA hits go to Google's hosts. Zero learnex changes, zero `api-contract.md`
  changes.
- **nginx.** `nginx/security-headers.conf:26` emits only `Content-Security-Policy "frame-ancestors 'none'"`,
  which does not constrain scripts or connections. Confirmed: no change needed.
- **The existing audit log.** `src/L3_periphery/telemetry/audit-log-*` is untouched — not merged with
  GA, not sharing its IDB store, not sharing its upload scheduler. It uses `HttpClient` deliberately
  (it needs the response, retries and the 401 refresh path); GA does not.
- **A provider-agnostic analytics port in L1.** There is one provider, three metrics, and no second
  candidate. An abstraction here buys nothing and costs a port, a fake and a wiring layer.
- **An event taxonomy** (login, exam start, submit, funnel steps). Not asked for. Each future event
  is a separate, cheap change.
- **Consent banner / CMP, GA user-ID, cross-device identity, Google Ads or Signals linking.**
- **`'unsafe-inline'` anywhere in the CSP.** See below.
- **Rebuilding PWA install detection.** It exists and is reused as-is.

## Capabilities

### New Capabilities

- `web-analytics`: page-view measurement on SPA navigation, PWA-install event reporting, environment-
  scoped measurement ID, the no-op-when-unavailable contract, the exam-time suppression gate, and
  the privacy constraints on what may leave the device.

### Modified Capabilities

- None. `pwa-install-prompt` gains a call site inside its adapter but no observable behavior change:
  no new requirement, no changed outcome, no changed card state.

## Approach

**No inline script — this is the security decision of the change.** The stock GA snippet is an inline
`<script>` block, and allowing it means adding `'unsafe-inline'` to `script-src`. That directive is
the whole point of the CSP: the comment at `src/index.html:27-40` states it exists as defense against
an XSS that exfiltrates session material (design D4). `'unsafe-inline'` would let *any* injected
`<script>` in the document run, which is precisely the attack the policy was written to stop — and it
would trade that protection for a page-view counter. Instead, the `dataLayer` / `gtag` bootstrap lives
in ordinary bundled TypeScript inside the L3 adapter, which the browser loads as first-party app code
under `script-src 'self'`. Only the external `gtag/js` file needs a new host. **A future maintainer
who sees Google hosts in this CSP must not conclude that `'unsafe-inline'` is the natural next step:
it is rejected here on purpose, and nothing in GA4 requires it.**

**Privacy — no student data reaches Google.** Users are minors sitting exams. No user ID, no email,
no `tenantSlug`, no exam/classroom/record ID, no answers, no scores, no GA `user_id`. Routes carry
identifiers (`src/LR_render/app.routes.ts:43`, `:64`, `:109`, `:117`), so `page_view` must send the
**route template**, with `page_location` and `page_path` set explicitly rather than letting gtag read
`document.location`. `send_page_view: false` at config time is mandatory, not an optimization: the
automatic initial hit would otherwise leak the real URL of a deep link such as
`/student/simulacro/9f3a…`.

**Layering.** GA is infrastructure and lives entirely in L3 plus thin wiring in `app.config.ts`.
L1 and L2 stay pure — no new port, no new use case, no `@angular/*` or browser API crossing a
boundary. No UI strings are added, so the es-PE neutral-Spanish rule has nothing to constrain here.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/index.html` | Modified | CSP: add `googletagmanager.com` to `script-src`, GA collection hosts to `connect-src`; extend the D4 comment with the `'unsafe-inline'` rejection |
| `scripts/build-env.mjs` | Modified | Narrow `cspConnectSrcRe` (`:173`) to the API-origin token only; add `PUBLIC_GA_MEASUREMENT_ID`; guard that GA hosts survive the rewrite |
| `.env.example` | Modified | Document `PUBLIC_GA_MEASUREMENT_ID` (optional, empty ⇒ disabled) |
| `src/environments/` | Generated | `gaMeasurementId` field — never edited by hand |
| `src/L3_periphery/analytics/google-analytics.service.ts` | Added | Loader + `trackPageView` + `trackPwaInstall`, fail-silent |
| `src/L3_periphery/analytics/analytics-route-tracker.ts` | Added | `NavigationEnd` → route template → `trackPageView` |
| `src/L3_periphery/pwa/before-install-prompt.adapter.ts` | Modified | `onAppInstalled` (`:52-55`) also emits the install event |
| `src/app.config.ts` | Modified | Start the route tracker in `provideAppInitializer` |
| `tests/feature/L3_periphery/analytics/*.spec.ts` | Added | Disabled-ID no-op, blocked-script no-op, route-template scrubbing, exam gate, install event |

Estimated volume: ~180 LOC prod + ~200 LOC test across ~9 files. Single PR to `develop`
(branch `feat/web-analytics-ga4`).

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| **`build-env.mjs:173` silently strips the GA hosts from `connect-src`.** This is the highest-risk part of the change: the build does not fail, lint does not fail, tests do not fail — GA simply stops reporting from production browsers, and nobody notices for weeks | **High** if unaddressed | Narrow the regex to the single API-origin token; add an explicit post-rewrite assertion in the script that the GA hosts are still present and `process.exit(1)` if not (the script already uses this loud-failure pattern at `:175-181`); add a test that runs the sync against a fixture `index.html` |
| Widening `script-src` weakens the CSP | Low | One host added (`googletagmanager.com`), no `'unsafe-inline'`, no wildcard in `script-src`. `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` unchanged |
| Ad blockers / school network filters block GA | **High (expected)** | Treated as normal operation, not an error: every entry point no-ops. Measured traffic is a floor, not a census — this must be stated when the numbers are read |
| Dev/test traffic pollutes the production property | Medium | Separate GA4 data stream for dev/staging; `.env` default is empty (disabled), and `pretest` regenerates `environment.ts` so tests run with GA off |
| Route template mapping misses a route and leaks a real ID | Low | Read the template from `ActivatedRoute.routeConfig`, never from `router.url`; explicit test on an ID-bearing route |
| GA changes the install/device dimensions or the collection endpoints | Low | Endpoints are config (CSP + one const), not logic; failure mode is missing data, never a broken app |
| Someone later "fixes" a blocked GA call by adding `'unsafe-inline'` | Medium | Rationale recorded in this proposal, in `design.md`, and in the `src/index.html` comment itself |

## Alternatives considered

- **Paste Google's stock snippet and add `'unsafe-inline'`** — rejected: destroys the CSP's stated
  purpose (D4) for a page-view counter. Detailed above.
- **Move the bootstrap to a static `public/ga-bootstrap.js` file** — rejected as unnecessary: bundled
  TypeScript is already first-party `'self'` code, and a static file would need a second channel to
  receive the environment-specific measurement ID.
- **A second `window.addEventListener('appinstalled')` in the analytics service, leaving the PWA
  adapter untouched** — rejected: two listeners for one fact means two places to keep in sync. The
  existing handler is already the single point where "installed" is known.
- **Server-side / self-hosted analytics (Plausible, Umami, learnex-side counters)** — rejected for
  this change: the property already exists (`G-LV9RXZP838`), GA4 answers question 2 with no code, and
  a backend counter reopens work in learnex that this change explicitly avoids.
- **An `Analytics` port in L1 with a GA adapter in L3** — rejected: one provider, three metrics,
  no second candidate. Pure ceremony under `agents/architecture-rules.md`'s own anti-patterns.

## Rollback Plan

Revert the PR. No persisted state, no schema, no migration, no backend coordination. The GA4 property
keeps whatever it already collected; the app stops sending. If only GA misbehaves, setting
`PUBLIC_GA_MEASUREMENT_ID=` (empty) in the deploy environment and rebuilding disables all collection
without a code change — the CSP hosts become unused but harmless.

## Dependencies

- GA4 property with production stream `G-LV9RXZP838` — already exists.
- A **second GA4 data stream** for dev/staging, so dev traffic stays out of the student property.
  Must exist before the dev `.env` gets a non-empty ID; it does not block merging (empty ⇒ disabled).
- No new npm packages. No learnex changes. No nginx changes.

## Success Criteria

- [ ] GA4 Realtime shows sessions from a production build, with device category populated, and no
      CSP violation in the browser console.
- [ ] `script-src` contains no `'unsafe-inline'`; the only new script host is `googletagmanager.com`.
- [ ] Running `npm run dev` / `npm run build` / `npm test` in sequence leaves the GA hosts intact in
      `src/index.html` — verified by a test, not by inspection.
- [ ] Installing the PWA from Android Chrome produces exactly one install event; installing from the
      browser menu (not the card) also produces it.
- [ ] `page_view` payloads contain route templates only — no exam, classroom, record or period ID,
      no tenant slug, no user identifier — verified on an ID-bearing route.
- [ ] With `PUBLIC_GA_MEASUREMENT_ID` empty, or with the `gtag/js` request blocked, the app behaves
      exactly as today: no exception, no console error, no changed timing.
- [ ] No GA network request is made while `ExamActivity.isActive()` is true.
- [ ] `src/L1_domain/` and `src/L2_application/` are untouched by this change.
- [ ] `npm run lint` clean, `npm run format:check` clean, `npm test` green against the current
      baseline; `hexagonal-guard` reports no violations (CONTRIBUTING.md rule #3).
