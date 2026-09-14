# Design: Calibrate the server-anchored clock from auth responses

Mostly mechanical: one new L1 value-object, one port signature change with four call sites, two
clock-consumers rewired to the `Clock` port. No new layer, no new pattern — `GetTodaysExamsUseCase`
already established "read a port, then `clock.setServerTime(result.serverTime)` as a side effect"
as the calibration pattern; this change replicates it for auth. This note records the decisions
that are not obvious from the diff.

## Decisions

### D1. `AuthRepository` methods return `AuthSession { identity, serverTime }`, not a bare `Identity`

Considered three shapes:

1. **Chosen**: `AuthSession { identity: Identity; serverTime: ServerTime | null }`. `login`
   returns `AuthSession | SelectionChallenge` (unchanged branch for the multi-tenant case);
   `selectTenant`, `me`, `refresh` return `AuthSession`.
2. Two-value return (`[Identity, ServerTime | null]` tuple) — rejected: less self-documenting at
   call sites, and this codebase has no tuple-return precedent (`ExamsListResult`,
   `EnvioResult` etc. are all named-field objects — see `exams-api.ts`).
3. Widen `Identity` itself to carry an optional `serverTime` — rejected: `Identity` is what
   `IdentityStorage` persists (`localStorage`/IDB). Conflating "data we persist" with "a
   one-shot calibration signal from this particular response" would mean either persisting a
   stale `serverTime` forever or adding ad-hoc stripping logic before every `storage.write()`.
   Keeping them as sibling fields on a short-lived return type avoids that entirely.

`AuthSession` lives in `src/L1_domain/value-objects/auth-session.ts`, same style as
`SelectionChallenge` (plain `interface`, no behavior, `readonly` fields) — it is a result shape,
not an entity with invariants to enforce.

### D2. Calibration order inside each use case: clock first, then persist, then schedule

Each of the four use cases follows the same three-line insertion, always in this order:

```
const { identity, serverTime } = await this.authRepo.<method>(...);
if (serverTime) this.clock.setServerTime(serverTime);   // 1. calibrate
await this.identityStorage.write(identity);              // 2. persist (unchanged)
...
this.refreshScheduler.schedule(identity.expiresAt);       // 3. schedule (unchanged)
```

Calibrating before scheduling is the one that matters functionally:
`BrowserSessionRefreshScheduler.schedule()` reads `clock.now()` synchronously the moment it's
called (see D4), so if scheduling ran first under a skewed device clock, the proactive refresh
would still be computed against the stale offset and the fix would be a no-op for that request.
Calibrating before persisting the identity has no functional dependency today (nothing reads the
clock as part of `IdentityStorage.write`), but keeping the calibration step first and unconditional
across all four use cases is one invariant to hold in mind instead of "it depends which use case,"
and it means a future consumer added between calibration and persistence can safely assume the
clock is already anchored. Tests assert the call order explicitly (see `tasks.md`).

### D3. `serverTime` is optional and its absence/invalidity is silent, never fatal

The backend field ships in parallel (see proposal Dependencies) and may not exist yet on some
deploys, or a given response may carry an unparseable value (server clock hiccup, backend bug).
Neither case may break login/refresh/me — those are the app's lifeline. `HttpAuthRepository`'s
mappers wrap the `ServerTime` construction:

```
let serverTime: ServerTime | null = null;
if (dto.serverTime) {
  try {
    serverTime = new ServerTime(dto.serverTime);
  } catch {
    console.warn('HttpAuthRepository: serverTime invalido en la respuesta, se ignora', dto.serverTime);
  }
}
```

`ServerTime`'s constructor already throws `InvalidServerTimeError` on empty/unparseable input
(`src/L1_domain/value-objects/server-time.ts`) — this reuses that validation rather than
duplicating it. The use cases then treat `serverTime: null` as "nothing to calibrate," identical
to the field being absent from the wire — no separate error path.

### D4. `BrowserSessionRefreshScheduler` injects `Clock` via the existing `CLOCK` token import from `app.config.ts`

`CLOCK` is declared as `export const CLOCK = new InjectionToken<Clock>('CLOCK')` inside
`app.config.ts` (not `tokens.ts` — a pre-existing inconsistency, out of scope to fix here). Every
current consumer that needs it (`home.view-model.ts`, `simulacro.view-model.ts`,
`student-tasks-list.view-model.ts`, `tutor-aula-semanas.view-model.ts`,
`tutor-exam-detail.view-model.ts`, `tutor-tasks-list.view-model.ts`) is in `LR_render` and does
`import { CLOCK } from '../../app.config'; private readonly clock = inject(CLOCK);`.

`BrowserSessionRefreshScheduler` is the first L3 file to need it. The same import works: nothing
in `eslint.config.js`'s `import-x/no-restricted-paths` zones restricts `L3_periphery` importing
from the project-root `app.config.ts` (only L1/L2/L3-internal-to-LR zones are restricted — see
`agents/architecture-rules.md`). The apparent circularity (`app.config.ts` imports
`BrowserSessionRefreshScheduler` for its provider registration; the scheduler would import
`CLOCK` back from `app.config.ts`) is not a runtime problem: `CLOCK` is only dereferenced inside
`inject(CLOCK)`, which executes at instance-construction time — after both ES modules have
finished evaluating — exactly the same shape the six existing `LR_render` consumers already rely
on. `@Injectable({ providedIn: 'root' })` classes resolve their `inject()` calls lazily on first
construction, not at module-load time, which is what makes this safe.

Rejected alternative: move `CLOCK` into `tokens.ts` as part of this change to avoid extending the
app.config.ts-import pattern into L3. Rejected because it would touch every existing `CLOCK`
consumer's import path (6 `LR_render` files) for a refactor unrelated to this change's intent —
a separate, smaller change if the team wants it.

### D5. `GetIdentityUseCase` takes `Clock` instead of `nowMs: () => number`

Matches the pattern every exam use case already uses (`GetTodaysExamsUseCase(api, clock)`,
`GetAulaSemanasUseCase`, etc. all take `Clock` directly) rather than a bespoke `nowMs` closure.
`identity.isExpired(this.nowMs())` becomes `identity.isExpired(this.clock.now().getTime())`.
`GetProfileUseCase` keeps its own unrelated `nowMs` (profile cache TTL, not session expiry) —
explicitly out of scope, not touched.

### D6. `ServerAnchoredClock` stays anchored to `Date.now()` — `performance.now()` rejected

`performance.now()` is monotonic and immune to the user changing the system clock, which sounds
attractive for an anti-skew mechanism. But `performance.now()` **pauses while the device
sleeps** on mobile (the exact scenario `BrowserSessionRefreshScheduler.schedule()`'s doc comment
already calls out: "esto sucede al arrancar la app con una identity persistida cuya cookie estuvo
hibernando"). An offset computed as `serverTime - performance.now()` at calibration time would
silently go stale by exactly the sleep duration the next time it's read, reintroducing a skew
this change is trying to eliminate — just from device sleep instead of a manually-set clock.
`Date.now()` keeps advancing during sleep, which is what an absolute epoch (`expiresAt`)
comparison needs. `ServerAnchoredClock.now()`/`setServerTime()` are unchanged by this proposal.

### D7. No dedicated calibration endpoint — piggyback on responses already being fetched

Considered issuing a `GET /health` (or similar cheap endpoint) immediately after login purely to
read server time. Rejected: every login already means one more request at the busiest, most
IP-throttled moment of the day (morning exam login stampede — learnex has already 429'd under
this load per `RateLimitError` handling in `HttpAuthRepository.classifyLoginError`). Piggybacking
`serverTime` on `login`/`select-tenant`/`refresh`/`me` responses the client fetches anyway costs
zero extra round-trips.

## Implementation order

Sequenced so the TypeScript compiler is the safety net for the port signature change:

1. **L1**: `AuthSession` value-object; `AuthRepository` port signature (`login` /
   `selectTenant` / `me` / `refresh` return `AuthSession`, `login`'s `SelectionChallenge` branch
   unchanged). This immediately breaks `HttpAuthRepository` and `FakeAuthRepository` — both are
   compile-time forced to update.
2. **L3 adapter**: `HttpAuthRepository` — DTOs gain `serverTime?: string`; mappers build
   `AuthSession`, applying D3's defensive parse.
3. **Test fixture**: `tests/unit/fixtures/auth-repository.fake.ts` — `willResolve*` helpers wrap
   `Identity` in `AuthSession` so every existing L2 auth use case spec keeps compiling (with
   `serverTime` defaulting appropriately per test).
4. **L2 use cases**: `LoginUseCase`, `SelectTenantUseCase`, `RefreshIdentityUseCase`,
   `InitializeSessionUseCase` — inject `Clock`, destructure `AuthSession`, apply D2's order.
   `GetIdentityUseCase` — swap `nowMs` for `Clock` per D5.
5. **L3 scheduler**: `BrowserSessionRefreshScheduler` — inject `Clock` per D4, read `clock.now()`
   instead of `Date.now()`.
6. **Wiring**: `app.config.ts` — add `CLOCK` to the `deps` array and factory call for all five L2
   use cases touched in step 4.
7. **Docs**: `agents/api-contract.md` — document `serverTime` on the four auth response shapes.

## Verification

`npm test` → same baseline as `develop` (~1410/1417, the 7 pre-existing reds in
`cloudflare-turnstile-provider.spec.ts` untouched). `npm run lint` clean. `npm run format:check`
clean. `hexagonal-guard` before archive — expect no findings: `AuthSession` is a plain L1
value-object with zero behavior (mirrors `SelectionChallenge`, an existing pattern the guard
already accepts), and no new adapter/port/mapper duplicates an existing shape.
