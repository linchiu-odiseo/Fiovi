# Reglas de arquitectura — Fiovi

> Hexagonal estricta sobre 4 capas. Las reglas se enforzan mecánicamente con ESLint (`import-x/no-restricted-paths` + `no-restricted-imports`) y se auditan periódicamente con el subagente `hexagonal-guard`. Romperlas no es un bug menor — es deuda arquitectónica que paga compuesto.

## Las 4 capas

```
src/
├── L1_domain/         ← TypeScript puro. CERO Angular, CERO HTTP, CERO browser.
├── L2_application/    ← Casos de uso. CERO Angular, CERO HTTP, CERO browser.
├── L3_periphery/      ← Adapters Angular: HTTP, storage, interceptors, guards.
└── LR_render/         ← UI: pages, components, view-models con Signals.
```

## Reglas de dependencia

| Capa | PUEDE importar de        | NO PUEDE importar de                                |
| ---- | ------------------------ | --------------------------------------------------- |
| L1   | nada interno             | L2, L3, LR, `@angular/*`, `rxjs`, browser APIs      |
| L2   | L1                       | L3, LR, `@angular/*`, `rxjs`                        |
| L3   | L1, L2, Angular          | LR                                                  |
| LR   | L1, L2, **guards de L3** | adapters HTTP/storage de L3 (DI vía InjectionToken) |

> **¿Por qué LR no importa L3?** Para que LR no conozca la implementación concreta de los puertos. En Fase 2 cambiará `HttpAuthRepository` por una versión híbrida con IndexedDB sin tocar UI. Si LR importa L3 directo, esa migración rompe LR.

## Qué SÍ vive en cada capa

### L1 — Dominio

- **Entidades** con comportamiento real (no anémicas). Ej: `Session.isExpired(now)`, `Session.principal()`.
- **Value-objects** con validación en constructor. Ej: `BearerToken` rechaza string vacío.
- **Puertos** (interfaces) que describen capacidades sin implementarlas. Ej: `AuthRepository`, `SessionStorage`.
- **Errores tipados** que el dominio sabe nombrar. Ej: `InvalidCredentialsError`, `NetworkError`.

### L2 — Aplicación

- **Use cases** que orquestan puertos para cumplir una acción. Reciben los puertos por constructor.
- Si un use case es un one-line passthrough (`return repo.foo()`), **no escribas el use case** — que el caller use el puerto directo. Solo agrega valor si orquesta ≥2 cosas o aplica reglas.

### L3 — Periferia

- **Adapters** que implementan puertos L1: `HttpAuthRepository`, `LocalStorageSessionStorage`.
- **Interceptors** HTTP: `authHeadersInterceptor` (inyecta `X-API-Key` y `Authorization`).
- **Guards** funcionales: `authGuard`, `publicOnlyGuard`.
- **Provider tokens** + factorías para wiring DI.

### LR — Render

- **Pages standalone**: `LoginPage`, `HomePage`.
- **View-models** con Signals: `LoginViewModel`. Estado expuesto como `Signal<T>`.
- **Templates** que leen signals directo (`viewModel.isSubmitting()`), nunca `| async`.
- **Routing**: `app.routes.ts` con guards de L3 (referenciados, no importados directo desde componentes).

## Antipatrones prohibidos

### ❌ Entidades anémicas

Una entidad sin comportamiento es un DTO con nombre fancy. Si `Session` solo tiene `bearerToken`, `userEmail` e `issuedAt` como public fields y nada más, es anémica.

```ts
// ❌ MAL — anémica
export class Session {
  constructor(
    public readonly bearerToken: BearerToken,
    public readonly userEmail: string,
    public readonly issuedAt: Date,
  ) {}
}

// ✅ BIEN — comportamiento real
export class Session {
  constructor(
    public readonly bearerToken: BearerToken,
    public readonly userEmail: string,
    public readonly issuedAt: Date,
  ) {
    if (!userEmail.includes('@')) throw new InvalidSessionError('email malformado');
  }

  isExpired(now: Date): boolean {
    /* política real */
  }
  principal(): string {
    return this.userEmail;
  }
}
```

### ❌ Mappers ceremoniales

Si el DTO HTTP y la entidad tienen la misma forma, NO escribas `LoginResponseMapper.toSession()`. Construye `Session` directo desde el body.

```ts
// ❌ MAL — mapper innecesario
const dto = LoginResponseMapper.fromHttp(body);
const session = SessionMapper.fromDto(dto);

// ✅ BIEN — directo
const session = new Session(new BearerToken(body.token), body.user.email, new Date());
```

Mappers SOLO si hay traducción real: nombres distintos, tipos distintos, validación que no cabe en el constructor.

### ❌ Use cases passthrough

```ts
// ❌ MAL — no aporta nada
class LogoutUseCase {
  constructor(private repo: AuthRepository) {}
  execute() {
    return this.repo.logout();
  }
}

// ✅ BIEN — si hay orquestación
class LogoutUseCase {
  constructor(
    private repo: AuthRepository,
    private storage: SessionStorage,
  ) {}
  async execute() {
    try {
      await this.repo.logout();
    } catch {
      /* best-effort */
    }
    await this.storage.clear();
  }
}
```

### ❌ Browser APIs en L1/L2

`localStorage`, `sessionStorage`, `window`, `document`, `navigator`, `fetch`, `XMLHttpRequest` — todo eso vive en L3. Si L1/L2 lo necesita, hay un puerto faltante.

### ❌ `any` para evadir tipos

Si el compilador se queja, casi siempre la queja es legítima. `any` esconde bugs; tipos explícitos los exponen.

### ❌ `@if (viewModel.isSubmitting$ | async)` en templates

Los view-models exponen Signals, no Observables. El template lee `viewModel.isSubmitting()` (signal como función) o `@if (viewModel.isSubmitting())`. Conversiones desde RxJS (ej: `valueChanges` de Reactive Forms) usan `toSignal()` en el view-model, no en el template.

## Reglas de testing

- L1 + L2: tests rápidos en `tests/unit/` con Vitest puro (sin Angular). Mocks de puertos = clases simples que implementan la interface.
- L3 + LR: tests en `tests/feature/` con `@angular/build:unit-test` (jsdom, Vitest). `HttpTestingController` para L3 HTTP; `TestBed` para LR componentes.
- Cobertura objetivo: L1 ≥ 90%, L2 ≥ 80%, LR ≥ 60%.
- **NUNCA** matchear sobre strings de error HTTP del backend — clasificar por `(status, endpoint)`. Ver `agents/api-contract.md`.

## Tech debt aceptado

### Inyección de `appData.version` en `ngsw.json` post-build (change `pwa-auto-update`)

`scripts/build-env.mjs` muta `dist/**/browser/ngsw.json` post-`ng build` para inyectar `appData: { version: APP_VERSION }`. Esto permite que `SwUpdate.versionUpdates` exponga la versión SemVer humana al cliente (modal de actualización).

**¿Por qué workaround?** `ngsw-config.json` no soporta variables de entorno. La alternativa "oficial" sería hardcodear `appData` en `ngsw-config.json`, pero eso obliga a editar dos archivos en cada release (`.env` + `ngsw-config.json`), y el segundo termina olvidado.

**Riesgo:** si Angular cambia el shape de `ngsw.json` en una versión mayor, el script falla en build. Mitigación: el servicio `PwaUpdateService` tiene fallback (`VERSION_FALLBACK = '—'`) si `appData.version` falta, así que el cliente no se rompe en producción aunque el script tenga un bug.

**Cuándo retirarlo:** cuando Angular ofrezca lectura nativa de envs en `ngsw-config.json`, o cuando montemos CI/CD con un step de bump automático que reemplace este mecanismo manual.

## Checklist antes de un PR

- [ ] `npm run lint` pasa limpio (0 errores, 0 warnings).
- [ ] `npm test` pasa con cobertura ≥ objetivos.
- [ ] Ningún archivo en `src/L1_domain/` o `src/L2_application/` importa `@angular/*` o `rxjs`.
- [ ] Ningún archivo en `src/LR_render/` importa de `src/L3_periphery/`.
- [ ] Ninguna entidad nueva es anémica (tiene al menos un método con lógica).
- [ ] Ningún mapper traduce DTO ↔ entidad con la misma forma.
- [ ] Tests no matchean strings de mensajes HTTP del backend.
