# Proposal: Calibrate the server-anchored clock from auth responses

## Intent

A student with their device clock fast (ahead of real time by more than a few minutes) can get
stuck in a login loop and never reach `/home`.

Root cause (verified): `identity.expiresAt` is an absolute server epoch-ms. Fiovi compares it
against the device's raw clock in two places that do NOT go through the `Clock` port:

- `src/app.config.ts:267` — `new GetIdentityUseCase(storage, () => Date.now())`.
- `src/L3_periphery/session/browser-session-refresh-scheduler.ts:47` —
  `delayMs = Math.max(0, expiresAt - Date.now() - REFRESH_LEAD_TIME_MS)`.

`ServerAnchoredClock` (`src/L3_periphery/clock/server-anchored-clock.ts`) exists precisely to
avoid this — it stores `offsetMs = serverTime - Date.now()` and every exam use case
(`get-todays-exams`, `get-exams-en-curso`, `get-aula-semanas`, `get-aula-semana-examenes`)
calibrates it from the `serverTime` field of `GET /simulacros`-family responses. But **nothing
calibrates it from auth**, and the offset starts at `0` until the first exam-list GET happens —
which is a page the skewed student never reaches.

Failure sequence with the device clock far enough ahead:

1. Login succeeds; `identity.expiresAt` (a real, near-future server timestamp) already looks
   expired against the device's fast clock.
2. `authGuard` calls `GetIdentityUseCase`, which reads storage and evaluates
   `identity.isExpired(Date.now())` — `true` — so it triggers a reactive refresh.
3. The refresh succeeds (learnex has no clock problem), but `roleGuard` re-checks with the same
   skewed clock immediately after and also sees "expired" → redirects to `/login`.
4. `BrowserSessionRefreshScheduler.schedule()` computes `delayMs = 0` under the same skew and
   fires another refresh immediately, looping until a refresh eventually fails (rate limit,
   network hiccup) and `LogoutUseCase` runs — the student is bounced back to `/login`.

The student never lands on `/home`, so the existing exam-list calibration path never runs either
— there is no self-healing.

## Scope

Anchor session-expiry evaluation to the server-anchored `Clock`, and calibrate that clock from
auth responses — the first network round-trip in the app's lifecycle, before any exam-list GET
can run.

### In Scope

- learnex adds an optional `serverTime` (ISO 8601) field to the response body of
  `POST /auth/login`, `POST /auth/select-tenant`, `POST /t/{slug}/auth/refresh`, and
  `GET /t/{slug}/auth/me` (backend work tracked separately; assumed to land before this change
  deploys — see Dependencies). Fiovi treats the field as **optional**: absent → no calibration,
  behave exactly as today; present but unparseable → skip calibration, `console.warn`, do not
  fail the auth call.
- `HttpAuthRepository` parses `serverTime` (when present and valid) into a `ServerTime` VO and
  returns it alongside the `Identity` from `login`, `selectTenant`, `me`, and `refresh`.
- `LoginUseCase`, `SelectTenantUseCase`, `RefreshIdentityUseCase`, `InitializeSessionUseCase`
  calibrate `Clock` from that `serverTime` (when present) before persisting the identity and
  before scheduling the proactive refresh.
- `GetIdentityUseCase` evaluates `identity.isExpired(...)` against the `Clock` port instead of a
  raw `nowMs` closure over `Date.now()`.
- `BrowserSessionRefreshScheduler` computes its delay against the `Clock` port instead of
  `Date.now()`.
- `agents/api-contract.md` documents the new `serverTime` field on the four auth responses.

### Out of Scope

- The learnex backend change itself — tracked as a separate backend work item. This Fiovi change
  is written to be safe regardless of whether the backend has shipped yet (optional field).
- Guards (`authGuard`, `publicOnlyGuard`, `roleGuard`) — unchanged. They already delegate to
  `GetIdentityUseCase`; fixing the clock there is sufficient.
- The interceptor's reactive 401/refresh path (`credentials.interceptor.ts`) — unchanged.
- `GetProfileUseCase`'s own `nowMs` (profile cache TTL) — unrelated concern, out of scope.
- Replacing `Date.now()` anchoring in `ServerAnchoredClock` itself with something else (e.g.
  `performance.now()`) — considered and rejected, see `design.md`.
- Calling a dedicated `/health`-style endpoint after login purely to fetch server time —
  considered and rejected, see `design.md`.
- Detecting or alerting on clock skew as a product feature (toast, banner) — not requested, not
  needed once calibration happens transparently.

## Capabilities

### Modified Capabilities

- `auth-session`: auth responses now optionally carry `serverTime`, and the four session-mutating
  use cases (login, select-tenant, refresh, initialize-session) calibrate the `Clock` from it;
  `GetIdentityUseCase` evaluates expiry through the `Clock` port instead of a raw `nowMs` closure.
- `server-time-sync`: calibration sources now include the auth endpoints, in addition to the
  existing exam-list endpoints. Anchoring to `Date.now()` inside `ServerAnchoredClock` is
  unchanged.

## Approach

- **L1 (domain)**: new value-object `AuthSession` (`{ identity: Identity; serverTime: ServerTime
  | null }`) pairs an `Identity` with the optional calibration timestamp from the same response.
  `AuthRepository` port methods `login`, `selectTenant`, `me`, `refresh` return `AuthSession`
  (login keeps its `SelectionChallenge` branch untouched). `Clock` port is unchanged.
- **L2 (application)**: `LoginUseCase`, `SelectTenantUseCase`, `RefreshIdentityUseCase`,
  `InitializeSessionUseCase` each gain a `Clock` constructor dependency, destructure
  `{ identity, serverTime }` from the repository call, calibrate the clock when `serverTime` is
  non-null, then proceed exactly as today (persist identity, schedule refresh, fire profile
  fetch). `GetIdentityUseCase` swaps its `nowMs: () => number` constructor param for `Clock`.
- **L3 (adapters)**: `HttpAuthRepository`'s two DTOs (`PublicAuthResponseDto`,
  `TenantAuthResponseDto`) gain `serverTime?: string`; both mappers build an `AuthSession`
  instead of returning `Identity` directly, parsing `serverTime` into `ServerTime` in a
  try/catch (invalid → `null` + `console.warn`, never throws). `BrowserSessionRefreshScheduler`
  injects `Clock` (same `CLOCK` token import pattern already used by `LR_render` view-models)
  and computes `delayMs` against `this.clock.now()`.
- **Bootstrap**: `app.config.ts` factories for `LoginUseCase`, `SelectTenantUseCase`,
  `RefreshIdentityUseCase`, `InitializeSessionUseCase`, `GetIdentityUseCase` add `CLOCK` to their
  `deps` array and constructor call.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/L1_domain/value-objects/auth-session.ts` | Added | `AuthSession { identity, serverTime }` |
| `src/L1_domain/ports/auth-repository.ts` | Modified | `login/selectTenant/me/refresh` return `AuthSession` (login keeps `\| SelectionChallenge`) |
| `src/L3_periphery/http/http-auth-repository.ts` | Modified | DTOs gain `serverTime?: string`; mappers build `AuthSession`, parse `serverTime` defensively |
| `src/L3_periphery/session/browser-session-refresh-scheduler.ts` | Modified | Inject `Clock`; `schedule()` uses `clock.now()` instead of `Date.now()` |
| `src/L2_application/use-cases/login.use-case.ts` | Modified | Inject `Clock`; calibrate before persist/schedule |
| `src/L2_application/use-cases/select-tenant.use-case.ts` | Modified | Same |
| `src/L2_application/use-cases/refresh-identity.use-case.ts` | Modified | Same |
| `src/L2_application/use-cases/initialize-session.use-case.ts` | Modified | Same |
| `src/L2_application/use-cases/get-identity.use-case.ts` | Modified | `nowMs` param → `Clock` param; `isExpired(clock.now().getTime())` |
| `src/app.config.ts` | Modified | `deps`/factory updates for the 5 use cases above |
| `agents/api-contract.md` | Modified | Document `serverTime` on the 4 auth responses |
| `tests/unit/L2_application/fakes.ts` | Reused | `FakeClock` already exists (used by exam use cases) — reused, not modified |
| `tests/unit/fixtures/auth-repository.fake.ts` | Modified | `willResolve*` helpers wrap `Identity` in `AuthSession` |
| `tests/unit/L2_application/use-cases/login.use-case.spec.ts` | Modified | New `Clock` dep; calibration order assertions |
| `tests/unit/L2_application/use-cases/select-tenant.use-case.spec.ts` | Modified | Same |
| `tests/unit/L2_application/use-cases/refresh-identity.use-case.spec.ts` | Modified | Same |
| `tests/unit/L2_application/use-cases/initialize-session.use-case.spec.ts` | Modified | Same |
| `tests/unit/L2_application/use-cases/get-identity.use-case.spec.ts` | Modified | `Clock` dep; skew scenario |
| `tests/feature/L3_periphery/http/http-auth-repository.spec.ts` | Modified | `serverTime` present/absent/invalid cases |
| `tests/feature/L3_periphery/session/browser-session-refresh-scheduler.spec.ts` | Modified | Delay computed from calibrated clock |

Estimated volume: ~180 LOC prod + ~220 LOC test across ~16 files. Single PR.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| learnex `serverTime` field not deployed yet when this Fiovi change merges | Medium | Field is optional end-to-end; absence is a no-op, not an error. Verified by explicit test case. |
| `serverTime` present but malformed (backend bug, clock drift on server) | Low | `ServerTime` constructor throws `InvalidServerTimeError` on unparseable input; mapper catches it, calibration is skipped, `console.warn` logs it — auth still succeeds. |
| Calibration order bug (schedule fires before calibration) reintroduces the loop under skew | Medium | Explicit test per use case asserting `clock.setServerTime` is called before `refreshScheduler.schedule`. |
| Missed call site when switching `AuthRepository` return shape | Low | TypeScript breaks every consumer at compile time (4 use cases + fakes); `npm test`/`npm run build` catch it. |
| `GetProfileUseCase`'s separate `nowMs` gets conflated with this change | Low | Explicitly out of scope; not touched. |

## Alternatives considered

- **Hardcode a fixed TTL assumption** (e.g. "access tokens live 15 minutes, don't bother reading
  `expiresAt` precisely") — rejected: silent drift the moment the backend TTL changes, and it
  does not fix the underlying "never anchored to server time" problem for exam countdowns either.
- **Call `GET /health` (or any cheap endpoint) right after login just to read server time** —
  rejected: adds one extra IP-throttled request per student at the exact moment of the morning
  login stampede, which has already produced 429s in learnex. Piggybacking `serverTime` on
  responses the client already needs (login/refresh/me) costs nothing extra.
- **Anchor `ServerAnchoredClock` to `performance.now()` instead of `Date.now()`** — rejected:
  `performance.now()` pauses while the device sleeps on mobile, so the offset would silently go
  stale across the very "device slept overnight, cookie still valid" scenario the refresh
  scheduler explicitly handles today (see its `schedule()` doc comment). `Date.now()` keeps
  advancing during sleep, which is what an absolute epoch comparison needs.

## Rollback Plan

Revert the PR. No data migration, no persisted schema change (`Identity` shape in
`IdentityStorage` is untouched — only the repository method signatures and two clock-consumers
change). The backend `serverTime` field, if already deployed, is simply ignored by the reverted
frontend — no coordination needed either direction.

## Dependencies

- learnex adds `serverTime: string` (ISO 8601) to the response body of `POST /auth/login`,
  `POST /auth/select-tenant`, `POST /t/{slug}/auth/refresh`, `GET /t/{slug}/auth/me`. Tracked as a
  parallel backend change. This Fiovi change does not block on it landing first (field is
  optional), but the fix is inert until it does.
- No new npm packages, no `.env` changes.

## Success Criteria

- [ ] With the backend `serverTime` field present, a device clock set 30+ minutes ahead no longer
  triggers the login loop: `authGuard`/`roleGuard` see a valid, non-expired identity right after
  login, before any exam-list GET runs.
- [ ] Without the backend field (absent `serverTime`), behavior is byte-for-byte identical to
  today — no exceptions, no changed timing.
- [ ] `login`, `selectTenant`, `refresh`, `me` calibrate the clock strictly before the identity is
  persisted and before the refresh scheduler is armed with the new `expiresAt`.
- [ ] `GetIdentityUseCase` and `BrowserSessionRefreshScheduler` no longer call `Date.now()`
  directly — both read time exclusively through the `Clock` port.
- [ ] `agents/api-contract.md` documents `serverTime` on all four auth responses.
- [ ] `npm test` green (baseline ~1410/1417, same pre-existing 7 reds in
  `cloudflare-turnstile-provider.spec.ts`, unrelated to this change).
- [ ] `npm run lint` clean; `hexagonal-guard` reports no violations (per CONTRIBUTING.md rule #3).
