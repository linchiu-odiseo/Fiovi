# Archive Report — Dynamic Tenant Slug + SSO Providers + N-Tenants Selector

**Fecha de archive:** 2026-07-14
**Change:** `2026-07-14-dynamic-slug-and-sso-selector`
**Rama origen:** `feat/dynamic-slug-and-sso-selector`

## Contexto de retro-archive

Change implementado **antes** de escribir su documentación SDD. El proposal, tasks y este report se agregan retrospectivamente sobre los 6 commits ya aplicados y pusheados al remote.

Todo el trabajo compila y pasa validaciones locales:
- `tsc --noEmit -p tsconfig.app.json` — exit 0
- `tsc --noEmit -p tsconfig.spec.json` — exit 0
- `npm test` — 71 files / 1035 tests verdes (21 nuevos)
- `npm run lint` — All files pass linting
- `npm run build` — bundle OK, `select-tenant-page` lazy chunk 2.30 kB

## Commits en la rama

| SHA | Área | Descripción |
|-----|------|-------------|
| `39cf44e` | L1 | Identity gana tenantSlug + puertos y VOs para SSO/selector |
| `0a0c50f` | L2 | Use cases nuevos + slug cache en los existentes |
| `65587da` | L3 | Endpoints globales de auth/SSO + slug dinámico + callback bootstrap |
| `7af951f` | LR | SelectTenantPage nueva + LoginPage con providers SSO dinámicos |
| `f27dc1b` | env/config | Remove TENANT_SLUG del .env pipeline + wire slug cache en DI |
| `f94cd5c` | chore | Prettier normalize (36 archivos de formato pre-existente) |

## Capabilities afectadas

### Added
- **`sso-provider-selection`** (nueva) — página `/login/select-tenant`, view-model, use case y VOs para el flow de selector post-login (password + N tenants) o post-callback SSO (Google + N tenants).

### Modified
- **`auth-login`** — LoginPage fetchea providers SSO dinámicos vía `GET /auth/sso/providers`; submit devuelve `LoginOutcome` union; URLs auth globales sin slug en path.
- **`auth-session`** — Identity gana `tenantSlug` obligatorio; InitializeSession hidrata slug desde storage o desde `?slug=` del callback SSO; refresh path armado con slug del cache.
- **`http-client`** — endpoints auth/sso globales; tenant-scoped reciben slug como parámetro desde `SlugStore` (adapter L3 del port `TenantSlugCache`).

## Delta specs

Este change no genera archivos de delta spec bajo `openspec/changes/2026-07-14-.../specs/` porque el archivo se creó directamente en `archive/`. Las capabilities modificadas quedan documentadas acá; una tarea futura puede sintetizar el spec canónico correspondiente en `openspec/specs/` si el proyecto lo requiere.

## Los 8 casos post-merge

| # | Caso | Estado |
|---|---|---|
| 1 | web-tenant password + 1 tenant | Sin cambios — sigue funcionando |
| 2 | web-tenant password + N tenants | Sin cambios — sigue funcionando |
| 3 | web-tenant Google + 1 tenant | Sin cambios — backend agrega `?slug=` pero web-tenant lo ignora |
| 4 | web-tenant Google + N tenants | **Arreglado** — callback emite `selectionToken` con SSO context |
| 5 | Fiovi password + 1 tenant | **Refactor** — endpoint global, slug del response, sin `.env` |
| 6 | Fiovi password + N tenants | **Nuevo** — SelectTenantPage lee sessionStorage |
| 7 | Fiovi Google + 1 tenant | **Arreglado** — SsoCallbackBootstrap hidrata slug desde `?slug=` |
| 8 | Fiovi Google + N tenants | **Nuevo** — bootstrap procesa `?selectionToken=&tenants=<b64>` |

## Dependencias externas

- **learnex PR `feat/sso-selector-and-pwa-slug`** — DEBE mergear primero. Sin él, casos 4, 7 y 8 no cierran (el backend seguiría rechazando N tenants con `sso_multiple_tenants` y no agregaría `?slug=` al redirect PWA).
- **Google Cloud Console** — dar de alta la redirect URI global `https://api.yangpimpollo.com/auth/sso/google/callback` en el OAuth Client del proyecto (una sola URI cubre los 8 casos porque el backend decide el frontend destino según el param `?app=tenant|pwa` firmado en el state token).
- **Team `.env` local** — quitar `TENANT_SLUG` y `GOOGLE_SSO_ENABLED` (el `build-env.mjs` los ignora silenciosamente, pero es limpio).

## Notas de seguridad

- `?selectionToken` (JWT HS256, TTL 5min) queda visible en la URL post-callback. Mitigado con `history.replaceState` en `SsoCallbackBootstrap` **antes** que el Router se monte — el token no queda en el history del navegador ni en el Referer de requests siguientes.
- `?tenants=<base64>` decodificado con `atob` en try/catch — payload corrupto degrada a mensaje genérico "sesión inválida".
- Slug policy en `ProcessSsoCallbackUseCase`: regex `[a-zA-Z0-9_-]{1,64}` — bloquea `.`, `/`, `\` y otros caracteres que habilitarían path traversal.
- Cookies HttpOnly + path `/t/{slug}` sin cambios respecto al PR #482 — el scoping del browser sigue previniendo cross-tenant leaks.
