# Fiovi — guía para Claude Code

> Esta nota la lee Claude Code al arrancar en este repo. Resume el proyecto, el stack y las reglas para que cualquier sesión (humana o agente) pueda colaborar sin pedir contexto desde cero.
>
> **⚠️ Antes de tocar código, leé [`CONTRIBUTING.md`](./CONTRIBUTING.md).** Define las 3 reglas obligatorias del repo: workflow SDD/OpenSpec, respeto a la arquitectura hexagonal, y uso obligatorio de los 3 subagentes (`hexagonal-guard` es bloqueante antes de archivar). Aplican a todo colaborador, humano o IA.

## Qué es esto

**Fiovi** es una PWA Angular para móviles que sirve como **cartilla virtual de marcaciones** para simulacros (exámenes de práctica). El alumno marca las alternativas A–E por pregunta en pantalla; el enunciado viene impreso en una hoja física que entrega el profesor. Backend: **learnex** (NestJS + Postgres, multi-tenant) en Docker. Auth via cookies HttpOnly + `withCredentials: true`.

**Estado actual (2026-09-08): audit-log Fases 0 y 1 archivadas. Sin change activo.**

Changes archivados a la fecha (en `openspec/changes/archive/`). **La lista de abajo está incompleta** — se quedó en julio mientras el archivo siguió creciendo; para el inventario real, mirar el directorio:

- `2026-06-11-add-auth-login` — Fase 1: login funcional + redirect a `/home` protegido por guard.
- `2026-06-12-cartilla-fase-2` — Fase 2: cartilla completa con grilla A–E offline-first, queue IDB, server-time-sync (sobre API-FAKE). 400/400 tests.
- `2026-06-14-restyle-native-excellence` — refactor de estilos UI a tokens.
- `2026-06-14-fase-3-login-learnex` — Fase 3 login: cut-over duro de API-FAKE a learnex (cookies HttpOnly + `withCredentials: true`). Refresh reactivo con lock `shareReplay(1)`.
- `2026-06-16-fase-3-exam-list-learnex` — Fase 3 exam list migrado a learnex.
- `2026-06-17-pwa-auto-update` — PWA auto-update con `SwUpdate.versionUpdates` y `appData.version` inyectada post-build.
- `2026-06-17-fase-3-exam-submit-learnex` — Fase 3 submit de marcaciones contra learnex (cierra la migración API-FAKE → learnex).
- `2026-06-19-draft-auto-save` — auto-save de borrador (`submit-progress-snapshot`).
- `2026-07-08-add-admission-area` — VO AdmissionArea + picker UI + integración con envío/draft.
- …(8 changes de julio y agosto sin listar acá: SSO, captcha de login, slug dinámico, restyle tutor, `programar-apertura`, etc.)
- `2026-09-08-add-audit-log-local-capture` — audit-log Fase 0 (captura local en IDB + descarga NDJSON) y Fase 1 (subida a learnex en paquetes sellados con gzip y dedup por `batchId`). Capacidad nueva `audit-log-capture` en `openspec/specs/`. Par backend: learnex#1089 y #1110.

**Próximos changes candidatos:** dashboard tutor real (aulas, activación de examen), resultados post-envío, historial del alumno, anti-fraude hardening. Antes de empezar cualquiera: ver workflow SDD en [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Stack

- Angular **22+** standalone components, Signals, Reactive Forms (sin NgModules, sin Karma, sin async pipe para estado del view-model).
- TypeScript estricto.
- Vitest vía `@angular/build:unit-test`.
- ESLint flat config + Prettier.
- Hexagonal estricta en 4 capas: `L1_domain`, `L2_application`, `L3_periphery`, `LR_render`.
- PWA mobile-lite: manifest + `@angular/service-worker` (shell cacheado en producción).
- IndexedDB para marcaciones y cola de envíos offline (`fake-indexeddb` en tests).

## Estructura del repo

```
Fiovi/
├── src/
│   ├── L1_domain/          dominio puro (entidades, value-objects, ports, errores)
│   ├── L2_application/     use cases puros
│   ├── L3_periphery/       adapters Angular (HTTP, storage, interceptors, guards)
│   ├── LR_render/          UI Angular (pages, components, view-models con Signals)
│   ├── environments/       generado por scripts/build-env.mjs (NO editar a mano)
│   ├── app.config.ts       wiring DI raíz
│   ├── main.ts, index.html, styles.scss
├── tests/
│   ├── unit/               L1 + L2 (Vitest puro, sin Angular)
│   └── feature/            L3 + LR (Vitest + jsdom + TestBed)
├── agents/                 docs READ BY subagentes (ver abajo)
├── docs/                   guías humanas (follow-ups, decisiones de Fase 2)
├── tools/-mcp/             MCP servers / dev tooling
├── scripts/                build-env.mjs
├── openspec/               specs y cambios (SDD workflow)
├── .claude/agents/         definiciones de subagentes (frontend-builder, etc.)
├── eslint.config.js, angular.json, tsconfig*.json
├── .env.example            variables documentadas (committed)
└── .env                    valores reales locales (ignorado)
```

## Comandos comunes

```bash
npm run dev            # arranca dev server en http://localhost:4200 (preflight: build-env)
npm test               # corre Vitest (single shot, watch mode con ng test directo)
npm run lint           # ng lint sobre src/ y tests/
npm run format         # Prettier write
npm run format:check   # Prettier check (CI)
npm run build          # bundle producción (preflight: build-env)
npm run build-env      # genera src/environments/ desde .env (manual; se invoca por hooks)
```

## Reglas inviolables

> Las **3 reglas de colaboración** (SDD obligatorio, respeto a arquitectura/estilos, uso de los 3 subagentes con `hexagonal-guard` bloqueante) viven en [`CONTRIBUTING.md`](./CONTRIBUTING.md). Esta sección lista los detalles técnicos que aplican adentro de la regla #2.

1. **Boundaries hexagonales.** Ver `@agents/architecture-rules.md` para la tabla completa. ESLint enforza los imports cruzados; el subagente `hexagonal-guard` audita lo que ESLint no atrapa (anémicas, mappers ceremoniales, use cases passthrough).
2. **L1 y L2 son TypeScript puro.** Cero `@angular/*`, cero `rxjs`, cero browser APIs.
3. **Clasificación de errores HTTP por `(status, endpoint, code)` — nunca por texto del `message`.** El `code` se lee SOLO si está declarado en el zod del contrato learnex (ej. `TENANT_AUTH_INVALID_CREDENTIALS`, `TENANT_AUTH_REFRESH_TOKEN_INVALID`, `TENANT_AUTH_REFRESH_TOKEN_MISSING`). El `message` es texto humano volátil y queda PROHIBIDO. Detalle en `@agents/api-contract.md`.
4. **Cookies HttpOnly + `withCredentials: true` vía un único interceptor** en `src/L3_periphery/interceptors/credentials.interceptor.ts`. El interceptor agrega `withCredentials` a toda request a `apiBaseUrl` y maneja refresh reactivo en 401 con lock `shareReplay(1)`. Cero `Authorization: Bearer`, cero `X-API-Key`, cero `X-New-Bearer` (todo eso era API-FAKE).
5. **Strings de UI en español (es-PE), hardcoded en Fase 1+. I18n diferida. Código en inglés.**
6. **Tenant slug descubierto en runtime, jamás hardcoded ni en `.env`.** El slug (`vonex`, `pitagoras`, ...) viaja en `user.slug` del response de `POST /auth/login` o `POST /auth/select-tenant` (o en `?slug=` del callback SSO). Se persiste como parte de la `Identity` (`identity.tenantSlug`) y se cachea sync via el port `TenantSlugCache` (adapter: `SlugStore` en `src/L3_periphery/http/slug-store.ts`) para que los helpers de URL puedan armar `/t/{slug}/...` sin `await`. Todas las URLs tenant-scoped pasan por `src/L3_periphery/http/api-paths.ts` recibiendo el slug como parámetro. Cualquier mención literal de `"vonex"` en `src/` está prohibida.

## Referencias para subagentes

- `@agents/api-contract.md` — endpoints, headers, mapeo HTTP→errores de dominio.
- `@agents/architecture-rules.md` — reglas de import por capa, antipatrones, checklist de PR.
- `@agents/coding-style.md` — naming, organización, comentarios, convención de commits quirúrgicos.
- `@agents/domain-glossary.md` — vocabulario de producto y de arquitectura.

## Subagentes definidos

- **`frontend-builder`** — implementa LR_render (componentes, view-models, routing). Usa cuando hay que crear/modificar UI Angular.
- **`hexagonal-guard`** — auditor read-only de boundaries. Usa antes de cerrar un cambio o periódicamente sobre `src/`.
- **`test-engineer`** — escribe tests Vitest. Usa después de implementar una entidad/use case/componente.

Definiciones completas en `.claude/agents/`.

## Workflow de cambios (SDD)

Este proyecto usa **OpenSpec / Spec-Driven Development** con 8 fases obligatorias. Detalle completo (qué archivo produce cada una, cuándo es opcional, reglas de no saltar) en [`CONTRIBUTING.md`](./CONTRIBUTING.md#regla-1--todo-cambio-pasa-por-sdd-openspec-sin-excepción).

Resumen rápido del pipeline:

```
Explore (opc.) → Propose → Spec → Design → Tasks → Apply → Verify → Archive
   sdd-explore   sdd-propose sdd-spec sdd-design sdd-tasks sdd-apply sdd-verify sdd-archive
```

Cada fase tiene su skill (`sdd-<fase>`). Un change vive en `openspec/changes/<name>/` con `proposal.md`, `design.md`, `specs/<cap>/spec.md`, `tasks.md`. Al archivar, se mueve a `openspec/changes/archive/<YYYY-MM-DD>-<name>/` y los delta specs se mergean en `openspec/specs/`.

**Gate bloqueante:** durante `sdd-verify` corre el subagente `hexagonal-guard`. Si reporta violaciones duras, el change NO se puede archivar. Ver [`CONTRIBUTING.md`](./CONTRIBUTING.md#regla-3--usar-los-3-subagentes-del-proyecto-hexagonal-guard-es-bloqueante).

Hoy no hay change activo (último archivado: `2026-09-08-add-audit-log-local-capture`).

## Información del entorno dev

- **learnex** (back real) corre en Docker en `http://localhost:2001`. Multi-tenant: el slug viaja en el path `/t/{slug}/...`. Slug actual de dev: `vonex` (definido en `.env`).
- **API-FAKE retirado** (cambio `fase-3-login-learnex`). Si encontrás referencias a `localhost:2004/v3`, `API_KEY`, `X-API-Key`, `Authorization: Bearer`, `X-New-Bearer`, son legacy y deben migrarse.
- **Credenciales de dev**: pedírselas al equipo. No van acá — este archivo se commitea, y las que había quedaron obsoletas sin que nadie se enterara hasta que fallaron en pleno debug.
- **`.env`** tiene solo `API_BASE_URL` como requerido (más flags opcionales: `DRAFT_ENABLED`, `DEV_TOOLS`, `CAPTCHA_PROVIDER`, `PUBLIC_CAPTCHA_SITE_KEY`). Si falta el requerido, el dev server falla en el hook `predev` con mensaje claro. `TENANT_SLUG` quedó deprecado — el slug se descubre en runtime post-login (ver regla #6). `APP_VERSION` salió de `.env` y ahora vive en `package.json.version`: bumpear con `npm version patch|minor|major`.
- **Plataforma de dev**: Windows + PowerShell. Comandos POSIX vía Bash tool funcionan; usar `/` en paths.
