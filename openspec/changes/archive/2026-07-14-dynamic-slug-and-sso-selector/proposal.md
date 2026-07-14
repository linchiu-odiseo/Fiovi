# Proposal: Dynamic Tenant Slug + SSO Providers + N-Tenants Selector

> **Retrospective SDD** — implementado en `feat/dynamic-slug-and-sso-selector` (6 commits). Este proposal subsana el flujo — 71 test files / 1035 tests verdes, lint OK, build OK.

## Intent

Sacar el tenant slug del `.env` de build y llevarlo a runtime (viene del `user.slug` del login response del backend post PR #482). Habilitar los 8 casos de login: (password | Google SSO) × (1 tenant | N tenants) × (web-tenant | Fiovi PWA) — con selector propio en Fiovi para el flow N tenants (que hoy no existía) y bootstrap del callback SSO que hidrata slug / procesa selection challenge antes que el Angular Router se monte.

## Scope

### In Scope

- **L1 — dominio**
  - `Identity` gana `tenantSlug` obligatorio (invariante: no vacío).
  - Nuevo port `TenantSlugCache` (adapter en L3): lectura sync del slug activo para adapters que arman URLs `/t/{slug}/...` sin await.
  - VOs nuevos: `SelectionChallenge` (`selectionToken` + TTL + `tenants[]`), `TenantChoice`, `SsoProvider`.
  - Error nuevo: `SelectionInvalidError`.
  - `AuthRepository` port extendido: `login()` retorna union `Identity | SelectionChallenge`; nuevos `selectTenant()` y `listSsoProviders()`.

- **L2 — aplicación**
  - `LoginUseCase.execute` maneja return union — persiste identity + hidrata slug cache solo en la rama `Identity`.
  - Nuevos: `SelectTenantUseCase`, `ListSsoProvidersUseCase`, `ProcessSsoCallbackUseCase` (puro TS, testeable sin browser; parsea `?slug=` / `?selectionToken=&tenants=<b64>` / `?ssoError=`).
  - `InitializeSessionUseCase` refactor: si SlugStore vacío, intenta hidratar desde `IdentityStorage`; si tampoco hay identity previa, devuelve null sin `me()`. Habilita el caso post-callback SSO 1 tenant (bootstrap ya hidrata slug, `me()` puede armar el path).
  - `RefreshIdentity`/`Logout` inyectan `TenantSlugCache` para hidratar/limpiar en su ciclo.

- **L3 — periferia**
  - `api-paths.ts` refactor: endpoints globales (`/auth/login`, `/auth/select-tenant`, `/auth/sso/providers`, `/auth/sso/{provider}/start`) vs tenant-scoped (reciben `slug` como parámetro).
  - `HttpAuthRepository` implementa el nuevo shape del login (union), `selectTenant`, `listSsoProviders`. Códigos de refresh actualizados al set real del backend.
  - `HttpExamsApi` + `HttpTutorExamsApi` inyectan `SlugStore` (`requireSlug()` bloquea con `NetworkError` si no hay identity activa).
  - Nuevo `SlugStore` (@Injectable providedIn root, implements `TenantSlugCache`).
  - Nuevo `SsoCallbackBootstrap` — corre en APP_INITIALIZER antes que `InitializeSession`. Procesa la query string post-callback, hidrata cache o stashea challenge en sessionStorage, hace `history.replaceState` para limpiar la URL antes del render del Router.
  - `LocalStorageIdentityStorage` shape persistido gana `tenantSlug` con validación.

- **LR — render**
  - `LoginPage`: botones SSO dinámicos según `ListSsoProvidersUseCase` (no más `environment.googleSsoEnabled`). URL del botón sale del `apiPath.ssoStart(provider)`. Mapa `SSO_ERROR_MESSAGES` alineado con códigos reales del backend.
  - `LoginViewModel.submit()` maneja `LoginOutcome` — si `SelectionChallenge`, stashea en sessionStorage y navega a `/login/select-tenant`.
  - Nueva `SelectTenantPage` + `SelectTenantViewModel`: misma estética BEM que login (brand "L", header, botones outlined por tenant con chevron_right, "Volver a iniciar sesión" text-button). Guardas: TTL / atob corrupto / sessionStorage vacío → redirect `/login`.
  - Ruta nueva `/login/select-tenant` con `publicOnlyGuard`.

- **config + env**
  - `app.config.ts`: bind `TENANT_SLUG_CACHE` → `SlugStore`; nuevo `provideAppInitializer` para `SsoCallbackBootstrap.run()` ANTES del `InitializeSession`; factories de use cases con `TenantSlugCache`.
  - `build-env.mjs`: `TENANT_SLUG` y `GOOGLE_SSO_ENABLED` fuera de `required` y del environment generado.
  - `.env.example`: limpio, con doc por variable y sección "obsoletas" para quien clone un branch viejo.
  - `CLAUDE.md`: regla #6 reescrita (slug descubierto en runtime, cacheado via port).

### Out of Scope

- Cambios en el backend (learnex) — este change consume el contrato del PR `feat/sso-selector-and-pwa-slug` mergeado en learnex.
- Selector para providers SSO distintos de Google — el flow es genérico, pero hoy solo Google está configurado en el SaaS.
- I18n framework — strings siguen hardcoded es-PE.

## Capabilities

### Added

- **`sso-provider-selection`** (nueva) — página `/login/select-tenant`, view-model, use case y VOs para el flow de selector post-login (password + N tenants) o post-callback SSO (Google + N tenants).

### Modified

- **`auth-login`** — LoginPage ahora fetchea providers SSO dinámicos; submit devuelve `LoginOutcome` union; URLs de auth globales.
- **`auth-session`** — Identity gana `tenantSlug`; InitializeSession hidrata slug desde storage o desde `?slug=` del callback; refresh path armado con slug del cache.
- **`http-client`** — endpoints auth/sso globales; tenant-scoped reciben slug como parámetro desde `SlugStore`.

## Rollout

1. **learnex merge primero** (`feat/sso-selector-and-pwa-slug`): sin ese cambio, casos 4 (web-tenant Google N), 7 (Fiovi Google 1) y 8 (Fiovi Google N) no cierran.
2. **Google Cloud Console**: dar de alta la redirect URI global `https://api.yangpimpollo.com/auth/sso/google/callback` en el OAuth Client del proyecto.
3. **Fiovi merge**: cliente ya consume el contrato nuevo. Cut-over duro — no hay flag ni fallback al slug del `.env`.
4. **Team**: quitar `TENANT_SLUG` y `GOOGLE_SSO_ENABLED` de los `.env` locales (el `build-env.mjs` los ignora silenciosamente, pero es limpio).
