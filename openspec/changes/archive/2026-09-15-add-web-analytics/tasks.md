# Tasks: Add Google Analytics 4 for traffic, device and PWA-install measurement

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~350 prod + ~400 test ≈ **~750** across 10 prod files + 4 test files |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (CSP/build infra) → PR 2 (`GoogleAnalyticsService`) → PR 3 (route tracker + install hook + wiring) |
| Delivery strategy | ask-on-risk (not specified for this request — default per shared conventions) |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

Honesty note: the proposal's own estimate (~180 LOC prod + ~200 LOC test, single PR) undercounts.
Calibrating against `tests/feature/L3_periphery/captcha/cloudflare-turnstile-provider.spec.ts`
(240 lines for a comparably shaped script-injection adapter with fewer cases), the 11-case
`google-analytics.service.spec.ts` alone is realistically 250-350 lines, and the 4 new/extended
spec files together push total test volume past 350 lines on their own. Total change is roughly
**2x** the 400-line review budget — flag before apply rather than force a single oversized PR.

### Suggested Work Units

| Unit | Goal | Files | Est. lines | Likely PR |
|------|------|-------|-----------|-----------|
| 1 | CSP widened + `build-env.mjs` sync made survivable | `src/index.html`, `scripts/csp-sync.mjs`, `scripts/csp-sync.d.mts`, `scripts/build-env.mjs`, `.env.example`, `tests/unit/scripts/csp-sync.spec.ts` | ~310 | PR 1 — standalone, hosts unused-but-harmless until Unit 2 ships (design.md Rollout) |
| 2 | `GoogleAnalyticsService` (load, emit, gate, privacy scrub) | `src/L3_periphery/analytics/gtag.d.ts`, `google-analytics.service.ts`, `tests/feature/L3_periphery/analytics/google-analytics.service.spec.ts` | ~410 | PR 2 — depends on Unit 1 merged (needs the CSP hosts to be meaningful in prod, not to compile) |
| 3 | Route tracker + PWA-install hook + `app.config.ts` wiring | `analytics-route-tracker.ts`, `before-install-prompt.adapter.ts`, `app.config.ts`, `analytics-route-tracker.spec.ts`, extended `before-install-prompt.adapter.spec.ts` | ~200 | PR 3 — depends on Unit 2 (imports `GoogleAnalyticsService`) |

If the team accepts `size:exception` instead, Phases 1-5 below still apply in the same red→green
order inside one PR — only the PR boundary changes, not the task order.

---

## Phase 1: Build-time CSP sync (`scripts/csp-sync.mjs`) — Work Unit 1

- [x] 1.1 **ADD (test-first)** `tests/unit/scripts/csp-sync.spec.ts` — per design.md D6/Test plan
  #1: `readCspContent` extracts the CSP `content` attribute / throws `CspSyncError` when the meta
  tag is absent · `syncApiOrigin` replaces only the first `https?://` token after
  `connect-src 'self' ` and preserves every other host and the directive tail · works against the
  current GA-less CSP shape · returns `{ changed: false }` when already synced · throws when
  `connect-src 'self' <origin>` is missing · `findMissingHosts(csp, hosts)` returns `[]` / the
  missing subset · does **not** count a host that appears only inside an HTML comment ·
  regression: running `syncApiOrigin` over the real `src/index.html` (post-1.4) leaves every
  `REQUIRED_CSP_HOSTS` entry present. Covers spec Requirement "`build-env.mjs` CSP sync preserves
  non-API hosts in `connect-src`" (both scenarios).
- [x] 1.2 **ADD** `scripts/csp-sync.mjs` — make 1.1 pass. Pure, no I/O, no `process.exit`:
  `API_ORIGIN_RE = /(connect-src\s+'self'\s+)(https?:\/\/[^\s;"']+)/`, `readCspContent(html)`,
  `syncApiOrigin(html, apiOrigin)`, `findMissingHosts(csp, hosts)`, `CspSyncError` class,
  `REQUIRED_CSP_HOSTS = ['https://www.googletagmanager.com', 'https://*.google-analytics.com',
  'https://*.analytics.google.com']` (per design.md OQ-2 resolution — the assertion checks
  substring presence in the CSP content, so one entry per distinct host token covers all the
  directives it appears in).
- [x] 1.3 **ADD** `scripts/csp-sync.d.mts` — type declarations for the four exports above so
  `tests/unit/scripts/csp-sync.spec.ts` can `import` the `.mjs` (`allowJs` is off in
  `tsconfig.json`, per design.md D6).
- [x] 1.4 **MODIFY** `src/index.html:41-44` — apply the resolved CSP string from design.md
  ("The exact CSP after the change"): `script-src` += `https://www.googletagmanager.com`;
  `connect-src` += `https://*.google-analytics.com https://*.analytics.google.com
  https://www.googletagmanager.com`; `img-src` += `https://*.google-analytics.com
  https://www.googletagmanager.com`. Extend the existing D4 comment (Spanish, matching the
  surrounding block) with: the `'unsafe-inline'` rejection rationale, the first-host invariant
  ("the API origin must always be the first host after `'self'` in `connect-src`"), and that the
  Advertising Features hosts were deliberately excluded (source:
  developers.google.com/tag-platform/security/guides/csp).
- [x] 1.5 **MODIFY** `scripts/build-env.mjs` — read `PUBLIC_GA_MEASUREMENT_ID` → `gaMeasurementId`
  in both generated environments, mirroring `captchaSiteKey` (`:101`, `:116`, `:127`, `:140`).
  Replace the `:173-190` inline regex rewrite with calls into `csp-sync.mjs`:
  `syncApiOrigin(html, apiOrigin)` then `findMissingHosts(...)`; keep all I/O, `console.*` and
  `process.exit(1)` in this file (matches its existing loud-failure pattern at `:175-181`) —
  `process.exit(1)` naming any missing GA host if `findMissingHosts` returns non-empty.
- [x] 1.6 **MODIFY** `.env.example` — document `PUBLIC_GA_MEASUREMENT_ID` (optional, empty ⇒
  disabled), noting production uses `G-LV9RXZP838` and dev/staging needs its own GA4 data stream
  before being set non-empty.
- [x] 1.7 **Manual** — run `npm run dev`, `npm run build`, `npm test` in sequence (each triggers
  `build-env.mjs` via `predev`/`prebuild`/`pretest`); inspect `src/index.html`'s CSP after each and
  confirm the GA hosts from 1.4 are still present and the API origin token is still correctly
  synced. This is the exact failure mode `build-env.mjs:173` had before this change — verify by
  inspection here in addition to the 1.1 regression test.

## Phase 2: L3 — `GoogleAnalyticsService` — Work Unit 2

- [x] 2.1 **ADD (test-first)** `tests/feature/L3_periphery/analytics/google-analytics.service.spec.ts`
  — per design.md Test plan #2, mocking pattern per `cloudflare-turnstile-provider.spec.ts:19-32`
  (mutate the imported `environment` object in `beforeEach`, reconstruct the service per test):
  empty `gaMeasurementId` ⇒ no `<script>`, no `window.gtag`, no `window.dataLayer` · empty ID ⇒
  `trackPageView`/`trackPwaInstall` no-op without throwing · non-empty ID ⇒ exactly one
  `<script async src="https://www.googletagmanager.com/gtag/js?id=…">` · `start()` called twice ⇒
  still one script tag · `gtag('config', …)` call carries `send_page_view: false` · script `error`
  event ⇒ later `emit()` calls push nothing to `dataLayer` · `trackPageView` payload has
  `page_path` = route template, `page_location` = `origin + template` · `display_mode` is
  `'standalone'`/`'browser'` per `BrowserInstallEnvironmentProbe.isStandalone()` · same-origin
  `document.referrer` stripped to `''`, cross-origin referrer kept · `ExamActivity.isActive()` ⇒
  neither `trackPageView` nor `trackPwaInstall` pushes · `trackPwaInstall` emits event name
  `pwa_install`. Covers spec Requirements "Analytics is fully disabled when the measurement ID is
  empty", "`page_view` carries route template and `display_mode`", "No GA activity while the
  student is in an exam", "A blocked, failed, or missing GA load is a silent no-op", "No
  student-identifying data ever reaches Google" (all listed scenarios).
- [x] 2.2 **ADD** `src/L3_periphery/analytics/gtag.d.ts` — `declare global { interface Window {
  dataLayer?: unknown[]; gtag?: (...a: unknown[]) => void } } export {}`, same shape as
  `captcha/turnstile.d.ts`.
- [x] 2.3 **ADD** `src/L3_periphery/analytics/google-analytics.service.ts` — make 2.1 pass:
  `start()` (no-op when `environment.gaMeasurementId === ''`; defines `window.dataLayer`/
  `window.gtag` as a real `function` pushing `arguments`, not an arrow — see design.md D5; injects
  the `gtag/js` script tag once; `error` listener flips `enabled = false`), `isEnabled()`,
  `trackPageView(routeTemplate: string)`, `trackPwaInstall()`, private `emit()` guarding
  `enabled && !examActivity.isActive() && typeof window.gtag === 'function'`, whole body
  `try/catch`, no queue/retry/logging (design.md D5). Inject `ExamActivity` and the concrete
  `BrowserInstallEnvironmentProbe` class directly, not `INSTALL_ENV_PROBE` (design.md D7 — keeps
  L3→L3 resolvable without extra TestBed wiring in Phase 4's adapter spec). `page_location` set
  explicitly to `window.location.origin + routeTemplate`; `page_referrer` stripped when
  same-origin (design.md D4).

## Phase 3: L3 — `AnalyticsRouteTracker` — Work Unit 3

- [x] 3.1 **ADD (test-first)** `tests/feature/L3_periphery/analytics/analytics-route-tracker.spec.ts`
  — per design.md Test plan #3: GA disabled ⇒ `start()` does not subscribe to `router.events` ·
  `/student/home` ⇒ `/student/home` · **privacy**: `/student/simulacro/abc-123` ⇒
  `/student/simulacro/:id`, and the call argument does not contain the literal `abc-123` ·
  `/tutor/aulas/c1/semanas/p2` ⇒ `/tutor/aulas/:classroomId/semanas/:periodId` · legacy `/home`
  resolves to `/student/home` after redirect · `start()` called twice ⇒ one subscription. Covers
  spec Requirement "`page_view` carries route template and `display_mode`, never a resolved URL" —
  scenario "ID-bearing route sends template and mode, not the ID".
- [x] 3.2 **ADD** `src/L3_periphery/analytics/analytics-route-tracker.ts` — make 3.1 pass:
  `start()` idempotent, returns early when `!analytics.isEnabled()`; subscribes to
  `router.events` filtered to `NavigationEnd`; `routeTemplate()` walks
  `router.routerState.snapshot.root` via `firstChild`, collecting non-empty `routeConfig?.path`
  segments, joined with `/`, per design.md D4's exact implementation; calls
  `analytics.trackPageView(routeTemplate())` per navigation.

## Phase 4: L3 — PWA-install hook — Work Unit 3

- [x] 4.1 **MODIFY (test-first)**
  `tests/feature/L3_periphery/pwa/before-install-prompt.adapter.spec.ts` (extend) — add: the
  `appinstalled` event ⇒ `GoogleAnalyticsService.trackPwaInstall()` called exactly once · a
  `trigger()` call resolving `'accepted'` alone (no `appinstalled`) does **not** call it. Keep
  every existing assertion unchanged. Covers spec Requirement "PWA install is reported once, only
  from `appinstalled`" — scenario "Install via browser menu still reports".
- [x] 4.2 **MODIFY** `src/L3_periphery/pwa/before-install-prompt.adapter.ts:52-55` — make 4.1
  pass: inject `GoogleAnalyticsService` (concrete class, design.md D7) and call
  `analytics.trackPwaInstall()` inside the existing `onAppInstalled` handler, after its current
  logic. `trigger()`'s `'accepted'` branch (`:81`) is untouched.

## Phase 5: Wiring — Work Unit 3

- [x] 5.1 **MODIFY** `src/app.config.ts` — add one `provideAppInitializer` that calls
  `GoogleAnalyticsService.start()` then `AnalyticsRouteTracker.start()`, placed immediately before
  the existing `BeforeInstallPromptAdapter` initializer (`:527`) so `window.gtag` exists before
  the install listener registers (design.md File changes table).

## Phase 6: Manual verification (production build)

- [ ] 6.1 Production build with the real (or dev-stream) `PUBLIC_GA_MEASUREMENT_ID` set; open
  DevTools Network + Console on the deployed/served build; confirm **zero** CSP violation entries
  and that hits reach `google-analytics.com/g/collect` (or the regional `*.google-analytics.com`
  equivalent).
- [ ] 6.2 With the exam timer armed (`ExamActivity.isActive()` true), navigate within the app and
  confirm **no** GA network request fires; confirm normal `page_view` hits resume once the exam
  ends.
- [ ] 6.3 Visit at least one ID-bearing route from each pattern in `app.routes.ts` (`:43`, `:64`,
  `:109`, `:117`) and inspect the outgoing `page_view` payload (`page_location`/`page_path`);
  confirm the real ID never appears — only the route template.

## Phase 7: Final gates + Verify/Archive

- [x] 7.1 `npm test` green: baseline + the 4 new/extended spec files, no regressions.
- [x] 7.2 `npm run lint` clean.
- [ ] 7.3 `npm run format:check` clean.
- [ ] 7.4 **`hexagonal-guard` subagent** (blocking gate per CONTRIBUTING.md rule #3) — run during
  `sdd-verify`. Expect no findings: `src/L1_domain/` and `src/L2_application/` untouched
  (proposal success criterion), the one concrete L3→L3 injection is documented in design.md D7.
- [ ] 7.5 `sdd-verify` — validate implementation against `spec.md`'s 7 requirements and
  `proposal.md`'s Success Criteria checklist.
- [ ] 7.6 `sdd-archive` — move `openspec/changes/add-web-analytics/` to
  `openspec/changes/archive/2026-09-15-add-web-analytics/`, merge the `web-analytics` delta spec
  into `openspec/specs/`. Per CONTRIBUTING.md, the change must be archived before any of its PR(s)
  merge to `develop`.
- [ ] 7.7 Open PR(s) `--base develop` per the resolved chain strategy (single PR with
  `size:exception`, or the Unit 1 → Unit 2 → Unit 3 chain from the forecast above) — confirm
  `ls openspec/changes/` shows only `archive/` before opening.
