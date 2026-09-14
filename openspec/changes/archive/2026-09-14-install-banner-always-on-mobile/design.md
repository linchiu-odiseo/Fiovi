# Design: Install banner always visible on mobile browsers

Mechanical change: delete one port + its adapter, add one member to a union, re-route two
switch branches, adjust copy. No new layer, no new pattern, no new dependency. The existing
hexagonal wiring is unchanged (`eslint.config.js:40-83` boundaries still hold). This note only
records the decisions that are not obvious from the diff.

## Decisions

### D1. Delete `InstallPromptStore` entirely instead of leaving it wired

Once `DecideInstallCardStateUseCase` stops calling `isMarkedInstalled()`, the port has zero
readers. Its only writer (`BeforeInstallPromptAdapter.onAppInstalled`) writes a flag nobody
reads. Keeping it "in case we need it later" would leave a port, an adapter, a DI token, a
provider, a factory dep, a fake and a spec whose sole purpose is feeding a dead read —
the exact anemic/ceremonial shape `hexagonal-guard` flags. It is also actively misleading:
the next reader would assume install state is still being honored. Deleting is cheap and
`git revert` restores it verbatim if rule 3 is ever walked back.

Removed: `L1_domain/ports/install-prompt-store.ts`,
`L3_periphery/storage/local-storage-install-prompt-store.ts`, `INSTALL_PROMPT_STORE` in
`tokens.ts`, provider + factory param/dep in `app.config.ts`, the fake and the adapter spec.

### D2. The `appinstalled` listener in `before-install-prompt.adapter.ts` STAYS — highest-risk edit

`onAppInstalled` does three things; only the first one goes away:

```
this.store.markInstalled();      // ← deleted with D1
this.deferredPrompt = null;      // ← KEEP: the event is single-use and now stale
this.availableSignal.set(false); // ← KEEP: drives isAvailable() and the LR signal
```

Deleting the whole handler (or the `addEventListener('appinstalled', ...)` line in `start()`)
is an easy accident because the only reason the listener is *documented* today is the store.
If it goes, a user who installs from Chrome's menu keeps `available === true` over a consumed
prompt, and tapping the card calls `prompt()` on a dead event → `trigger()` returns
`'unavailable'` silently. Guard: the adapter spec keeps a case asserting `available` flips to
`false` and a later `trigger()` returns `'unavailable'` after `appinstalled`. The class comment
must be rewritten to state the cleanup purpose, not the store purpose.

### D3. Two independent `appinstalled` listeners — do not merge, do not touch the other

`audit-log-listeners.ts:50-53` registers its own `window.addEventListener('appinstalled', ...)`
that appends `{ e: 'AI', mode: 'prompt-accepted' }` to the audit-log store. It is a different
subscriber to the same browser event, owned by the telemetry capability, and out of scope.
Browsers fan out to every listener, so there is no interaction between them. Whoever implements
D2 will grep `appinstalled` and find two hits: only the one in `before-install-prompt.adapter.ts`
is in scope.

### D4. New `androidInstructions` state instead of reusing `webviewFallback`

Both are "we cannot fire the native dialog, here is what to do", but the instruction differs:
`webviewFallback` says *leave this embedded browser and open it in your real one*;
`androidInstructions` says *stay here, open Chrome's ⋮ menu → "Instalar aplicación"*. Reusing
`webviewFallback` for Chromium Android would save one union member and one modal `@case` at the
cost of telling a Chrome user to open Chrome. Adding the state keeps the LR switch exhaustive
and the compiler points at every consumer that needs a branch.

### D5. Keep `iosOther` in `InstallPlatform`, change only its interpretation

`iosOther` (Chrome/Edge/Firefox on iOS) is still a true, useful description of the environment —
the probe is not wrong, our old conclusion was. Removing the enum member would force edits to
`browser-install-environment-probe.ts` and its ~15 `getPlatform()` tests for zero behavioral
gain. So the probe stays untouched (per proposal Out of Scope) and the use case maps
`iosOther → iosInstructions`. Consequence: LR's `iosOtherBrowser` mode has no producer and is
deleted along with the now-false Safari-only hint.

### D6. The use case stays synchronous

`navigator.getInstalledRelatedApps()` was evaluated and rejected (see proposal Alternatives).
Recording the architectural consequence here: no async API enters this path, so
`DecideInstallCardStateUseCase.execute()` remains a pure sync read of three ports. The card's
state is final on first render — no flicker, no loading state in the card, no bootstrap
blocking, no new port. If detection is ever revisited, that is where the cost lands.

## Implementation order

Sequenced so the TypeScript compiler is the safety net — each step deliberately breaks the
build for the next one:

1. **L2**: `InstallCardState` union + `DecideInstallCardStateUseCase` (drop the store ctor dep
   and the `isMarkedInstalled()` return; re-route `androidChromium` and `iosOther`).
   Breaks every consumer of the union and every construction site of the use case.
2. **LR**: `InstallInstructionsMode` (`-iosOtherBrowser`, `+androidInstructions`), modal HTML
   cases and copy, `install-app-card.component.ts` routing. Compiler-driven.
3. **L1 + L3 + bootstrap**: delete the port, the adapter, the token, the provider and the
   factory param/dep; strip the store from `before-install-prompt.adapter.ts` applying D2.
4. **Tests**: update/delete specs, drop the fake, add the Android-without-prompt case.

## Verification

`npm test` → baseline is **1410/1417**; the 7 reds in
`tests/feature/L3_periphery/captcha/cloudflare-turnstile-provider.spec.ts` are pre-existing
(local `devTools: true`) and must stay exactly 7. `npm run lint` clean.
`grep -r InstallPromptStore src/ tests/` → no hits. `hexagonal-guard` before archive.
