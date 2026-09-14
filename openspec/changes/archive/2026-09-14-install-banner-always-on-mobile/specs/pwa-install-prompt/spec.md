# pwa-install-prompt Specification

## Purpose

Defines when Fiovi offers itself for installation (the "Instala Fiovi como app" card in `/home`) and which install flow the student sees per platform. Visibility depends only on device form factor and execution context (installed standalone vs. browser tab) — never on installation history. This is a new capability: no prior spec in `openspec/specs/` covers the install card.

## Requirements

### Requirement: Card hidden on desktop and non-mobile form factors

The system SHALL hide the install card whenever `InstallEnvironmentProbe.isMobileFormFactor()` returns `false`, independent of `getPlatform()`.

#### Scenario: Desktop platform

- **GIVEN** `getPlatform()` returns `'desktop'`
- **WHEN** `DecideInstallCardStateUseCase.execute()` runs
- **THEN** the result is `{ kind: 'hidden' }`

#### Scenario: Unknown platform

- **GIVEN** `getPlatform()` returns `'unknown'`
- **WHEN** `execute()` runs
- **THEN** the result is `{ kind: 'hidden' }`

#### Scenario: Mobile platform reported but form factor is not mobile

- **GIVEN** `getPlatform()` returns `'androidChromium'`
- **AND** `isMobileFormFactor()` returns `false`
- **WHEN** `execute()` runs
- **THEN** the result is `{ kind: 'hidden' }`

### Requirement: Card hidden when running standalone

The system SHALL hide the install card whenever `isStandalone()` returns `true` — the student is already inside the installed app.

#### Scenario: iOS standalone via `navigator.standalone`

- **GIVEN** `isStandalone()` returns `true` (iOS reports `navigator.standalone`)
- **WHEN** `execute()` runs
- **THEN** the result is `{ kind: 'hidden' }`

#### Scenario: Android standalone via `display-mode`

- **GIVEN** `isStandalone()` returns `true` (`display-mode: standalone` matches)
- **WHEN** `execute()` runs
- **THEN** the result is `{ kind: 'hidden' }`

### Requirement: Card is always visible on mobile browsers, with no persisted override

When `isStandalone()` is `false` AND `isMobileFormFactor()` is `true`, the system MUST show the card for every value of `getPlatform()` except `'desktop'`/`'unknown'` (already covered as unreachable in this branch). No flag, dismissal, cooldown, or persisted "already installed" state MAY hide the card under this condition. This supersedes the previous behavior where the `fiovi.install_prompt.installed` flag (via `InstallPromptStore`) hid the card forever after `appinstalled` fired once.

#### Scenario: Student who already installed reopens Fiovi in a mobile browser

- **GIVEN** the student installed Fiovi previously (fired `appinstalled` in the past)
- **AND** the student now opens Fiovi in a mobile browser tab (not standalone)
- **WHEN** `execute()` runs
- **THEN** the card is visible (result `kind` is not `'hidden'`)

#### Scenario: No installation-history port exists

- **GIVEN** `isStandalone()` is `false` and `isMobileFormFactor()` is `true`
- **WHEN** `execute()` runs
- **THEN** the outcome depends only on `getPlatform()` and `NativeInstallPrompt.isAvailable()`
- **AND** no port equivalent to `InstallPromptStore` (or any persisted "installed" flag) SHALL exist in the codebase

### Requirement: `androidChromium` resolves to native prompt or manual instructions, never hidden

The system SHALL resolve `'androidChromium'` to `{ kind: 'nativePrompt' }` when `NativeInstallPrompt.isAvailable()` returns `true`. When it returns `false`, the system SHALL resolve to `{ kind: 'androidInstructions' }` — the card stays visible and tappable, opening a modal with manual instructions. It MUST NOT resolve to `hidden` in this branch.

#### Scenario: `beforeinstallprompt` already captured

- **GIVEN** `getPlatform()` returns `'androidChromium'`
- **AND** `native.isAvailable()` returns `true`
- **WHEN** `execute()` runs
- **THEN** the result is `{ kind: 'nativePrompt' }`
- **AND** tapping the card triggers the browser's native install dialog

#### Scenario: `beforeinstallprompt` not yet captured

- **GIVEN** `getPlatform()` returns `'androidChromium'`
- **AND** `native.isAvailable()` returns `false`
- **WHEN** `execute()` runs
- **THEN** the result is `{ kind: 'androidInstructions' }`
- **AND** tapping the card opens the manual-instructions modal

### Requirement: `androidOther` and `webview` keep the webview fallback

The system SHALL resolve `'androidOther'` (e.g. Firefox Android) and `'webview'` (in-app browsers like WhatsApp/Instagram/Gmail) to `{ kind: 'webviewFallback' }`, unchanged from current behavior.

#### Scenario: Firefox Android

- **GIVEN** `getPlatform()` returns `'androidOther'`
- **WHEN** `execute()` runs
- **THEN** the result is `{ kind: 'webviewFallback' }`

#### Scenario: In-app webview

- **GIVEN** `getPlatform()` returns `'webview'`
- **WHEN** `execute()` runs
- **THEN** the result is `{ kind: 'webviewFallback' }`

### Requirement: `iosSafari` and `iosOther` both resolve to the same iOS instructions

The system SHALL resolve both `'iosSafari'` and `'iosOther'` to `{ kind: 'iosInstructions' }`. The `iosOtherBrowser` kind and its dedicated modal case are removed: since iOS 17, Chrome/Edge/Firefox on iPhone install from their own Share button, so redirecting the student to Safari is no longer correct.

#### Scenario: iOS Safari

- **GIVEN** `getPlatform()` returns `'iosSafari'`
- **WHEN** `execute()` runs
- **THEN** the result is `{ kind: 'iosInstructions' }`

#### Scenario: iOS Chrome/Edge/Firefox

- **GIVEN** `getPlatform()` returns `'iosOther'`
- **WHEN** `execute()` runs
- **THEN** the result is `{ kind: 'iosInstructions' }`
- **AND** the modal shown is the same one used for `iosSafari`

### Requirement: iOS instructions modal copy is browser-location-agnostic and current

The `iosInstructions` modal's Share step MUST read exactly "Toca el botón Compartir," without a location qualifier, because the Share button sits at the bottom only in Safari and at the top in Chrome/Edge on iPhone. The modal MUST NOT include the hint "Asegúrate de tener Fiovi abierta en Safari — otros navegadores del iPhone no permiten instalar," which is false since iOS 17.

#### Scenario: Share step has no location claim

- **GIVEN** the `iosInstructions` modal is rendered
- **WHEN** the DOM is inspected
- **THEN** the Share step text is exactly "Toca el botón Compartir"
- **AND** it does not contain "en la barra de abajo"

#### Scenario: Safari-only hint is absent

- **GIVEN** the `iosInstructions` modal is rendered
- **WHEN** the DOM is inspected
- **THEN** it does not contain the string "otros navegadores del iPhone no permiten instalar"

### Requirement: Android manual instructions cover the already-installed case

The `androidInstructions` modal MUST present steps to open Chrome's menu and tap "Instalar aplicación." Step 2 MUST read exactly: "Toca **Instalar aplicación**. Si en su lugar dice **Abrir aplicación**, ya la tienes instalada — tócalo y listo." This exists because Chrome's menu shows "Abrir aplicación" instead of "Instalar aplicación" once the PWA is already installed on that device.

#### Scenario: Step 2 covers both menu labels

- **GIVEN** the `androidInstructions` modal is rendered
- **WHEN** the DOM is inspected
- **THEN** step 2 text is exactly "Toca **Instalar aplicación**. Si en su lugar dice **Abrir aplicación**, ya la tienes instalada — tócalo y listo."

### Requirement: Every instructions modal closes with an already-installed hint

Both `iosInstructions` and `androidInstructions` modals MUST end with the line "Si ya la instalaste, ábrela desde el ícono en tu pantalla de inicio." This exists because rule 3 makes the card always visible on mobile browsers, including to students who already installed.

#### Scenario: iOS modal shows the closing line

- **GIVEN** the `iosInstructions` modal is rendered
- **WHEN** the DOM is inspected
- **THEN** it contains "Si ya la instalaste, ábrela desde el ícono en tu pantalla de inicio."

#### Scenario: Android modal shows the closing line

- **GIVEN** the `androidInstructions` modal is rendered
- **WHEN** the DOM is inspected
- **THEN** it contains "Si ya la instalaste, ábrela desde el ícono en tu pantalla de inicio."
