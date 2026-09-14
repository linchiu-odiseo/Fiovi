# Tasks: Install Banner Always Visible on Mobile Browsers

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~200 (~120 prod + ~80 test) across ~15 files |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | single-pr |
| Chain strategy | n/a |

Decision needed before apply: No
Chained PRs recommended: No
PR base: `develop` (repo convention)

---

## Phase 1: L2 — `InstallCardState` union + `DecideInstallCardStateUseCase`

Implementation order per `design.md` § Implementation order: the compiler is the
safety net, so L2 goes first and deliberately breaks every consumer.

- [x] 1.1 **MODIFY (test-first)** `tests/unit/L2_application/use-cases/decide-install-card-state.use-case.spec.ts` — delete the `isMarkedInstalled` guard test (lines 29-33: `'hidden cuando el store marca installed (evento appinstalled disparó antes)'`) and its `store.setInstalled(true)` setup. Covers spec Requirement "Card is always visible on mobile browsers, with no persisted override".
- [x] 1.2 **MODIFY (test-first)** same spec file — flip the `iosOther` expectation (lines 62-65): rename the case to `'iosOther (Chrome/Firefox iOS) → iosInstructions'` and change `expect(useCase.execute()).toEqual({ kind: 'iosOtherBrowser' })` to `{ kind: 'iosInstructions' }`. Covers Requirement "`iosSafari` and `iosOther` both resolve to the same iOS instructions".
- [x] 1.3 **MODIFY (test-first)** same spec file — remove `store`/`FakeInstallPromptStore` from the whole `describe` block: drop the `store` variable, its `beforeEach` instantiation, the `store` constructor arg passed to `new DecideInstallCardStateUseCase(...)`, and the `store.markInstalledCalls` assertion in the side-effect-free test (lines 88-93; keep the `native.triggerCalls` assertion). Update the import list to drop `FakeInstallPromptStore`. This step will not compile yet against current production code — expected, it becomes green after 1.5.
- [x] 1.4 **MODIFY (test-first)** same spec file — add a new case: `'androidChromium + prompt NO disponible → androidInstructions (antes hidden, ahora tentativo)'` — `probe.configure({ platform: 'androidChromium' })`, `native.setAvailable(false)`, expect `{ kind: 'androidInstructions' }`. Replaces the old `'androidChromium + prompt NO disponible → hidden'` case (delete it). Covers Requirement "`androidChromium` resolves to native prompt or manual instructions, never hidden".
- [x] 1.5 **MODIFY** `src/L2_application/use-cases/decide-install-card-state.use-case.ts` — make the tests above pass: drop the `InstallPromptStore` import and the `store` constructor param; delete the `isMarkedInstalled()` early-return (`if (this.store.isMarkedInstalled()) return { kind: 'hidden' };`); in `InstallCardState`, remove `{ kind: 'iosOtherBrowser' }` and add `{ kind: 'androidInstructions' }` (update the union doc-comment blocks accordingly — they currently describe `iosOtherBrowser`, not `androidInstructions`); re-route `androidChromium` to `this.native.isAvailable() ? { kind: 'nativePrompt' } : { kind: 'androidInstructions' }`; re-route `iosOther` to `{ kind: 'iosInstructions' }`. This intentionally breaks every consumer of `InstallCardState` and every construction site of the use case (compiler-driven per design.md).

## Phase 2: LR — modal mode union, HTML copy, card routing

Compiler-driven per design.md: fixing the union in 1.5 already broke
`install-instructions-modal.component.ts` (`InstallInstructionsMode`) and
`install-app-card.component.ts` (exhaustive switch). Fix both, test-first where
a test exists.

- [x] 2.1 **MODIFY** `src/LR_render/components/install-instructions-modal/install-instructions-modal.component.ts` — `InstallInstructionsMode` union: remove `'iosOtherBrowser'`, add `'androidInstructions'`.
- [x] 2.2 **MODIFY** `src/LR_render/components/install-instructions-modal/install-instructions-modal.component.html` — delete the `@case ('iosOtherBrowser')` block entirely (lines 24-36, the "Abre Fiovi en Safari" / copy-URL modal). In the `@case ('iosInstructions')` Share step, change `<span>Toca el botón <strong>Compartir</strong> en la barra de abajo</span>` to `<span>Toca el botón <strong>Compartir</strong></span>` (drop the location claim — Safari-only, wrong for Chrome/Edge on iPhone). Delete the `<p class="modal__hint">Asegúrate de tener Fiovi abierta en Safari — otros navegadores del iPhone no permiten instalar.</p>` block. Add a new `@case ('androidInstructions')` block with title "Instala Fiovi en tu Android" and an `<ol class="steps">` whose step 2 text is exactly: `Toca <strong>Instalar aplicación</strong>. Si en su lugar dice <strong>Abrir aplicación</strong>, ya la tienes instalada — tócalo y listo.` (step 1: open Chrome's ⋮ menu). Add the shared closing line "Si ya la instalaste, ábrela desde el ícono en tu pantalla de inicio." to both the `iosInstructions` and the new `androidInstructions` cases (not to `webviewFallback`, which is a different, unchanged flow). Covers spec Requirements "iOS instructions modal copy is browser-location-agnostic and current", "Android manual instructions cover the already-installed case", "Every instructions modal closes with an already-installed hint".
- [x] 2.3 **MODIFY** `src/LR_render/components/install-app-card/install-app-card.component.ts` — in the `onCardClick()` switch, route `'androidInstructions'` alongside `'iosInstructions'`/`'webviewFallback'` to `this.modalMode.set(state.kind)`; remove `'iosOtherBrowser'` from the switch. Update the stale class-level comment block ("Los únicos oculta-para-siempre son...") and the `nativePrompt` case comment ("accepted → el evento appinstalled marcará el flag permanente...") — both reference the deleted store guard and no longer describe current behavior.
- [x] 2.4 **MODIFY (test-first)** `tests/feature/LR_render/components/install-app-card.component.spec.ts` — delete the `'NO renderiza el card si el store marca installed (flag permanente)'` case (lines 109-114); remove `FakeInstallPromptStore` from imports and from the `DecideInstallCardStateUseCase` construction in `beforeEach` (lines 44, 54, 63); remove `store.markInstalledCalls` assertion in the `androidChromium` click test (line 139) since the store no longer exists — replace with an assertion that the card stays visible/tappable after the native trigger resolves. Add a new case: tap on a card in `androidChromium` state with `native.setAvailable(false)` opens the modal with title matching the Android instructions copy (mirrors the existing `iosSafari`/`webview` modal-open tests).

## Phase 3: L1 + L3 + bootstrap — delete `InstallPromptStore` entirely

Per design.md Decision D1: delete the port, adapter, token, provider, factory
dep, fake and spec — no consumer remains after Phase 1-2.

- [x] 3.1 **MODIFY (highest-risk edit — read design.md D2 before touching this file)** `src/L3_periphery/pwa/before-install-prompt.adapter.ts` — remove ONLY the store injection (`private readonly store = inject<InstallPromptStore>(INSTALL_PROMPT_STORE);`, line 36) and its import (line 3, `INSTALL_PROMPT_STORE` import on line 8), and the `this.store.markInstalled();` call inside `onAppInstalled` (line 54). **DO NOT** delete `onAppInstalled` itself, its `addEventListener('appinstalled', ...)` registration, `this.deferredPrompt = null;`, or `this.availableSignal.set(false);` — those two lines are the only cleanup left for the single-use `beforeinstallprompt` event and MUST stay, or `available` gets stuck `true` over a dead event and a later tap calls `prompt()` on it. Update the class-doc comment above (currently describes marking the store) to state the cleanup purpose instead.
- [x] 3.2 **MODIFY (test-first, do this before 3.1 if strict TDD ordering is preferred within this sub-step)** `tests/feature/L3_periphery/pwa/before-install-prompt.adapter.spec.ts` — replace the `'evento appinstalled marca el flag permanent en el store'` case (lines 77-86) with one that only asserts the signal cleanup: `adapter.start()`, dispatch `beforeinstallprompt`, assert `available() === true`, dispatch `appinstalled`, assert `available() === false` and that a subsequent `await adapter.trigger()` returns `'unavailable'` (proves `deferredPrompt` was nulled). Remove the `INSTALL_PROMPT_STORE` provider and `FakeInstallPromptStore` import/usage from the `beforeEach` TestBed config.
- [x] 3.3 **DELETE** `src/L1_domain/ports/install-prompt-store.ts` — zero consumers remain after 1.5 and 3.1.
- [x] 3.4 **DELETE** `src/L3_periphery/storage/local-storage-install-prompt-store.ts` — adapter of the deleted port.
- [x] 3.5 **DELETE** `tests/feature/L3_periphery/storage/local-storage-install-prompt-store.spec.ts` — spec of the deleted adapter.
- [x] 3.6 **DELETE** `tests/unit/fixtures/install-prompt-store.fake.ts` — fake of the deleted port (already unreferenced after 1.1-1.4, 2.4, 3.2).
- [x] 3.7 **MODIFY** `src/L3_periphery/tokens.ts` — remove the `InstallPromptStore` import (line 5), the `INSTALL_PROMPT_STORE` token declaration (line 72), and trim the "Tokens del card..." doc comment above (currently lists `INSTALL_PROMPT_STORE` as one of three collaborating tokens — drop that bullet).
- [x] 3.8 **MODIFY** `src/app.config.ts` — remove: the `InstallPromptStore` import (line 21), the `LocalStorageInstallPromptStore` import (line 80), `INSTALL_PROMPT_STORE` from the tokens import list (line 87), the `{ provide: INSTALL_PROMPT_STORE, useExisting: LocalStorageInstallPromptStore }` provider (line 154), and the `store` param + `INSTALL_PROMPT_STORE` dep from the `DecideInstallCardStateUseCase` factory (lines 379-386: drop the `store: InstallPromptStore,` param, its use in `new DecideInstallCardStateUseCase(probe, store, native)` → `new DecideInstallCardStateUseCase(probe, native)`, and `INSTALL_PROMPT_STORE` from the `deps` array).
- [x] 3.9 **VERIFY, do not modify** `src/L3_periphery/telemetry/audit-log-listeners.ts` — confirm its independent `window.addEventListener('appinstalled', ...)` (lines 49-53, emits `AI` telemetry) is untouched by 3.1, and that `tests/feature/L3_periphery/telemetry/audit-log-listeners.spec.ts` stays green. Per design.md D3, this is a separate subscriber to the same browser event, owned by the telemetry capability — out of scope.

## Phase 4: Grep sweep + final gates

- [x] 4.1 `grep -r "InstallPromptStore" src/ tests/` returns nothing. If it does, find the leftover reference and remove it before proceeding.
- [x] 4.2 `npm test` green except the 7 known pre-existing failures in `tests/feature/L3_periphery/captcha/cloudflare-turnstile-provider.spec.ts` (baseline 1410/1417, caused by local `devTools: true` — not fixed by this change).
- [x] 4.3 `npm run lint` clean.
- [x] 4.4 `npm run format:check` — 89 pre-existing CRLF-illusion warnings unrelated to this change (confirmed via `git stash`/`git diff --shortstat`: same baseline noise exists on unmodified `develop`, 95 files before this change vs 89 after — reduced only because deleted files dropped off the list). No files touched by this change introduce new real Prettier violations.
- [ ] 4.5 **`hexagonal-guard` subagent** (blocking gate per `CONTRIBUTING.md` rule #3) — NOT run by `sdd-apply` (executor role cannot launch sub-agents). Deferred to `sdd-verify`. Manual self-check done: L1/L2 stay `@angular`/`rxjs`-free; `install-app-card.component.ts`'s pre-existing `L3_periphery` import (`BeforeInstallPromptAdapter`) predates this change (confirmed via `git diff`) and was not introduced or altered by it.
- [ ] 4.6 Manual smoke per proposal Success Criteria — NOT executed on a real device/browser (no such capability in this environment). Equivalent behavior is covered by automated specs: `decide-install-card-state.use-case.spec.ts` (desktop/standalone hidden, androidChromium/iosOther routing), `install-app-card.component.spec.ts` (androidChromium-without-prompt opens Android modal), and manual DOM-text verification of the exact copy strings (see apply-progress notes). Recommend a real-device pass before merge if the team wants full confidence.

## PR

- [ ] 5.1 Single PR, `--base develop` (repo convention). No chaining — estimated ~200 changed lines across ~15 files (several deletions) is well under the 400-line review budget.
