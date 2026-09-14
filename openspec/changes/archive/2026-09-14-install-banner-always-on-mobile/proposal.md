# Proposal: Install banner always visible on mobile browsers

## Intent

Students are not installing the PWA. The install card exists but is invisible in the most common case.

Root cause (verified): in `decide-install-card-state.use-case.ts:60-64` the `androidChromium` branch returns `{ kind: 'hidden' }` while `beforeinstallprompt` has not fired. Chrome only fires that event after its own heuristics (active SW — registration is `registerWhenStable:30000` in `app.config.ts:145` — plus user engagement), so the typical Android student in a short session sees nothing at all. iOS has an instructions fallback; Android has none. That asymmetry is the bug.

Second, permanently hiding the card after `appinstalled` (the `InstallPromptStore` guard at line 52) means a student who installed once but reopens Fiovi in the browser gets no guidance back to the app.

## Scope

Exactly three visibility rules. Nothing else.

1. Desktop → card never shown.
2. Mobile running standalone (inside the installed app) → card never shown.
3. Mobile in a browser → card ALWAYS shown, regardless of prior installation and regardless of browser.

### In Scope

- Remove the `InstallPromptStore` guard and **delete the port, adapter, token, DI wiring, fake and spec entirely** (no consumers remain — not tolerable dead code).
- New `InstallCardState` kind for Android without native prompt: keep `nativePrompt` when `native.isAvailable()`, otherwise show the card tappable with manual Android instructions (Chrome menu → "Instalar aplicación"). **This is the actual fix that makes Android students install.**
- Unify iOS: `iosOther` now resolves to `iosInstructions`. Since iOS 17 Chrome/Edge on iPhone do install from their own Share button. The `iosOther` value of `InstallPlatform` stays (probe stays untouched); only its consumption changes. The modal's `iosOtherBrowser` mode becomes unreachable and is deleted, along with the now-false hint "Asegúrate de tener Fiovi abierta en Safari…".
- Modal copy closes with a line for the already-installed case: "Si ya la instalaste, ábrela desde el ícono en tu pantalla de inicio." (es-PE neutral, no voseo).
- Android instructions must stay true for the already-installed student too. Chrome's menu shows "Abrir aplicación" instead of "Instalar aplicación" once the PWA is installed, so quoting only "Instalar aplicación" sends them looking for an entry that is not there. Step 2 covers both: "Toca **Instalar aplicación**. Si en su lugar dice **Abrir aplicación**, ya la tienes instalada — tócalo y listo."
- iOS instructions drop "en la barra de abajo" from the Share step. That location is Safari-only; Chrome/Edge on iPhone put Share at the top. Now that `iosOther` resolves to the same modal, the step must read just "Toca el botón Compartir" so it is correct in every iOS browser.
- Update/delete the specs this change breaks; add coverage for the new Android state.

### Out of Scope

- `webviewFallback` (WhatsApp/Instagram/Gmail → "abre esto en tu navegador") — unchanged.
- `InstallEnvironmentProbe` and `browser-install-environment-probe.ts` — unchanged.
- The `appinstalled` listener in `audit-log-listeners.ts` (audit-log `AI mode:'prompt-accepted'`) — **explicitly untouched**; it is a separate listener on the same browser event.
- Detecting whether the app is already installed (see Alternatives considered).
- Card placement in `home.page.html:138` / `tutor-exams-list.page.html:169` (outside loading/error chains) — existing behavior, kept.
- Fixing the 7 pre-existing red tests in `cloudflare-turnstile-provider.spec.ts` (caused by local `devTools: true`; unrelated).
- I18n, dismiss/snooze, analytics, new env vars.

## Capabilities

### New Capabilities

- `pwa-install-prompt`: when and how Fiovi offers itself for installation — card visibility rules by platform/form-factor and the per-platform install flow (native prompt, iOS instructions, Android manual instructions, webview fallback).

### Modified Capabilities

- None. No existing spec in `openspec/specs/` covers the install card today.

## Approach

- **L1 (domain)**: delete `ports/install-prompt-store.ts`. `install-environment-probe.ts` untouched (`iosOther` stays as valid probe output).
- **L2 (application)**: `DecideInstallCardStateUseCase` drops the `InstallPromptStore` ctor dependency and the `isMarkedInstalled()` early return. `InstallCardState` gains `{ kind: 'androidInstructions' }`. `androidChromium` → `nativePrompt` if available, else `androidInstructions`. `iosOther` → `iosInstructions`. `iosOtherBrowser` removed from the union. `standalone`/non-mobile/`desktop`/`unknown` → `hidden` (unchanged).
- **L3 (adapters)**: delete `local-storage-install-prompt-store.ts` and `INSTALL_PROMPT_STORE` from `tokens.ts`. `before-install-prompt.adapter.ts` keeps its `appinstalled` listener (it still clears `deferredPrompt` and resets the `available` signal) and only loses the `store.markInstalled()` call and the store injection.
- **LR (render)**: `InstallInstructionsMode` swaps `iosOtherBrowser` for `androidInstructions`; modal HTML gets the Android `@case` (Chrome menu steps) and the shared already-installed closing line; `install-app-card.component.ts` routes `androidInstructions` to the modal.
- **Bootstrap**: `app.config.ts` removes the port import (21), the adapter import (80), `INSTALL_PROMPT_STORE` from the tokens import list (87), the provider (154) and the `store` factory param + dep (382-383, 385).

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/L1_domain/ports/install-prompt-store.ts` | Removed | No consumers left |
| `src/L2_application/use-cases/decide-install-card-state.use-case.ts` | Modified | Drop store guard; add `androidInstructions`; `iosOther` → `iosInstructions`; remove `iosOtherBrowser` |
| `src/L3_periphery/storage/local-storage-install-prompt-store.ts` | Removed | Adapter of the deleted port |
| `src/L3_periphery/tokens.ts` | Modified | Remove `INSTALL_PROMPT_STORE` + import + doc comment |
| `src/L3_periphery/pwa/before-install-prompt.adapter.ts` | Modified | Remove store injection and `markInstalled()`; keep the `appinstalled` cleanup |
| `src/L3_periphery/telemetry/audit-log-listeners.ts` | Untouched | Its own `appinstalled` listener stays — do not touch |
| `src/app.config.ts` | Modified | Remove imports (21, 80, 87), provider (154) and factory param/dep (382-383, 385) of the store |
| `src/LR_render/components/install-instructions-modal/install-instructions-modal.component.ts` | Modified | Mode union: `-iosOtherBrowser`, `+androidInstructions` |
| `src/LR_render/components/install-instructions-modal/install-instructions-modal.component.html` | Modified | Delete `iosOtherBrowser` case + Safari-only hint; add Android case; add already-installed line |
| `src/LR_render/components/install-app-card/install-app-card.component.ts` | Modified | Route `androidInstructions` to the modal; update stale comments |
| `tests/unit/fixtures/install-prompt-store.fake.ts` | Removed | Fake of the deleted port |
| `tests/feature/L3_periphery/storage/local-storage-install-prompt-store.spec.ts` | Removed | Spec of the deleted adapter |
| `tests/unit/L2_application/use-cases/decide-install-card-state.use-case.spec.ts` | Modified | Delete `isMarkedInstalled` case; flip `iosOther` expectation; add Android-without-prompt case |
| `tests/feature/LR_render/components/install-app-card.component.spec.ts` | Modified | Delete the installed-hidden case; drop `FakeInstallPromptStore` from providers |
| `tests/feature/L3_periphery/pwa/before-install-prompt.adapter.spec.ts` | Modified | Replace the `markInstalled` case with one asserting only signal/prompt cleanup |

Estimated volume: ~120 LOC prod + ~80 LOC test across ~15 files (several are deletions). Single PR.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Already-installed students see the card again and find it noisy | Medium | Accepted by design (rule 3). Mitigated by the modal's closing line pointing them to the home-screen icon. |
| Android manual instructions drift from Chrome's actual menu wording | Medium | Copy uses generic wording ("menú ⋮ → Instalar aplicación") instead of quoting one exact Chrome version. |
| Deleting a port/adapter/token touches DI wiring in `app.config.ts` | Low | TypeScript + the DI factory `deps` array fail loudly at build time if a reference is missed; `npm test` covers bootstrap. |
| `appinstalled` cleanup accidentally removed together with `markInstalled()` | Low | Explicitly called out above; the adapter spec keeps a case asserting the signal reset. |

## Alternatives considered

- `navigator.getInstalledRelatedApps()` + `related_applications` in `public/manifest.json` to detect on Android whether Fiovi is already installed and swap the copy. **Rejected as overengineering**: it only improves the message for the user who already installed (exactly the one who needs no convincing), requires a new port + adapter + manifest change, introduces a first-render flicker, and only works on Chromium Android.

## Rollback Plan

Revert the PR. No data migration, no backend contract, no coordination with learnex. Stale `fiovi.install_prompt.installed` keys left in students' `localStorage` are inert on both sides of the revert (after the revert the old store reads them again and restores the previous hide-forever behavior).

## Dependencies

- None. No new packages, no `.env` changes, no backend work.

## Success Criteria

- [ ] Desktop: card never rendered (`isMobileFormFactor() === false` → `hidden`).
- [ ] Mobile standalone: card never rendered.
- [ ] Mobile browser: card rendered in every platform branch — `androidChromium` (with or without native prompt), `androidOther`, `iosSafari`, `iosOther`, `webview`.
- [ ] Android with `beforeinstallprompt` captured → tap fires the native dialog (unchanged).
- [ ] Android without `beforeinstallprompt` → tap opens the Android manual instructions modal.
- [ ] iOS Chrome/Edge (`iosOther`) → tap opens `iosInstructions`; the "only Safari" hint is gone from the HTML.
- [ ] The iOS Share step no longer says "en la barra de abajo" (wrong for Chrome/Edge on iPhone).
- [ ] The Android instructions tell the student what to do when Chrome's menu reads "Abrir aplicación" instead of "Instalar aplicación".
- [ ] A student who already installed and reopens in the browser still sees the card, and the modal tells them to open it from the home-screen icon.
- [ ] `InstallPromptStore`, its adapter, token, DI wiring, fake and spec are gone from the repo (grep for `InstallPromptStore` returns nothing under `src/` and `tests/`).
- [ ] The `appinstalled` listener in `audit-log-listeners.ts` is unchanged and `tests/feature/L3_periphery/telemetry/audit-log-listeners.spec.ts` stays green.
- [ ] `npm test` green except the 7 known pre-existing failures in `cloudflare-turnstile-provider.spec.ts` (baseline 1410/1417).
- [ ] `npm run lint` clean; `hexagonal-guard` reports no violations (per CONTRIBUTING.md rule #3).
