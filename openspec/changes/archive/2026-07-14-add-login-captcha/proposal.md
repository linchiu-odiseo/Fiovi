# Proposal: Add login captcha (Cloudflare Turnstile invisible)

> **Retrospective SDD** — implementado en `feat/add-login-captcha` (6 commits: L1 · L2 · L3 · LR · env/config · tests). Este proposal subsana el flujo — 73 test files / 1057 tests verdes, lint OK, build OK, hexagonal-guard aprobado.

## Intent

Preparar Fiovi para el captcha anti-bot que learnex ya mergeó en `POST /auth/login` (PR #517). El backend acepta el campo `captchaToken` como opcional mientras `CAPTCHA_SECRET` esté vacío en producción — cuando ops lo prenda, Fiovi debe enviar tokens válidos de Cloudflare Turnstile o todos los logins responderán 401. Este cambio deja el cliente listo sin cambiar UX en dev (site key vacía → widget deshabilitado → login funciona como antes).

## Scope

### In Scope

- **L1 — dominio**
  - Nuevo port `CaptchaProvider` con contrato `isEnabled()`, `render(container, callbacks)`, `reset(widgetId)`. Contenedor tipado como `unknown` para mantener L1 sin DOM types.
  - `AuthRepository.login()` amplía shape a `{email, password, captchaToken?: string}`.

- **L2 — aplicación**
  - `LoginUseCase.execute()` acepta `captchaToken?` y lo propaga al port. Cero lógica extra.

- **L3 — periferia**
  - Nuevo adapter `CloudflareTurnstileProvider` (implementa `CaptchaProvider`): carga el SDK de Cloudflare bajo demanda desde `challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`, renderiza en modo `invisible`, expone `reset()` para reintentos.
  - `HttpAuthRepository.login()` construye el body explícito; incluye `captchaToken` solo cuando viene con valor (no viaja como `null`).
  - Nuevo tipado global `turnstile.d.ts` con el subset del SDK que consumimos.
  - Nuevo token DI `CAPTCHA_PROVIDER` en `L3_periphery/tokens.ts`.

- **LR — render**
  - Nuevo `CaptchaWidgetComponent` (LR/components): wrapper Angular sobre el port; renderiza en `AfterViewInit` cuando enabled, emite `tokenChange` con `string|null`.
  - `LoginPage`: signal `captchaToken`, snapshot `captchaEnabled` al montar, suma `<app-captcha-widget>` al template, deshabilita el submit hasta tener token (cuando captcha activo), llama `reset()` tras cualquier outcome distinto de éxito.
  - `LoginViewModel.submit()` acepta `captchaToken?` y lo pasa al use case.

- **config + env**
  - `app.config.ts`: binding `CAPTCHA_PROVIDER` → `CloudflareTurnstileProvider`.
  - `scripts/build-env.mjs`: lee `CAPTCHA_PROVIDER` y `PUBLIC_CAPTCHA_SITE_KEY` opcionales; los inyecta en `environment{,.production}.ts`.
  - `src/index.html`: CSP amplía `script-src` y `frame-src` con `https://challenges.cloudflare.com`.
  - `.env.example`: (pendiente — bloqueado por permisos del harness) sumar las dos vars con doc.

### Out of Scope

- Cambios en el backend learnex (PR #517 ya mergeado en su rama).
- Diferenciar mensajes de error para "captcha falló" vs "credenciales inválidas": el backend responde el mismo 401 `TENANT_AUTH_INVALID_CREDENTIALS` por política anti-bot deliberada (si un bot pudiera distinguir, sabría que el bot detection lo flageó).
- Captcha para el flow SSO Google: Google ya tiene su propia protección; el endpoint SSO no exige captcha.
- Captcha para `POST /auth/refresh`: es endpoint post-auth con cookies, no público.

## Capabilities

### Modified

- **`auth-login`** — `AuthRepository.login()` acepta `captchaToken?`; `HttpAuthRepository` lo incluye en el body cuando viene; LoginPage bloquea el submit hasta tener token (cuando captcha activo).

### Added

- **`captcha-widget`** (implícita, sin spec formal) — port `CaptchaProvider`, adapter `CloudflareTurnstileProvider`, componente `CaptchaWidgetComponent`, token DI `CAPTCHA_PROVIDER`, env vars `CAPTCHA_PROVIDER` + `PUBLIC_CAPTCHA_SITE_KEY`, CSP para `challenges.cloudflare.com`.

## Rollout

1. **Fiovi merge y deploy a prod** (este cambio) — con `PUBLIC_CAPTCHA_SITE_KEY` seteada en `.env` de prod (site key real de Cloudflare, se comparte con web-tenant por dominio `yangpimpollo.com`).
2. **Coordinar con ops de learnex**: cuando el prod de Fiovi ya está corriendo con captcha, ops setea `CAPTCHA_SECRET` + las demás vars de captcha en el `.env` del backend. A partir de ese momento el server valida tokens y rechaza requests sin captcha válido.
3. **Dev/local**: sin cambios de comportamiento — `.env` sin `PUBLIC_CAPTCHA_SITE_KEY` (o con la test key `3x00000000000000000000FF` que siempre pasa) deja el login funcionando como antes.
