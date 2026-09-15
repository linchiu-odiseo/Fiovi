# Design: Google Analytics 4 for traffic, device and PWA-install measurement

Three metrics, one vendor, zero domain meaning. The whole change is an L3 adapter plus a CSP
widening plus a build-script bug fix. The interesting parts are not the GA integration — they are
(a) keeping `'unsafe-inline'` out of `script-src`, (b) stopping `scripts/build-env.mjs:173` from
silently deleting the new hosts on every build, and (c) making sure no route ID reaches Google.
This note records the decisions that are not obvious from the diff.

## Technical approach

```
app.config.ts (provideAppInitializer)
      │
      ├─► GoogleAnalyticsService.start()
      │        │  gaMeasurementId === '' ──► return (no script, no globals, no network)
      │        │
      │        ├─ window.dataLayer = []  +  window.gtag = fn      (bundled TS, 'self')
      │        ├─ gtag('js', Date) ; gtag('config', ID, {send_page_view:false})
      │        └─ <script async src="…googletagmanager.com/gtag/js?id=ID">   ← only external bit
      │
      └─► AnalyticsRouteTracker.start()
               └─ router.events ▸ NavigationEnd ─► routeTemplate() ─► trackPageView()

BeforeInstallPromptAdapter.onAppInstalled ─────────────────► trackPwaInstall()

                     both funnel through GoogleAnalyticsService.emit():
                     enabled? ─ examActivity.isActive()? ─ typeof window.gtag === 'function'? ─ try/catch
```

## Decisions

### D1. No L1 port for analytics — an L3 service wired in `app.config.ts`

`agents/architecture-rules.md` defines a port as *"interfaces que describen capacidades sin
implementarlas"*, and the whole reason ports exist here is so **L2 use cases can orchestrate a
capability without knowing its implementation** (L1 ← L2 ← L3). GA has no L2 consumer and never
will: nothing in the domain or the application layer needs to "track". Both call sites live in L3
(`AnalyticsRouteTracker`, `BeforeInstallPromptAdapter`). A port here would be an interface that
only L3 imports and only L3 implements — the same shape `architecture-rules.md` already rejects for
passthrough use cases and ceremonial mappers, and it would additionally cost a token, a fake, and a
`app.config.ts` binding.

Contrast with a port that *is* justified: `InstallEnvironmentProbe` exists because
`DecideInstallCardStateUseCase` (L2) consumes it. GA has no such consumer. `src/L1_domain/` and
`src/L2_application/` are untouched by this change — that is a success criterion, not an accident.

### D2. The gtag bootstrap is bundled TypeScript, not an inline `<script>` and not a separate static file

The binding constraint is **no `'unsafe-inline'` in `script-src`**. Google's stock snippet is an
inline `<script>` block, so pasting it requires exactly the directive the CSP comment at
`src/index.html:27-40` says the policy exists to prevent. Three ways to satisfy the constraint:

| Option | Verdict |
|---|---|
| Inline snippet + `'unsafe-inline'` | **Rejected.** Trades the anti-XSS guarantee (design D4) for a page-view counter. Any injected `<script>` in the document would then run. |
| Static `public/ga-bootstrap.js` served from `'self'` | **Rejected.** It is `'self'` code, so it satisfies the constraint, but the measurement ID is per-environment and a static file has no way to receive it without a second channel (build-time substitution or a `data-` attribute). Two mechanisms where one suffices. |
| **Chosen — bootstrap in `google-analytics.service.ts`** | The Angular bundle *is* a static JS file served from `'self'`. It already reads `environment.gaMeasurementId`, so the ID needs no second channel, and it is directly unit-testable. |

Note this reconciles the two inputs: the instruction "own static JS file served from `'self'`" and
the proposal's "bundled TypeScript" describe the same security property; bundled TS is the cheaper
carrier of the ID. If the team prefers a literally separate file, see OQ-1.

**Verified, not assumed:** a dynamically inserted external `<script src>` is governed by the
`script-src` **host allowlist**, not by `'unsafe-inline'` (which only covers inline blocks and
inline handlers). In-repo proof: `CloudflareTurnstileProvider.ensureScriptLoaded()`
(`src/L3_periphery/captcha/cloudflare-turnstile-provider.ts:76-109`) does `document.createElement
('script'); script.src = …; document.head.appendChild(script)` and works in production under
`script-src 'self' https://challenges.cloudflare.com`. GA uses the identical mechanism. This also
answers the injection-vs-build-substitution question: **option (a), service-injected**, same
precedent, no build step, testable in jsdom.

The rationale lands in three places so it survives: this file, the proposal, and a Spanish comment
appended to the CSP block in `src/index.html` (planned text in "File changes").

### D3. Exam gate: suppress **emission** only, do not defer the script load

`ExamActivity.isActive()` (`exam-activity.service.ts:18`) flips to `true` from the simulacro
view-model when the exam timer arms — always *after* app bootstrap, where `start()` runs. So the
`gtag/js` fetch has already happened by the time any exam is active; deferring the load would be
dead code in every real flow and would add a state machine ("load when the exam ends") for nothing.
A loaded gtag.js with `send_page_view: false` emits **zero** network traffic on its own; every hit
comes from a `gtag()` call, and every call goes through the single `emit()` choke point. One
`if (this.examActivity.isActive()) return;` there satisfies "no GA network request while an exam is
active" — same gate, same reason, same one-liner as
`audit-log-upload-scheduler.service.ts:62`.

Residual, stated honestly: on a very slow network the bootstrap `gtag/js` fetch could still be in
flight when the exam arms. That request carries no student data and is not an analytics hit.

### D4. `page_view` sends the route template, read from the snapshot tree — never `router.url`

`src/LR_render/app.routes.ts` carries real identifiers at `:43` (`student/simulacro/:id`), `:64`
(`student/historial/:examId`), `:109` (`tutor/aulas/:classroomId/semanas/:periodId`) and `:117`
(`tutor/exams/:recordId`). Angular 22, inside `AnalyticsRouteTracker`:

```ts
private routeTemplate(): string {
  let node = this.router.routerState.snapshot.root;
  const segments: string[] = [];
  while (node.firstChild) {
    node = node.firstChild;
    const path = node.routeConfig?.path ?? '';
    if (path.length > 0) segments.push(path);
  }
  return '/' + segments.join('/');
}
```

`ActivatedRouteSnapshot.routeConfig.path` is the **declared** path, so `/student/simulacro/9f3a…`
yields `student/simulacro/:id`. The routes are flat (no `children`), so the loop collects one
segment today; it is written as a descent so nesting later does not silently break it. The
fallback when there is no `firstChild` is `'/'` — degraded, never leaking.

Reading the snapshot *after* `NavigationEnd` also means redirects are already resolved: `/home`
(`app.routes.ts:138`) reports `/student/home`.

Two more privacy details in the payload:

- `page_location` is set explicitly to `window.location.origin + template`. Without it gtag reads
  `document.location` and the real URL leaks. `send_page_view: false` at config time exists for the
  same reason — the automatic first hit would fire before we can scrub it.
- `page_referrer` is stripped when same-origin
  (`document.referrer.startsWith(location.origin) ? '' : document.referrer`). Cross-origin referrers
  are kept: they answer "how do people arrive", which is metric #1.

### D5. Fail-silent needs no queue — `dataLayer` already is one

The bootstrap defines `window.dataLayer` and `window.gtag` in our own bundle *before* the external
script exists, so `typeof window.gtag === 'function'` is true even when `gtag/js` is blocked by an
ad blocker or a school filter; commands accumulate harmlessly in the array. To stop that array
growing forever on a blocked load, the script tag's `error` listener flips `enabled = false`. Guard
in `emit()`: `enabled && !examActive && typeof window.gtag === 'function'`, whole body in
`try/catch`. No custom queue, no retry, no logging.

`gtag` **must** be a `function` that pushes `arguments`, not an arrow with rest params — gtag.js
distinguishes an `arguments` object from a real `Array` when parsing dataLayer commands, and an
Array is not reliably interpreted as a command. Pin it with a comment (and an
`eslint-disable-next-line prefer-rest-params` only if lint complains; the rule is not in the current
`eslint.config.js` preset).

### D6. `scripts/build-env.mjs` — narrow the regex to the first host token, assert the rest survived

Today `cspConnectSrcRe = /(connect-src\s+'self'\s+)([^;"']+)/` (`build-env.mjs:173`) captures
everything up to the next `;`, so the rewrite at `:187` replaces the whole directive tail. With GA
hosts present it deletes them on every `predev` / `prebuild` / `pretest`. New regex:

```js
export const API_ORIGIN_RE = /(connect-src\s+'self'\s+)(https?:\/\/[^\s;"']+)/;
```

`[^\s;"']+` stops at the first whitespace, so it owns exactly one token. **Invariant this
introduces: the API origin must always be the first host after `'self'` in `connect-src`.** That
invariant goes into the `index.html` comment, because nothing else enforces it.

The host-survival assertion is scoped to the CSP `content` attribute, not to the whole file — the
new comment mentions the GA hosts by name, and a naive `html.includes(host)` check would pass
against the comment while the directive was empty. That is the exact false-pass this guard exists
to prevent, so three small pure functions are extracted to `scripts/csp-sync.mjs`:

| Export | Contract |
|---|---|
| `readCspContent(html)` | Returns the `content="…"` value of the CSP meta; throws `CspSyncError` if absent |
| `syncApiOrigin(html, apiOrigin)` | `{ html, previousOrigin, changed }`; throws `CspSyncError` if `API_ORIGIN_RE` does not match |
| `findMissingHosts(csp, hosts)` | Returns missing entries from `REQUIRED_CSP_HOSTS` |

`build-env.mjs` keeps all I/O, `console.*` and `process.exit(1)` — it already uses that loud-failure
pattern at `:175-181`. Rejected alternative: import `build-env.mjs` directly from the spec — its
top-level body reads `.env`, writes `src/environments/*` and calls `process.exit`, so importing it
runs the build. The extraction is the minimum needed to make the logic testable without side
effects. `scripts/csp-sync.d.mts` declares the exports so the TS spec can import the `.mjs`
(`allowJs` is off in `tsconfig.json`).

### D7. `GoogleAnalyticsService` injects `BrowserInstallEnvironmentProbe` directly, not `INSTALL_ENV_PROBE`

`display_mode` exists because `appinstalled` never fires on iOS, so installs are only visible as
"sessions running standalone". The value comes from `BrowserInstallEnvironmentProbe.isStandalone()`
(`browser-install-environment-probe.ts:27-40`).

Injecting the concrete class (both are `providedIn: 'root'`, and `app.config.ts:150` binds the
token to the same singleton via `useExisting`) keeps L3→L3 dependencies resolvable without extra
TestBed wiring. This matters concretely: `BeforeInstallPromptAdapter` will inject
`GoogleAnalyticsService`, and `tests/feature/L3_periphery/pwa/before-install-prompt.adapter.spec.ts`
builds a TestBed with `providers: [BeforeInstallPromptAdapter]` only — a token dependency would
throw `NullInjectorError` and force that existing spec to grow a binding it has no business
knowing. Precedent for concrete L3→L3 injection: `AuditLogUploadScheduler` injects
`AuditLogUploadDispatcherService` and `ExamActivity` the same way
(`audit-log-upload-scheduler.service.ts:41-42`). If `hexagonal-guard` objects, the fallback is
`inject(INSTALL_ENV_PROBE)` plus one provider line in that spec.

### D8. Install event hooks `onAppInstalled`, not `trigger()`'s `'accepted'`

`before-install-prompt.adapter.ts:52-55` is the single place where a *completed* install is known,
for every path including the browser menu. `trigger()`'s `'accepted'` (`:81`) means the user tapped
Install, not that it finished. Rejected alternative (from the proposal): a second
`window.addEventListener('appinstalled')` inside the analytics service — two listeners for one
fact, two places to keep in sync.

### D9. No nginx change, no service-worker change

- `nginx/security-headers.conf:26` emits `Content-Security-Policy "frame-ancestors 'none'"` only.
  `frame-ancestors` constrains neither scripts nor connections, and browsers merge multiple CSPs by
  intersection, so it cannot block GA. **Confirmed: no change.**
- `ngsw-config.json` has only `assetGroups[].resources.files`. Those globs match files in the build
  output directory (`dist/**/browser`), not runtime request URLs; cross-origin caching would require
  `resources.urls` or a `dataGroups` entry, and neither exists. `/*.js` therefore cannot match
  `https://www.googletagmanager.com/gtag/js`. **Confirmed: gtag is never precached, no change.**

## The exact CSP after the change

`src/index.html:41-44`, `content` attribute, with the API origin shown as the current dev value:

```
default-src 'self'; script-src 'self' https://challenges.cloudflare.com https://www.googletagmanager.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; connect-src 'self' https://api.yangpimpollo.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com; img-src 'self' data: https://*.google-analytics.com https://www.googletagmanager.com; font-src 'self' data: https://fonts.gstatic.com; frame-src 'self' https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; form-action 'self'
```

Diff, token by token:

| Directive | Added | Why |
|---|---|---|
| `script-src` | `https://www.googletagmanager.com` | The only external file loaded. |
| `connect-src` | `https://*.google-analytics.com` | GA4 collect beacon, incl. regional endpoints (`region1.google-analytics.com`, …). Covers the bare `google-analytics.com`/`www.google-analytics.com` hosts as a subdomain match, so no separate non-wildcard entry is needed. |
| `connect-src` | `https://*.analytics.google.com` | GA4 secondary/redirect collection domain. |
| `connect-src` | `https://www.googletagmanager.com` | `gtag/js` config/remote-config fetches over `connect-src` (separate from the `script-src` load). |
| `img-src` | `https://*.google-analytics.com` | Image-pixel transport fallback when `fetch`/`sendBeacon` is unavailable. |
| `img-src` | `https://www.googletagmanager.com` | Image-pixel fallback path served from the tag manager host. |

Unchanged: no `'unsafe-inline'` in `script-src`, no wildcard in `script-src`, `object-src 'none'`,
`base-uri 'self'`, `form-action 'self'`, `frame-src` untouched (GA renders no frame).

> **Verified against Google's live doc (2026-09-15).** Source:
> <https://developers.google.com/tag-platform/security/guides/csp>. This list is the GA4 **core**
> set only — the guide's "Advertising Features" hosts (`*.g.doubleclick.net`, `*.google.com`,
> `*.google.<TLD>`, `pagead2.googlesyndication.com`) are deliberately excluded: Fiovi does not link
> Google Ads, and `*.google.com` would gut the CSP's purpose (D2/D4). OQ-2 is resolved — no
> apply-time doc diff needed, only the DevTools confirmation task already planned.

## File changes

| File | Action | Description |
|---|---|---|
| `src/index.html` | Modify | CSP per the string above; extend the comment at `:27-40` (Spanish, matching the surrounding block) with the `'unsafe-inline'` rejection and the first-host invariant |
| `scripts/csp-sync.mjs` | Create | `readCspContent`, `syncApiOrigin`, `findMissingHosts`, `API_ORIGIN_RE`, `REQUIRED_CSP_HOSTS`, `CspSyncError` — pure, no I/O |
| `scripts/csp-sync.d.mts` | Create | Type declarations so `tests/unit/scripts/csp-sync.spec.ts` can import the `.mjs` |
| `scripts/build-env.mjs` | Modify | Read `PUBLIC_GA_MEASUREMENT_ID` → `gaMeasurementId` in both generated environments (mirrors `captchaSiteKey` at `:101`, `:116`, `:127`, `:140`); replace `:173-190` with calls into `csp-sync.mjs`; `process.exit(1)` listing any missing GA host |
| `.env.example` | Modify | Document `PUBLIC_GA_MEASUREMENT_ID` — optional, empty ⇒ disabled, prod `G-LV9RXZP838`, separate stream for dev |
| `src/environments/*` | Generated | `gaMeasurementId` field — never hand-edited |
| `src/L3_periphery/analytics/gtag.d.ts` | Create | `declare global { interface Window { dataLayer?: unknown[]; gtag?: (...a: unknown[]) => void } }` + `export {}` — same shape as `captcha/turnstile.d.ts` |
| `src/L3_periphery/analytics/google-analytics.service.ts` | Create | `start()`, `isEnabled()`, `trackPageView(routeTemplate)`, `trackPwaInstall()`, private `emit()` with the D5 guard |
| `src/L3_periphery/analytics/analytics-route-tracker.ts` | Create | `start()` — idempotent; returns early when GA is disabled; `NavigationEnd` → `routeTemplate()` → `trackPageView` |
| `src/L3_periphery/pwa/before-install-prompt.adapter.ts` | Modify | `onAppInstalled` (`:52-55`) also calls `analytics.trackPwaInstall()` |
| `src/app.config.ts` | Modify | One `provideAppInitializer` calling `GoogleAnalyticsService.start()` then `AnalyticsRouteTracker.start()`, placed immediately before the `BeforeInstallPromptAdapter` initializer (`:527`) so `gtag` exists before the install listener registers |

## Test plan (strict TDD — red before green, in this order)

| # | Spec file | Cases |
|---|---|---|
| 1 | `tests/unit/scripts/csp-sync.spec.ts` | `readCspContent` extracts the attribute / throws when the meta is absent · `syncApiOrigin` replaces **only** the first origin token and preserves the GA hosts and the directive tail · works on the current GA-less CSP shape · reports `changed: false` when already synced · throws when `connect-src 'self' <origin>` is missing · `findMissingHosts` returns `[]` / the missing list · **does not count hosts that appear only in an HTML comment** · regression: `syncApiOrigin` over the real `src/index.html` leaves every `REQUIRED_CSP_HOSTS` entry present |
| 2 | `tests/feature/L3_periphery/analytics/google-analytics.service.spec.ts` | empty ID ⇒ no `<script>`, no `window.gtag`, no `window.dataLayer` · empty ID ⇒ track calls no-op without throwing · non-empty ID ⇒ exactly one `<script async src="https://www.googletagmanager.com/gtag/js?id=…">` · `start()` twice ⇒ still one · `config` carries `send_page_view: false` · script `error` event ⇒ later calls push nothing · `trackPageView` payload has `page_path` = template, `page_location` = `origin + template` · `display_mode` is `'standalone'` / `'browser'` per the probe · same-origin `document.referrer` stripped to `''` · `examActivity.isActive()` ⇒ neither `trackPageView` nor `trackPwaInstall` pushes · `trackPwaInstall` emits event name `pwa_install` |
| 3 | `tests/feature/L3_periphery/analytics/analytics-route-tracker.spec.ts` | GA disabled ⇒ `start()` does not subscribe · `/student/home` ⇒ `/student/home` · **privacy: `/student/simulacro/abc-123` ⇒ `/student/simulacro/:id`, and the argument does not contain `abc-123`** · `/tutor/aulas/c1/semanas/p2` ⇒ `/tutor/aulas/:classroomId/semanas/:periodId` · legacy `/home` ⇒ `/student/home` after redirect · `start()` twice ⇒ one subscription |
| 4 | `tests/feature/L3_periphery/pwa/before-install-prompt.adapter.spec.ts` (extend) | `appinstalled` ⇒ `trackPwaInstall()` called once · `trigger()` returning `'accepted'` does **not** call it · existing assertions unchanged |

Both new spec files are picked up: `angular.json:86` includes `../tests/**/*.spec.ts` (relative to
`sourceRoot: "src"`) and `tsconfig.spec.json:9` includes `tests/**/*.spec.ts`, so
`tests/unit/scripts/` needs no config change. `tests/unit/` already hosts non-L1/L2 pure specs
(`tests/unit/L3_periphery/telemetry/audit-log-dictionaries.spec.ts`), so the location is precedented.

Mocking note for #2: `vi.mock` does not work for relative imports under the Angular unit-test
builder. Follow `cloudflare-turnstile-provider.spec.ts:19-32` — mutate the imported `environment`
object in `beforeEach` and reconstruct the service per test.

Baseline: `npm test` must stay at `develop`'s numbers plus the new specs; `npm run lint` and
`npm run format:check` clean; `hexagonal-guard` before archive (expect no findings — nothing new
touches L1/L2, and D7 documents the one concrete-class injection).

## Rollout

No migration, no persisted state, no schema, no backend coordination. Console-side steps that code
cannot do and without which the data is collected but unreadable:

1. Create the **dev/staging GA4 data stream**; keep the dev `.env` empty until it exists.
2. Register `display_mode` as an **event-scoped custom dimension** (Admin → Custom definitions).
   Unregistered parameters are collected but never appear in reports.
3. Optionally mark `pwa_install` as a key event if the team wants it in conversions.
4. Set `PUBLIC_GA_MEASUREMENT_ID=G-LV9RXZP838` in the production deploy environment.

**Kill switch — confirmed complete.** With `PUBLIC_GA_MEASUREMENT_ID=""`: `start()` returns before
creating the script element, so no `<script>` tag, no request to `googletagmanager.com`, and
`window.dataLayer` / `window.gtag` are never defined; `AnalyticsRouteTracker.start()` returns
without subscribing to `router.events`; `trackPwaInstall()` no-ops. The only residue is four unused
hosts in the CSP, which grant nothing on their own. Full revert is `git revert` of the PR.

## Open questions

- [ ] **OQ-1 (low, reversible).** D2 reads "own static JS file served from `'self'`" as satisfied by
      the bundled Angular chunk. If a literally separate `public/ga-bootstrap.js` is required, the
      measurement ID needs a second channel and D2's table becomes the decision to revisit. Flagged
      because the instruction and the proposal phrased the same constraint differently.
- [x] **OQ-2 — RESOLVED (2026-09-15).** Diffed against Google's live CSP guide
      (<https://developers.google.com/tag-platform/security/guides/csp>). Core GA4 host list
      confirmed: `script-src` += `https://www.googletagmanager.com`; `connect-src` +=
      `https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com`;
      `img-src` += `https://*.google-analytics.com https://www.googletagmanager.com`. The guide's
      "Advertising Features" hosts (`*.g.doubleclick.net`, `*.google.com`, `*.google.<TLD>`,
      `pagead2.googlesyndication.com`) are deliberately **not** added — Fiovi does not link Google
      Ads, and `*.google.com` would gut the CSP's purpose. See "The exact CSP after the change"
      above for the final string.
- [ ] **OQ-3 (informational).** Measured traffic is a floor, not a census — ad blockers and school
      network filters are expected to suppress an unknown share. Whoever reads the dashboards must
      be told this once, in writing.
