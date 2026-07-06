# Estilo de código — Fiovi

> Las reglas mecánicas las enforza ESLint + Prettier (corre `npm run lint` y `npm run format:check`). Este documento captura las decisiones de estilo que las herramientas no atrapan: naming, organización, comentarios, commits.

## Naming

| Tipo                          | Convención                                                | Ejemplo                                  |
| ----------------------------- | --------------------------------------------------------- | ---------------------------------------- |
| Clases / Interfaces / Tipos   | `PascalCase`                                              | `Session`, `AuthRepository`              |
| Métodos / Funciones / Vars    | `camelCase`                                               | `isExpired`, `bearerToken`               |
| Constantes module-level       | `SCREAMING_SNAKE_CASE`                                    | `STORAGE_KEY`, `API_TIMEOUT_MS`          |
| Archivos                      | `kebab-case`                                              | `http-auth-repository.ts`                |
| Componentes Angular (clase)   | `PascalCase` sin sufijo                                   | `LoginPage`, `App` (no `LoginComponent`) |
| Componentes Angular (archivo) | `kebab-case` sin sufijo `.component` (Angular 22 default) | `login.page.ts`, `app.ts`                |
| Carpetas                      | `kebab-case` o `snake_case` para layers                   | `L1_domain/`, `value-objects/`           |

**Sufijos por rol** (file naming):

- `*.page.ts` — pages standalone routeables (`login.page.ts`)
- `*.view-model.ts` — view-models con Signals (`login.view-model.ts`)
- `*.use-case.ts` — use cases L2 (`login.use-case.ts`)
- `*.spec.ts` — tests
- Sin sufijo para entidades/value-objects/ports en L1: el nombre dice todo (`session.ts`, `bearer-token.ts`, `auth-repository.ts`)

## Organización dentro de cada capa

```
L1_domain/
├── entities/           session.ts
├── value-objects/      bearer-token.ts
├── ports/              auth-repository.ts, session-storage.ts
└── errors/             invalid-credentials.error.ts, network.error.ts

L2_application/
└── use-cases/          login.use-case.ts, logout.use-case.ts

L3_periphery/
├── http/               http-auth-repository.ts
├── storage/            local-storage-session-storage.ts
├── interceptors/       auth-headers.interceptor.ts
└── guards/             auth.guard.ts, public-only.guard.ts

LR_render/
├── pages/login/        login.page.ts, login.page.html, login.page.scss
├── pages/home/         home.page.ts, home.page.html, home.page.scss
├── view-models/        login.view-model.ts
└── app.routes.ts, app.ts, app.html, app.scss
```

Una clase / interface por archivo. Si dos cosas siempre se usan juntas y no tienen sentido por separado, **considera** ponerlas en el mismo archivo (rara vez vale la pena).

## Idioma

- **Código** (identificadores, tipos): **inglés**. `userEmail`, no `correoUsuario`.
- **Strings visibles al usuario**: **español (es-PE)**. Hardcoded en templates en Fase 1; i18n diferida.
- **Comentarios y commit messages**: **español**. El equipo trabaja en español.
- **Documentación técnica** (este archivo, agentes, READMEs): **español**.
- **Logs y errores no visibles al usuario**: **inglés** (más fácil googlear).

## Comentarios

**Default: no escribas comentarios.** Si removiéndolo el código no se vuelve confuso, no agrega valor.

Cuándo SÍ vale un comentario:

- **WHY no obvio:** una constraint oculta, un workaround específico, una decisión arquitectónica contraintuitiva.
- **Invariante sutil:** algo que el siguiente lector violaría sin querer.
- **Referencia a discusión externa:** link a issue o decisión documentada en `openspec/changes/`.

NUNCA:

- Explicar QUÉ hace el código (los nombres lo dicen).
- "Used by X" / "Added for Y flow" — eso vive en el commit / PR / issue.
- Docstrings de varios párrafos en métodos pequeños.

## TypeScript

- `strict: true` activo. No deshabilitar.
- Cero `any`. Si el compilador se queja, fix the type, don't escape.
- `readonly` por defecto en campos de entidades y value-objects.
- Tipos explícitos en parámetros públicos; inferencia OK en locales.
- `null` (no `undefined`) para "ausencia esperada de valor" (ej: `read(): Session | null`).

## Commits quirúrgicos

Un commit = un concern. Una entidad L1, o un use case L2, o un componente LR + su test. Tests y código del mismo concern viajan juntos.

### Formato

```
<type>(<layer>): <subject ≤72 chars>

<cuerpo: por qué del cambio, scope, decisiones no obvias>

Refs: openspec/changes/<change-name> (task <n>)
```

- `<type>` ∈ `feat | fix | refactor | docs | test | chore | build`
- `<layer>` ∈ `L1 | L2 | L3 | LR | infra | docs`
- Subject en imperativo, presente, sin punto final. Español o inglés (consistencia en el repo cuenta más que el idioma elegido — actualmente español).
- Cuerpo separado del subject por línea en blanco. Líneas ≤100 chars.
- `Refs:` apunta al cambio OpenSpec y el número de tarea.

### Ejemplos

```
feat(L1): añade entity Session con isExpired y principal

Session encapsula el ciclo de vida de la autenticación. Construye con
validación (bearer no vacío, email parseable). isExpired() acepta now
para que los tests no dependan del reloj real.

Refs: openspec/changes/add-auth-login (task 4.2)
```

```
test(L2): cubre LoginUseCase para credenciales inválidas y network error

Dobles de AuthRepository y SessionStorage como clases simples (no jest
mocks) — patrón L1/L2 puro. Verifica que credenciales inválidas no
limpian la sesión previa.

Refs: openspec/changes/add-auth-login (task 5.4)
```

```
chore(infra): script build-env.mjs y hooks predev/prebuild

mjs (no .ts) para evitar añadir transpilador por 70 líneas. Lee .env,
valida API_BASE_URL y API_KEY, genera environment{,.production}.ts.

Refs: openspec/changes/add-auth-login (task 2.8)
```

### Anti-patterns en commits

- ❌ Commit "WIP" o "trabajo en progreso". Los commits son revisables uno por uno.
- ❌ Commit que toca 4 capas y 2 features. Divide.
- ❌ Subject "fix" sin contexto. Di qué fixea.
- ❌ Cuerpo que repite el subject. El cuerpo es para el porqué, no para reformular el qué.
