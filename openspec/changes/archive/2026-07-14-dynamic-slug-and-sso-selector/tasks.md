# Tasks: Dynamic Tenant Slug + SSO Providers + N-Tenants Selector

> **Retrospective SDD** — todos los tasks reflejan trabajo ya aplicado en la rama `feat/dynamic-slug-and-sso-selector`. Marcados `[x]` al momento de escribir este documento (2026-07-14). Commits: `39cf44e` (L1) · `0a0c50f` (L2) · `65587da` (L3) · `7af951f` (LR) · `f27dc1b` (env/config) · `f94cd5c` (chore/format).

## Phase 1: L1 domain

- [x] T1.1 `Identity` gana `tenantSlug` obligatorio + invariante no vacío. (`src/L1_domain/entities/identity.ts`)
- [x] T1.2 Nuevo port `TenantSlugCache` con contrato `current()/set()/clear()`. (`src/L1_domain/ports/tenant-slug-cache.ts`)
- [x] T1.3 VOs nuevos: `TenantChoice`, `SelectionChallenge`, `SsoProvider`. (`src/L1_domain/value-objects/`)
- [x] T1.4 Error nuevo: `SelectionInvalidError`. (`src/L1_domain/errors/selection-invalid.error.ts`)
- [x] T1.5 `AuthRepository` port extendido con `selectTenant()`, `listSsoProviders()`; `login()` retorna `Identity | SelectionChallenge`. (`src/L1_domain/ports/auth-repository.ts`)

## Phase 2: L2 application

- [x] T2.1 `LoginUseCase` maneja union outcome; persiste identity + hidrata slug cache solo en rama Identity. (`src/L2_application/use-cases/login.use-case.ts`)
- [x] T2.2 Nuevo `SelectTenantUseCase`: persiste identity + hidrata slug + fire profile. (`src/L2_application/use-cases/select-tenant.use-case.ts`)
- [x] T2.3 Nuevo `ListSsoProvidersUseCase` (thin wrapper del port). (`src/L2_application/use-cases/list-sso-providers.use-case.ts`)
- [x] T2.4 Nuevo `ProcessSsoCallbackUseCase` puro TS: parsea `?slug=` / `?selectionToken=&tenants=<b64>` / `?ssoError=` → outcome union. Sanea slugs (defensa path-traversal). (`src/L2_application/use-cases/process-sso-callback.use-case.ts`)
- [x] T2.5 `InitializeSessionUseCase` refactor: hidrata slug desde SlugStore o desde IdentityStorage antes de llamar `me()`; si ninguno, devuelve null. (`src/L2_application/use-cases/initialize-session.use-case.ts`)
- [x] T2.6 `RefreshIdentityUseCase` inyecta `TenantSlugCache` para hidratar post-refresh. (`src/L2_application/use-cases/refresh-identity.use-case.ts`)
- [x] T2.7 `LogoutUseCase` inyecta `TenantSlugCache` para limpiar post-clear. (`src/L2_application/use-cases/logout.use-case.ts`)

## Phase 3: L3 periphery

- [x] T3.1 `api-paths.ts` refactor: endpoints globales sin slug; tenant-scoped con `slug` como parámetro. (`src/L3_periphery/http/api-paths.ts`)
- [x] T3.2 `HttpAuthRepository`: `login()` retorna union, nuevos `selectTenant`/`listSsoProviders`, `requireSlug()` para tenant-scoped, códigos de refresh actualizados al set real. (`src/L3_periphery/http/http-auth-repository.ts`)
- [x] T3.3 `HttpExamsApi` inyecta `SlugStore`, `requireSlug()` bloquea con NetworkError. (`src/L3_periphery/http/http-exams-api.ts`)
- [x] T3.4 `HttpTutorExamsApi` idem T3.3. (`src/L3_periphery/http/http-tutor-exams-api.ts`)
- [x] T3.5 Nuevo `SlugStore` (implements `TenantSlugCache`, Signal interno). (`src/L3_periphery/http/slug-store.ts`)
- [x] T3.6 Nuevo `SsoCallbackBootstrap`: corre en APP_INITIALIZER, procesa search string, `history.replaceState` antes del Router. (`src/L3_periphery/http/sso-callback-bootstrap.ts`)
- [x] T3.7 `LocalStorageIdentityStorage`: shape persistido gana `tenantSlug` con validación defensiva. (`src/L3_periphery/storage/local-storage-identity-storage.ts`)

## Phase 4: LR render

- [x] T4.1 `LoginPage` — botones SSO dinámicos vía `ListSsoProvidersUseCase`; URL desde `apiPath.ssoStart()`; `SSO_ERROR_MESSAGES` alineado con backend real. (`src/LR_render/pages/login/login.page.{ts,html}`)
- [x] T4.2 `LoginViewModel` — maneja `LoginOutcome`; si `SelectionChallenge`, stashea en sessionStorage y navega a `/login/select-tenant`. Signal `ssoProviders`. (`src/LR_render/view-models/login.view-model.ts`)
- [x] T4.3 Nueva `SelectTenantPage` — misma estética BEM que login; renderiza lista de tenants con chevron_right; loading por-tenant. (`src/LR_render/pages/login/select-tenant/*`)
- [x] T4.4 Nuevo `SelectTenantViewModel` — hidrata desde sessionStorage; guardas TTL/atob/vacío → redirect `/login`. (`src/LR_render/view-models/select-tenant.view-model.ts`)
- [x] T4.5 Ruta `/login/select-tenant` con `publicOnlyGuard`. (`src/LR_render/app.routes.ts`)

## Phase 5: config + env

- [x] T5.1 `app.config.ts` — bind `TENANT_SLUG_CACHE → SlugStore`, providers de `SelectTenantUseCase`/`ListSsoProvidersUseCase`, factories con `TenantSlugCache`, `provideAppInitializer` de `SsoCallbackBootstrap.run()` antes del `InitializeSession`. (`src/app.config.ts`)
- [x] T5.2 `build-env.mjs` — `TENANT_SLUG` y `GOOGLE_SSO_ENABLED` fuera de `required` y del environment generado. (`scripts/build-env.mjs`)
- [x] T5.3 `.env.example` — limpio con doc por variable y sección "obsoletas" para branches viejos.
- [x] T5.4 `CLAUDE.md` — regla #6 reescrita (slug runtime + `TenantSlugCache`); sección "Info entorno dev" actualizada.

## Phase 6: verificación

- [x] T6.1 `npx tsc --noEmit -p tsconfig.app.json` exit 0.
- [x] T6.2 `npx tsc --noEmit -p tsconfig.spec.json` exit 0.
- [x] T6.3 `npm test` — 71 files / 1035 tests verdes (21 nuevos: `process-sso-callback` × 15, `select-tenant.use-case` × 4, `identity` × 2, más selection cases en `http-auth-repository`, `login.use-case`, `login.page`, `initialize-session`).
- [x] T6.4 `npm run lint` — "All files pass linting".
- [x] T6.5 `npm run build` — bundle OK, `select-tenant-page` como lazy chunk 2.30 kB.
- [x] T6.6 `npm run format` — aplicado.
