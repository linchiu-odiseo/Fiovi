# web-analytics Specification

## Purpose

Answers three questions Fiovi cannot answer today: how many people arrive, from what devices, and
how many install the PWA — via Google Analytics 4, loaded as first-party bundled TypeScript (never
inline), emitting only `page_view` and a PWA-install event, with no student-identifying data. New
capability — no prior spec covers it. Also owns the `scripts/build-env.mjs` CSP-sync narrowing
needed so GA hosts coexist with the API origin in `connect-src`, since no existing capability owns
that sync mechanism.

## Requirements

### Requirement: Analytics is fully disabled when the measurement ID is empty

`environment.gaMeasurementId` (from `PUBLIC_GA_MEASUREMENT_ID`, same empty-by-default pattern as
`PUBLIC_CAPTCHA_SITE_KEY`) SHALL gate everything: when empty, the system SHALL NOT inject the
`googletagmanager.com` script, SHALL NOT define `dataLayer`/`gtag`, and `trackPageView`/
`trackPwaInstall` SHALL be no-ops.

#### Scenario: Empty measurement ID disables all analytics

- **GIVEN** `environment.gaMeasurementId === ''`
- **WHEN** the app bootstraps and `trackPageView`/`trackPwaInstall` are called
- **THEN** no script tag is injected, no Google network request occurs, and both calls return
  without throwing

### Requirement: CSP allows GA hosts without `'unsafe-inline'`

`src/index.html`'s CSP SHALL add `https://www.googletagmanager.com` to `script-src` and the GA4
collection hosts to `connect-src`. `'unsafe-inline'` and wildcard hosts SHALL NOT be added anywhere.
The `gtag` bootstrap SHALL be bundled TypeScript running under `script-src 'self'`, never an inline
`<script>`.

#### Scenario: No `'unsafe-inline'` in the shipped CSP

- **GIVEN** the shipped `src/index.html`
- **WHEN** the CSP meta content is inspected
- **THEN** `script-src` contains no `'unsafe-inline'` and `object-src 'none'` is unchanged

### Requirement: `page_view` carries route template and `display_mode`, never a resolved URL

GA SHALL be configured with `send_page_view: false`. On every Angular `NavigationEnd`, the system
SHALL emit `page_view` with `page_path`/`page_location` set to the route template from
`ActivatedRoute.routeConfig` (never `router.url`), plus `display_mode` (`'standalone'` | `'browser'`)
from `BrowserInstallEnvironmentProbe.isStandalone()`.

#### Scenario: ID-bearing route sends template and mode, not the ID

- **GIVEN** the router navigates to `/tutor/aulas/9f3a-...-classroom-id` while `isStandalone()` is
  `true`
- **WHEN** `NavigationEnd` fires
- **THEN** the payload has `page_path: '/tutor/aulas/:aulaId'` and `display_mode: 'standalone'`
- **AND** it does not contain the literal classroom ID

#### Scenario: Automatic initial hit is suppressed

- **WHEN** the `gtag/js` script finishes loading
- **THEN** no `page_view` is sent before the first explicit `trackPageView` call

### Requirement: PWA install is reported once, only from `appinstalled`

The system SHALL emit a GA install event from inside `BeforeInstallPromptAdapter.onAppInstalled`
only, regardless of whether the install originated from the app's card or the browser's own menu.
`trigger()`'s `'accepted'` outcome SHALL NOT be treated as an install.

#### Scenario: Install via browser menu still reports

- **GIVEN** the student installs Fiovi from the browser's menu, not the app's card
- **WHEN** `appinstalled` fires
- **THEN** exactly one GA install event is sent
- **AND** an `'accepted'` `trigger()` outcome alone (no `appinstalled`) sends none

### Requirement: No GA activity while the student is in an exam

While `ExamActivity.isActive()` is `true`, the system SHALL NOT inject the GA script (if not already
loaded) and SHALL NOT emit any `page_view` or install event — the same gate
`audit-log-upload-scheduler.service.ts` uses.

#### Scenario: Navigation during an exam is suppressed, then resumes

- **GIVEN** `ExamActivity.isActive()` is `true`
- **WHEN** a `NavigationEnd` occurs
- **THEN** no `page_view` is sent
- **AND** once `isActive()` becomes `false`, the next `NavigationEnd` sends one normally

### Requirement: A blocked, failed, or missing GA load is a silent no-op

Every adapter entry point SHALL be wrapped so a missing `gtag`, a blocked `gtag/js` request, or any
thrown error inside GA's own code SHALL NOT throw, SHALL NOT log a visible error, and SHALL NOT
change app timing or rendering.

#### Scenario: Ad blocker strips `gtag` after load

- **GIVEN** the script loaded but `window.gtag` is `undefined` at call time
- **WHEN** `trackPageView`/`trackPwaInstall` are called
- **THEN** both no-op with no thrown exception and no console error

### Requirement: No student-identifying data ever reaches Google

No GA payload SHALL contain a `user_id`, `tenantSlug`, exam/classroom/record/period ID, answer data,
or score. Only the route template, `display_mode`, and GA's automatic device/platform dimensions
SHALL leave the device.

#### Scenario: Deep link with a real exam ID never leaks it

- **GIVEN** the app is deep-linked to `/student/simulacro/9f3a...`
- **WHEN** the resulting `page_view` is inspected
- **THEN** it contains only `/student/simulacro/:id`, with no exam ID, tenant slug, or `user_id`
  anywhere in the GA configuration or payload

### Requirement: `build-env.mjs` CSP sync preserves non-API hosts in `connect-src`

The `cspConnectSrcRe` rewrite in `scripts/build-env.mjs` SHALL match and replace only the API-origin
token, not the whole `connect-src` tail — any other host already present (e.g. GA4 collection hosts)
SHALL survive every `predev`/`prebuild`/`pretest` run. If a required GA host is missing after the
rewrite, the script SHALL `process.exit(1)` with a named error, matching its existing loud-failure
pattern.

#### Scenario: GA hosts survive an `API_BASE_URL` change

- **GIVEN** `connect-src 'self' https://api.old.com https://analytics.google.com`
- **AND** `.env` changes `API_BASE_URL` to resolve to `https://api.new.com`
- **WHEN** `scripts/build-env.mjs` runs
- **THEN** `connect-src` becomes `'self' https://api.new.com https://analytics.google.com`, GA host
  unmodified

#### Scenario: A missing GA host fails the build loudly

- **GIVEN** a fixture `index.html` where `connect-src` lacks a GA host that must be present
- **WHEN** the post-rewrite guard runs
- **THEN** the script exits non-zero with a console error naming the missing host
