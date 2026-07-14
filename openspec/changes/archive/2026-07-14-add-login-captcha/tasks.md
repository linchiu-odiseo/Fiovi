# Tasks: Add login captcha (Cloudflare Turnstile invisible)

> **Retrospective SDD** — todos los tasks reflejan trabajo ya aplicado en la rama `feat/add-login-captcha`. Marcados `[x]` al momento de escribir este documento (2026-07-14). Commits: `64a58d5` (L1) · `40c74e4` (L2) · `e1aee2e` (L3) · `6f28ea2` (LR) · `19eac6d` (env/config) · `ae47d22` (tests).

## Phase 1: L1 domain

- [x] T1.1 Nuevo port `CaptchaProvider` con contrato `isEnabled()/render()/reset()`. Tipos `CaptchaWidgetId`, `CaptchaContainer` (opaco), `CaptchaCallbacks`. (`src/L1_domain/ports/captcha-provider.ts`)
- [x] T1.2 `AuthRepository.login()` amplía shape a `{email, password, captchaToken?: string}`. Doc del port aclara política anti-bot del back (mismo 401 para captcha falso vs password falso). (`src/L1_domain/ports/auth-repository.ts`)

## Phase 2: L2 application

- [x] T2.1 `LoginUseCase.execute()` acepta `captchaToken?` y lo propaga al `authRepo.login()`. Cero lógica extra. (`src/L2_application/use-cases/login.use-case.ts`)

## Phase 3: L3 periphery

- [x] T3.1 `HttpAuthRepository.login()` construye body explícito; incluye `captchaToken` solo cuando viene con valor (evita `null` en el body que el zod del back rechazaría). (`src/L3_periphery/http/http-auth-repository.ts`)
- [x] T3.2 Nuevo adapter `CloudflareTurnstileProvider` (implements `CaptchaProvider`): script loader idempotente (una sola vez por sesión), render con `size:'invisible'`, mapeo de callbacks Turnstile → callbacks del port, `reset()` no-op si el script no cargó. (`src/L3_periphery/captcha/cloudflare-turnstile-provider.ts`)
- [x] T3.3 Tipado global `turnstile.d.ts` con subset del SDK usado (`render`/`reset` + params). `export {}` para forzar módulo. (`src/L3_periphery/captcha/turnstile.d.ts`)
- [x] T3.4 Nuevo token DI `CAPTCHA_PROVIDER`. (`src/L3_periphery/tokens.ts`)

## Phase 4: LR render

- [x] T4.1 Nuevo `CaptchaWidgetComponent`: consume `CAPTCHA_PROVIDER` vía DI; renderiza en `AfterViewInit` si enabled; emite `tokenChange(string|null)`; `reset()` público para el padre. Template inline con `<div #container>`. (`src/LR_render/components/captcha-widget/captcha-widget.component.ts`)
- [x] T4.2 `LoginPage`: signal `captchaToken`, snapshot `captchaEnabled` al montar, `<app-captcha-widget>` en template cuando enabled, `[disabled]` del botón incluye `captchaEnabled && !captchaToken()`, dispatch de `reset()` tras outcome distinto de `'ok'`/`'selection'`. (`src/LR_render/pages/login/login.page.ts`, `login.page.html`)
- [x] T4.3 `LoginViewModel.submit()` acepta `captchaToken?` y lo pasa al `LoginUseCase`. (`src/LR_render/view-models/login.view-model.ts`)

## Phase 5: Config + env

- [x] T5.1 `app.config.ts`: binding `CAPTCHA_PROVIDER` → `CloudflareTurnstileProvider`. (`src/app.config.ts`)
- [x] T5.2 `scripts/build-env.mjs`: lee `CAPTCHA_PROVIDER` y `CAPTCHA_SITE_KEY` opcionales; los escribe en `environment{,.production}.ts` (default vacíos). (`scripts/build-env.mjs`)
- [x] T5.3 `src/index.html`: CSP amplía `script-src` y `frame-src` con `https://challenges.cloudflare.com`. (`src/index.html`)
- [ ] T5.4 `.env.example`: sumar `CAPTCHA_PROVIDER` y `CAPTCHA_SITE_KEY` con doc. **Pendiente** — bloqueado por permisos del harness, requiere edición manual del maintainer.

## Phase 6: Tests

- [x] T6.1 Actualizar fixture `auth-repository.fake`: shape de `loginCalls` gana `captchaToken?`. (`tests/unit/fixtures/auth-repository.fake.ts`)
- [x] T6.2 `login.use-case.spec` (unit): 2 casos nuevos — propaga captchaToken cuando viene, omite cuando undefined. (`tests/unit/L2_application/use-cases/login.use-case.spec.ts`)
- [x] T6.3 `http-auth-repository.spec` (feature): 2 casos nuevos — body incluye captchaToken cuando viene, no lo incluye cuando input es undefined. (`tests/feature/L3_periphery/http/http-auth-repository.spec.ts`)
- [x] T6.4 `cloudflare-turnstile-provider.spec` (feature, nuevo): 11 casos — `isEnabled()` (3), `render()` (4), `reset()` (2), script loader (2). Mockea `window.turnstile` + muta `environment` en runtime (no `vi.mock`, incompatible con Angular unit-test). (`tests/feature/L3_periphery/captcha/cloudflare-turnstile-provider.spec.ts`)
- [x] T6.5 `captcha-widget.spec` (feature, nuevo): 7 casos — skip render cuando disabled, propagación tokenChange (onToken/onExpired/onError), `reset()` delega al port + emite null. (`tests/feature/LR_render/components/captcha-widget.spec.ts`)
- [x] T6.6 `login.page.spec`: sumar `DisabledCaptchaProvider` a los tres `configureTestingModule` para no romper los 27 tests existentes. (`tests/feature/LR_render/pages/login/login.page.spec.ts`)

## Phase 7: Verificación

- [x] T7.1 `npm test` → 73 test files / 1057 tests verdes.
- [x] T7.2 `npm run lint` → All files pass linting.
- [x] T7.3 `tsc --noEmit -p tsconfig.app.json` → exit 0.
- [x] T7.4 `tsc --noEmit -p tsconfig.spec.json` → exit 0.
- [x] T7.5 `npm run build` → bundle OK; warnings pre-existentes de SCSS budget (no del captcha).
- [x] T7.6 Subagente `hexagonal-guard` → **APROBADO**, cero violaciones ni smells.

## Phase 8: Retrospective archive

- [x] T8.1 `proposal.md` + `tasks.md` + `archive-report.md` bajo `openspec/changes/archive/2026-07-14-add-login-captcha/`.
