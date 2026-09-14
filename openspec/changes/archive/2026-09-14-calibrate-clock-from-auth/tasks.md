# Tasks: Calibrate the server-anchored clock from auth responses

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~400 (~180 prod + ~220 test) across ~16 files |
| 400-line budget risk | Medium (right at the boundary) |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | single-pr |
| Chain strategy | n/a |

Decision needed before apply: No
Chained PRs recommended: No
PR base: `develop` (repo convention)

---

## Phase 1: L1 — `AuthSession` value-object + `AuthRepository` port signature

Per `design.md` § Implementation order: L1 goes first, deliberately breaking every consumer of
the port at compile time.

- [x] 1.1 **ADD** `src/L1_domain/value-objects/auth-session.ts` — new interface
  `AuthSession { readonly identity: Identity; readonly serverTime: ServerTime | null }`, plain
  data shape (no behavior), same style as `selection-challenge.ts`. Doc comment explains why
  `serverTime` is nullable (absent or invalid on the wire — see design.md D3) and why it is a
  sibling field of `Identity` rather than baked into it (design.md D1).
- [x] 1.2 **MODIFY** `src/L1_domain/ports/auth-repository.ts` — change return types:
  `login(...): Promise<AuthSession | SelectionChallenge>`, `selectTenant(...): Promise<AuthSession>`,
  `me(): Promise<AuthSession>`, `refresh(): Promise<AuthSession>`. `logout`, `getProfile`,
  `listSsoProviders` unchanged. Update the doc comments that currently say "Retorna `Identity`"
  to say "Retorna `AuthSession`". Import `AuthSession` from `../value-objects/auth-session`.
  This intentionally breaks `HttpAuthRepository` and `FakeAuthRepository` (compiler-driven, per
  design.md).

## Phase 2: L3 adapter — `HttpAuthRepository`

- [x] 2.1 **MODIFY (test-first)** `tests/feature/L3_periphery/http/http-auth-repository.spec.ts`
  — add three cases per mapper path (`login`, `selectTenant`, `me`, `refresh` share the same
  parsing logic, but cover at least `login` and `refresh` explicitly to exercise both DTO
  shapes): (a) response body includes a valid `serverTime` ISO string → resolved
  `AuthSession.serverTime` is a `ServerTime` whose `toMillis()` matches; (b) response body omits
  `serverTime` → `AuthSession.serverTime` is `null`, call still resolves with the identity
  intact; (c) response body has an unparseable `serverTime` (e.g. `"not-a-date"`) →
  `AuthSession.serverTime` is `null`, call still resolves (does not reject), and a
  `console.warn` spy was called. Update every existing assertion in this file that currently
  does `expect(await repo.login(...)).toEqual(someIdentity)` (or `me`/`refresh`/`selectTenant`)
  to unwrap `.identity` instead, or compare against `{ identity: someIdentity, serverTime: null }`
  — whichever keeps the diff smallest per assertion. Covers spec requirements "`AuthSession`
  empareja `Identity` con el `serverTime`" (all three scenarios) and "Puerto `AuthRepository`
  evolucionado".
- [x] 2.2 **MODIFY** `src/L3_periphery/http/http-auth-repository.ts` — make 2.1 pass:
  - Add `serverTime?: string` to both `PublicAuthResponseDto` and `TenantAuthResponseDto`.
  - Add a private helper `private parseServerTime(raw: string | undefined): ServerTime | null`
    implementing design.md D3's try/catch (returns `null` + `console.warn` on
    `InvalidServerTimeError`, returns `null` silently when `raw` is undefined).
  - `mapIdentityFromPublic` and `mapIdentityFromTenant` (or their callers) now return
    `AuthSession` — wrap the existing `Identity` construction as `{ identity: buildIdentity(...),
    serverTime: this.parseServerTime(dto.serverTime) }`. `buildIdentity(...)` itself is
    unchanged (still returns bare `Identity`).
  - `login()`, `selectTenant()`, `me()`, `refresh()` return the `AuthSession`-wrapped result
    instead of the bare identity; the `SelectionChallenge` early-return branch in `login()` is
    untouched.
  - Import `ServerTime` and `AuthSession`.

## Phase 3: Test fixture — `FakeAuthRepository`

Mechanical unblock for every L2 auth use case spec (Phase 4) — do this before Phase 4 so those
specs can compile against the new port shape while still being written test-first for their own
behavior.

- [x] 3.1 **MODIFY** `tests/unit/fixtures/auth-repository.fake.ts` — update
  `willResolveLogin`/`willResolveSelectTenant`/`willResolveMe`/`willResolveRefresh` and their
  backing fields/return types to accept and return `AuthSession | SelectionChallenge` (login)
  or `AuthSession` (the other three) instead of bare `Identity`. Add a small helper —
  `authSession(identity: Identity, serverTime: ServerTime | null = null): AuthSession` — so
  existing call sites that only care about the identity can write
  `fake.willResolveLogin(authSession(identity))` and get `serverTime: null` by default (no
  calibration — matches today's behavior unless a test opts in). Import `AuthSession` and
  `ServerTime`.

## Phase 4: L2 — auth use cases calibrate the `Clock`

Test-first per use case. Every spec in this phase reuses the existing `FakeClock` from
`tests/unit/L2_application/fakes.ts:664` (already used by exam use case specs) — do not write a
new clock double.

- [x] 4.1 **MODIFY (test-first)** `tests/unit/L2_application/use-cases/login.use-case.spec.ts` —
  add `Clock` (`FakeClock`) to the `beforeEach` construction of `LoginUseCase`. Update every
  `fake.willResolveLogin(identity)` call to `fake.willResolveLogin(authSession(identity))` (or
  with an explicit `ServerTime` where the case needs one). Add two new cases: (a) login resolves
  with a `serverTime` → `clock.getSetServerTimeCalls()` has one entry equal to that
  `ServerTime`, and it happened before `refreshScheduler`'s recorded schedule call (assert via
  call-order tracking already available on the fakes, or a shared ops-log array if simplest);
  (b) login resolves with `serverTime: null` → `clock.getSetServerTimeCalls()` is empty, and
  the rest of the flow (storage write, `pwaCookieMode.enable()`, scheduler) is unaffected.
  Covers spec Requirement "`login`, `selectTenant`, `refresh` y `me` calibran el `Clock` antes
  de persistir y agendar" (both scenarios for login).
- [x] 4.2 **MODIFY** `src/L2_application/use-cases/login.use-case.ts` — make 4.1 pass: add
  `Clock` constructor param; destructure `const outcome = await this.authRepo.login(credentials);
  if ('selectionToken' in outcome) return outcome;` then `const { identity, serverTime } =
  outcome;`; `if (serverTime) this.clock.setServerTime(serverTime);` immediately after, before
  `await this.identityStorage.write(identity)`.
- [x] 4.3 **MODIFY (test-first)** `tests/unit/L2_application/use-cases/select-tenant.use-case.spec.ts`
  — same pattern as 4.1: add `FakeClock`, wrap `willResolveSelectTenant` results in
  `authSession(...)`, add the calibrate-before-schedule and no-serverTime cases. Covers the
  `select-tenant` scenarios of the same requirement.
- [x] 4.4 **MODIFY** `src/L2_application/use-cases/select-tenant.use-case.ts` — make 4.3 pass:
  add `Clock` constructor param; destructure `AuthSession`; calibrate before
  `identityStorage.write`.
- [x] 4.5 **MODIFY (test-first)** `tests/unit/L2_application/use-cases/refresh-identity.use-case.spec.ts`
  — same pattern: add `FakeClock`, wrap `willResolveRefresh` in `authSession(...)`, add
  calibrate-before-schedule and no-serverTime cases. Also add a case confirming
  `clock.setServerTime` is NOT called when `authRepo.refresh()` rejects with
  `RefreshFailedError` (calibration only happens on the success path). Covers the `refresh`
  scenarios of the requirement, plus "Refresh fallido — no se calibra ni se agenda".
- [x] 4.6 **MODIFY** `src/L2_application/use-cases/refresh-identity.use-case.ts` — make 4.5 pass:
  add `Clock` constructor param; destructure `AuthSession` from the try block; calibrate before
  `identityStorage.write`; the `catch` branch (logout on `RefreshFailedError`) is unaffected —
  calibration line only runs on the success path already inside the `try`.
- [x] 4.7 **MODIFY (test-first)** `tests/unit/L2_application/use-cases/initialize-session.use-case.spec.ts`
  — same pattern: add `FakeClock`, wrap `willResolveMe` in `authSession(...)`, add
  calibrate-before-schedule and no-serverTime cases for the `me()` success path. The
  `SessionExpiredError`/`UnsupportedRoleError`/`NetworkError` branches are unaffected — add or
  keep an assertion that `clock.setServerTime` is NOT called on those paths.
- [x] 4.8 **MODIFY** `src/L2_application/use-cases/initialize-session.use-case.ts` — make 4.7
  pass: add `Clock` constructor param; destructure `AuthSession` from `authRepo.me()`; calibrate
  before `identityStorage.write`, inside the existing `try` block, before
  `refreshScheduler.schedule(...)`.
- [x] 4.9 **MODIFY (test-first)** `tests/unit/L2_application/use-cases/get-identity.use-case.spec.ts`
  — replace the `nowMs: () => number` fixture with a `FakeClock` from
  `tests/unit/L2_application/fakes.ts` (or a locally-scoped minimal `Clock` double if importing
  from `fakes.ts` is awkward here — match whichever existing L2 spec convention is closer).
  Update the four existing cases to construct `new GetIdentityUseCase(storage, clock)`. Replace
  the last case ("nowMs inyectado permite control del tiempo") with two cases matching spec
  requirement scenarios: (a) local system clock (`vi.setSystemTime`) set 30 minutes ahead of the
  server, `Clock` calibrated to compensate → identity (with a real future `expiresAt`) reads as
  valid; (b) same system-clock skew, `Clock` NOT calibrated (offset 0) → identity reads as
  expired. Covers spec Requirement "`GetIdentityUseCase`" (renombrado) — both new skew
  scenarios.
- [x] 4.10 **MODIFY** `src/L2_application/use-cases/get-identity.use-case.ts` — make 4.9 pass:
  replace `nowMs: () => number = () => Date.now()` constructor param with `clock: Clock`; change
  `identity.isExpired(this.nowMs())` to `identity.isExpired(this.clock.now().getTime())`. Import
  `Clock` from `../../L1_domain/ports/clock` instead of removing the now-unused `Date.now`
  default.

## Phase 5: L3 — `BrowserSessionRefreshScheduler` reads `Clock`

- [x] 5.1 **MODIFY (test-first)** `tests/feature/L3_periphery/session/browser-session-refresh-scheduler.spec.ts`
  — inject a fake/stub `Clock` (local `FakeClock` implementing `Clock`, matching the file's
  existing TestBed/fake conventions) into the scheduler's construction. Add a case: with
  `vi.setSystemTime` 30 minutes ahead of the server and the fake `Clock` returning the
  server-accurate time, `schedule(expiresAt)` computes `delayMs` from the calibrated clock (not
  from the skewed `Date.now()`) — assert via the fake timer (`vi.useFakeTimers()` +
  `vi.advanceTimersByTime` or an equivalent already used in this spec) that the scheduled
  callback fires at the time computed from `clock.now()`, not from `Date.now()`. Keep all
  existing cases passing (they may need the `Clock` stub added to their setup without changing
  their assertions). Covers spec Requirement "Countdowns en la UI usan el `Clock`
  server-anchored" — scenario "Delay de refresh proactivo anclado al server".
- [x] 5.2 **MODIFY** `src/L3_periphery/session/browser-session-refresh-scheduler.ts` — make 5.1
  pass: `import { CLOCK } from '../../app.config';` and `import { Clock } from
  '../../L1_domain/ports/clock';`; add `private readonly clock = inject<Clock>(CLOCK);`; change
  `schedule()`'s `delayMs` computation from `Date.now()` to `this.clock.now().getTime()`. Update
  the class doc comment if it references `Date.now()` explicitly. Per design.md D4, this mirrors
  the existing `LR_render` `CLOCK` import pattern — not a new convention.

## Phase 6: Wiring — `app.config.ts`

Compiler-driven: every factory touched in Phase 4 now requires a `Clock` argument.

- [x] 6.1 **MODIFY** `src/app.config.ts` — for each of the five factories below, add `CLOCK` to
  the `deps` array and thread a `clock: Clock` param into the `useFactory` function and the
  constructor call:
  - `LoginUseCase` factory (~line 185-202)
  - `SelectTenantUseCase` factory (~line 204-229)
  - `GetIdentityUseCase` factory (~line 266-269) — replace `() => new GetIdentityUseCase(storage,
    () => Date.now())` with `(storage, clock) => new GetIdentityUseCase(storage, clock)`; `deps:
    [IDENTITY_STORAGE, CLOCK]`.
  - `RefreshIdentityUseCase` factory (~line 271-286)
  - `InitializeSessionUseCase` factory (~line 288-303)

  `CLOCK` is already imported and defined at the top of this file (line 114) and already used by
  other factories (`deps: [EXAMS_API, CLOCK]` etc.) — reuse the same token, no new import needed.

## Phase 7: Docs

- [x] 7.1 **MODIFY** `agents/api-contract.md` — add a `serverTime` field to the three documented
  JSON response examples under "Auth endpoints (Fase 3 — learnex)" (`POST /auth/login` response
  200, and the "mismo shape que login" notes for `POST /auth/refresh` and `GET /auth/me`), and
  add one sentence near the existing note at line 42 ("Tras `POST /auth/login` y `POST
  /auth/refresh`, el body trae además...") stating that the body may also include an optional
  `serverTime` (ISO 8601) used by the client to calibrate its clock, and that the field is
  optional — its absence is not an error.

## Phase 8: Grep sweep + final gates

- [x] 8.1 `grep -rn "Date.now()" src/L2_application/use-cases/get-identity.use-case.ts
  src/L3_periphery/session/browser-session-refresh-scheduler.ts` returns nothing — both files
  read time exclusively through `Clock`.
- [x] 8.2 `npm test` green, same baseline as `develop` (~1410/1417, the 7 pre-existing reds in
  `tests/feature/L3_periphery/captcha/cloudflare-turnstile-provider.spec.ts` unrelated and
  untouched).
- [x] 8.3 `npm run lint` clean.
- [x] 8.4 `npm run format:check` clean (or only the known pre-existing CRLF-illusion noise — see
  `docs/` guidance on `core.autocrlf`; verify via `git diff --shortstat` on any files this change
  did not touch before assuming a warning is pre-existing).
- [x] 8.5 **`hexagonal-guard` subagent** (blocking gate per `CONTRIBUTING.md` rule #3) — run
  during `sdd-verify`, not by `sdd-apply`. DONE: Hexagonal-guard approved with no critical violations.
  `AuthSession` is a plain L1 VO (same shape as `SelectionChallenge`); no new mapper violations;
  `BrowserSessionRefreshScheduler`'s `CLOCK` import from `app.config.ts` matches the
  pre-existing accepted pattern (`envio-retry-dispatcher.service.ts` + `CONNECTIVITY`).

## PR

- [ ] 9.1 Single PR, `--base develop` (repo convention). Estimated ~400 changed lines across
  ~16 files sits at the edge of the 400-line review budget — if the actual diff comes in over
  400, split by layer (L1+L3 adapter+fixture in PR #1, L2 use cases+scheduler+wiring in PR #2)
  rather than force a same-PR squeeze; confirm with `git diff --stat` before opening.
  **Note: PR will be opened by orchestrator after archive is complete.**
