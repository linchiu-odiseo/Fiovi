<h1 align="center">
  <img src="public/img/banner_fiovi.svg" alt="lugia" />
</h1>

PWA Angular mobile-first: **cartilla virtual de marcaciones para simulacros** (exámenes de práctica). El alumno marca alternativas A–E por pregunta en pantalla; el enunciado viene impreso en una hoja física. Backend: **learnex** (NestJS + Postgres, multi-tenant) con auth por cookies HttpOnly.

**Estado actual (2026-06-20): Fase 3 completa, sin change activo.** Login + cartilla offline-capable + submit + draft auto-save + PWA auto-update, todo contra learnex. Cobertura de tests verde. Último change archivado: `2026-06-19-draft-auto-save`.

---

## Antes de tocar código

Leé [`CONTRIBUTING.md`](CONTRIBUTING.md). Define las 4 reglas obligatorias del repo:

1. **SDD obligatorio** — 8 fases (Explore → Propose → Spec → Design → Tasks → Apply → Verify → Archive). Sin spec no hay código.
2. **Gate de PR** — `ls openspec/changes/` debe mostrar solo `archive/` antes de abrir el PR.
3. **Arquitectura hexagonal estricta** — L1/L2 puros, boundaries no se cruzan.
4. **`hexagonal-guard` bloqueante** — corre en `sdd-verify`, sin OK no se archiva.

---

## Quickstart (dev local)

```bash
# 1. Clonar e instalar
git clone <repo-url>
cd Fiovi
npm install

# 2. Configurar variables (ver tabla más abajo)
cp .env.example .env
# Editar .env con los valores de tu backend learnex local

# 3. Levantar learnex (en otra terminal, fuera de este repo)
#    learnex corre en http://localhost:2001 con Docker. Ver instrucciones del repo learnex.

# 4. Arrancar el dev server
npm run dev
# Abre http://localhost:4200/login
```

## Comandos

| Comando                | Qué hace                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `npm run dev`          | Dev server en `http://localhost:4200` (preflight: build-env)                         |
| `npm test`             | Vitest sobre `tests/`                                                                |
| `npm run lint`         | ESLint flat config sobre `src/` y `tests/`                                           |
| `npm run format`       | Prettier write                                                                       |
| `npm run format:check` | Prettier check (CI-friendly)                                                         |
| `npm run build`        | Bundle producción en `dist/` (preflight: build-env, postflight: inject-ngsw-appdata) |
| `npm run build-env`    | Regenera `src/environments/` desde `.env`                                            |

## Estructura

```
src/
├── L1_domain/         dominio puro (entidades, value-objects, ports, errores)
├── L2_application/    use cases puros
├── L3_periphery/      adapters Angular (HTTP, storage, interceptors, guards)
├── LR_render/         UI: pages, components, view-models con Signals
├── environments/      generado por scripts/build-env.mjs (NO editar a mano)
├── app.config.ts, main.ts, index.html, styles.scss
tests/
├── unit/              L1 + L2 (Vitest puro)
└── feature/           L3 + LR (Vitest + jsdom + TestBed)
agents/                docs leídos por subagentes Claude Code
.claude/agents/        definiciones de subagentes (frontend-builder, hexagonal-guard, test-engineer)
openspec/              specs y changes (SDD workflow)
scripts/
├── build-env.mjs              genera src/environments/{environment.ts,environment.development.ts} desde .env
└── inject-ngsw-appdata.mjs    muta dist/.../ngsw.json post-build con APP_VERSION (para SwUpdate)
Dockerfile, nginx.conf, compose.yml    stack de runtime (ver "Deploy")
```

## Arquitectura

Hexagonal estricta en 4 capas. Las reglas de import están enforzadas por ESLint (`import-x/no-restricted-paths` + `no-restricted-imports`) y auditadas por el subagente `hexagonal-guard`. Detalle: [`agents/architecture-rules.md`](agents/architecture-rules.md).

## Stack

- **Angular 22+** standalone components, Signals, Reactive Forms.
- **TypeScript** estricto.
- **Vitest** vía `@angular/build:unit-test` (jsdom para L3+LR).
- **ESLint** flat config + **Prettier**.
- **PWA** con `@angular/service-worker` (`ngsw-config.json` + `appData.version` inyectada post-build).
- **IndexedDB** para marcaciones offline y cola de envíos (`fake-indexeddb` en tests).
- **Auth**: cookies HttpOnly + `withCredentials: true` vía un único interceptor (`src/L3_periphery/interceptors/credentials.interceptor.ts`). Refresh reactivo con lock `shareReplay(1)`.

## Variables de entorno

Todas las variables las consume `scripts/build-env.mjs` y termina en `src/environments/environment.ts`. Si falta alguna requerida, el hook `predev`/`prebuild` falla con mensaje claro.

| Variable        | Requerida | Origen         | Ejemplo dev             | Notas                                                                                                                                                                    |
| --------------- | --------- | -------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `API_BASE_URL`  | sí        | `.env`         | `http://localhost:2001` | URL del backend learnex. En prod tiene que ser **HTTPS** (cookies HttpOnly + `SameSite=None` lo exigen).                                                                 |
| `DRAFT_ENABLED` | no        | `.env`         | `true`                  | Si `false` o ausente, el dispatcher de draft auto-save usa la implementación `Noop` (no llama al backend).                                                               |
| `DEV_TOOLS`     | no        | `.env`         | `true`                  | Habilita atajos de UI de desarrollo (botón dado, cartilla prueba). Dejar `false` en release.                                                                             |
| `version`       | sí        | `package.json` | `1.2.1`                 | SemVer humana. Se inyecta en `environment.appVersion` y en `ngsw.json` post-build; dispara el modal "hay versión nueva". **Bumpear con `npm version patch\|minor\|major`.** |

`.env` está en `.gitignore`. Documentación viva de las variables en `.env.example`.

> **Sobre la versión.** No vive en `.env` porque no es config por entorno: es la versión del bundle, la misma en local y en prod. Vive en `package.json.version` para que producción no tenga que tocar `.env` en cada release — sólo desplegar el `dist/` que ya trae la versión horneada.

---

## Deploy

El repo ya está dockerizado. Producción corre como un único container nginx con los assets compilados.

| Archivo         | Rol                                                                                                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Dockerfile`    | Multi-stage. Etapa 1 (`node:22-alpine`): `npm ci` + `npm run build`. Etapa 2 (`nginx:alpine`): copia `dist/fiovi/browser` y `nginx.conf`. Sin Node en la imagen final. |
| `nginx.conf`    | SPA fallback (`try_files`), gzip, cache `immutable` 1y para assets hasheados, `no-cache` para `index.html`, `ngsw.json`, `ngsw-worker.js`.                             |
| `compose.yml`   | Servicio `fiovi` expuesto en **puerto 3006:80**, `restart: unless-stopped`.                                                                                            |
| `.dockerignore` | Excluye `node_modules`, `tests/`, `docs/`, `openspec/`, etc. **Conserva `.env`** porque `build-env.mjs` lo necesita dentro del build.                                  |

### Deploy manual (válido para staging o como referencia)

```bash
git clone <repo-url> fiovi
cd fiovi
cp .env.example .env
# Editar .env con los valores REALES de prod (ver tabla "Variables de entorno")
docker compose up -d --build
# PWA disponible en http://<server>:3006
```

### Prerequisitos del entorno de producción

Pase lo que pase con la pipeline, el server productivo necesita:

- **HTTPS** delante del container. El `compose.yml` solo expone HTTP en `3006`. Hace falta un reverse proxy con TLS (Traefik, Caddy, nginx anfitrión, Cloudflare). Sin HTTPS las cookies HttpOnly con `SameSite=None` no funcionan.
- **CORS en learnex** configurado con el dominio público de la PWA y `Access-Control-Allow-Credentials: true`. Sin esto el login falla con error de CORS.
- **DNS** apuntando al server.
- **`package.json.version` bumpeada** en cada release (con `npm version patch|minor|major`). Si no se bumpea, el modal de "hay actualización" no se dispara en clientes con la PWA cacheada.

### CI/CD — pendiente de definir

> El deploy productivo va a correr por **GitHub Actions**. La pipeline todavía no está montada y **no existe `.github/workflows/`** en este repo. Las decisiones que tiene que tomar el responsable de DevOps antes de escribir el workflow:

- **Arquitectura del pipeline**:
  - ¿Actions construye la imagen y la publica a un registry (GHCR, Docker Hub, ECR), y el server hace `docker compose pull && up -d`?
  - ¿O Actions se conecta por SSH al server y corre `docker compose up -d --build` allá?
  - ¿O hay un agente tipo Watchtower/ArgoCD/Portainer que detecta el push al registry y reinicia solo?
- **Trigger del deploy a prod**:
  - ¿Push a `main`?
  - ¿Tag SemVer (`v*.*.*`) — casa naturalmente con `package.json.version` (que `npm version` etiqueta automáticamente) y el modal de update PWA?
  - ¿`workflow_dispatch` manual?
  - ¿Hay ambiente staging intermedio?
- **Manejo de secrets** (`API_BASE_URL`, `DRAFT_ENABLED`, `DEV_TOOLS`, `PUBLIC_CAPTCHA_SITE_KEY`):
  - ¿GitHub Secrets inyectados como build args o escritos al `.env` antes de `docker build`?
  - ¿`.env` gestionado en el server por DevOps, fuera del repo, montado al compose?
- **Registry de imágenes** (si se elige el camino registry): nombre del repo, política de tags (`:latest`, `:<sha>`, `:<semver>`), retención.

Cuando esas decisiones existan, completar esta sección y agregar el workflow real bajo `.github/workflows/`. Hasta entonces, **deploy productivo sigue el camino manual de arriba**.

---

## Documentación interna

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — **reglas obligatorias** para cualquier colaborador (SDD, arquitectura, subagentes, gate de PR).
- [`CLAUDE.md`](CLAUDE.md) — guía técnica para sesiones de Claude Code.
- [`agents/api-contract.md`](agents/api-contract.md) — contrato vigente con learnex (endpoints, headers, mapeo HTTP → errores de dominio).
- [`agents/architecture-rules.md`](agents/architecture-rules.md) — reglas hexagonales + antipatrones + checklist de PR.
- [`agents/coding-style.md`](agents/coding-style.md) — naming, comentarios, convención de commits.
- [`agents/domain-glossary.md`](agents/domain-glossary.md) — vocabulario de producto y arquitectura.
- [`openspec/changes/archive/`](openspec/changes/archive/) — historial completo de changes archivados.
- [`openspec/specs/`](openspec/specs/) — main specs vigentes (resultado del merge tras cada `sdd-archive`).

## Workflow

Spec-Driven Development con OpenSpec. Las **8 fases obligatorias** y el detalle del workflow viven en [`CONTRIBUTING.md`](CONTRIBUTING.md#regla-1--todo-cambio-pasa-por-sdd-openspec-sin-excepción).

Pipeline resumido:

```
Explore (opc.) → Propose → Spec → Design → Tasks → Apply → Verify → Archive
   sdd-explore   sdd-propose sdd-spec sdd-design sdd-tasks sdd-apply sdd-verify sdd-archive
```

Cada change vive en `openspec/changes/<name>/` y al archivarse se mueve a `openspec/changes/archive/<YYYY-MM-DD>-<name>/`, con merge de delta specs en `openspec/specs/`.
