# Glosario de dominio — Fiovi

> Vocabulario compartido por código, tests y conversaciones del equipo.
> Si un término no está acá, no es de dominio: probablemente es de framework, infraestructura o convención de código (ver `architecture-rules.md` / `coding-style.md`).

## Términos del producto

**Cartilla (de marcaciones)** — Hoja de respuestas virtual. El producto. En Fase 1 es un placeholder; en Fase 2 se vuelve una grilla interactiva donde el alumno marca alternativas A–E por pregunta.

**Simulacro** — Examen de práctica organizado por la academia. La cartilla se asocia a un simulacro. Tiene cantidad fija de preguntas (5, 10 o 20 — configurable). Tiene una ventana de tiempo definida por el profesor.

**Alternativa** — Una de las 5 opciones de respuesta (A, B, C, D, E) por pregunta, o `null` (desmarcado). Value-object L1 con factory `Alternativa.fromString(raw)` y `Alternativa.desmarcada()`. La cartilla NO muestra el enunciado de la pregunta; ese viene impreso en la hoja física que el profesor entrega.

**Marcación (Marcacion)** — Entidad L1 `(simulacroId, pregunta, alternativa)`. Acto del alumno de seleccionar una alternativa. Es reversible (puede cambiar, puede desmarcar) hasta el envío. Se almacena en `MarkingsStorage` scopeado por `userEmail` en IndexedDB.

**Envío** — Acto de mandar las marcaciones al backend. Único e idempotente. Una cartilla enviada no puede modificarse (backend devuelve 409 en intentos repetidos, que el cliente trata como éxito).

**Estado del simulacro (EstadoSimulacro)** — Value-object L1 con 4 valores: `pendiente | abierto | enviado | cerrado`. Derivado por backend en cada GET (no almacenado como columna). El cliente NO lo recomputa.

**Tiempo de término (clientSubmittedAt)** — Timestamp del momento en que el alumno terminó el simulacro (apretó Enviar o llegó T=0). Lo aporta el cliente y se confía. Backend valida que caiga en `[inicio, fin]`.

**Tiempo de envío (serverReceivedAt)** — Timestamp del momento en que el backend recibió el POST. Auditoría. NO afecta el estado del examen.

**Server time (ServerTime)** — Value-object L1 con timestamp ISO8601. Cada GET `/simulacros` retorna `serverTime` que el cliente ancla al `Clock` para todos los countdowns y bloqueos de entrada (evita ataque "cambiar hora del celular").

**Auto-envío T=0** — Envío automático silencioso programado para `simulacro.fin` con jitter ±3s. `clientSubmittedAt` SIEMPRE = `simulacro.fin` exacto, independiente de cuándo dispare el timer.

**Cola de envíos pendientes** — Si el POST falla por `NetworkError`, el envío queda en `MarkingsStorage` con su `clientSubmittedAt` original. El `EnvioRetryDispatcher` global despacha la cola al arrancar la app y en cada transición a online del puerto `Connectivity`.

## Términos de identidad y sesión (Fase 3 — learnex)

**Usuario** — Persona autenticada contra learnex. Tiene **exactamente 1 rol**: `student` o `tutor` (admin/teacher pendientes — ver `UnsupportedRoleError`).

**Identity** — Entidad de dominio (L1) que representa la identidad autenticada activa. Contiene `id, tenantId, email, codigo, roles[], permissions[], expiresAt`. **Invariante single-role**: el constructor lanza `InvalidIdentityError` si `roles.length !== 1`. Métodos: `role()`, `isExpired(now)`, `shouldRefresh(now, threshold)`, `hasPermission(perm)`. Persistida en `localStorage` bajo la clave `fiovi.identity`.

**Cookies HttpOnly** — `learnex_tenant_access` (TTL 15 min) y `learnex_tenant_refresh` (TTL 7 días). Seteadas por el back en login/refresh; invisibles al JS (`HttpOnly`). El browser las envía/recibe automáticamente con `withCredentials: true`. **Reemplazan completamente el modelo Bearer + X-API-Key de Fase 1+2.**

**Tenant slug** — Identificador del cliente multi-tenant de learnex (`vonex` para Vonex). Viaja en el path: `/t/{slug}/...`. Build-time: viene de la env var `TENANT_SLUG` y se inyecta en `environment.tenantSlug`. Una build = un tenant. **Prohibido hardcodear `"vonex"` en `src/`.**

**Profile** — Datos personales del usuario por rol. `StudentProfile { id, code, firstName, lastName, area }` o `TutorProfile { id, code, firstName, lastName, email, classrooms[] }`. Trae de `/t/{slug}/{student|tutor}/me`. Cacheado en IndexedDB con TTL 24h.

**Code** — Propiedad de `Profile`. Para alumno: el **DNI** (ej. `"79507732"`). Para tutor: el **código interno** del tutor (ej. `"T001"`). La UI muestra ambos bajo la misma etiqueta "DNI / Código".

**Permission** — String estructurado `<scope>:<resource>:<action>` (ej. `"student:dashboard:view"`). Vienen en `Identity.permissions[]`. `Identity.hasPermission(perm)` para chequeo en UI/guards.

### Términos obsoletos (Fase 1+2, retirados en Fase 3)

- ~~**Sesión (Session)**~~ — Reemplazada por **`Identity`**.
- ~~**Bearer token (BearerToken)**~~ — Token no existe del lado cliente (cookies HttpOnly invisibles).
- ~~**API key (X-API-Key)**~~ — Eliminada. learnex usa cookies + tenant slug en path.
- ~~**Principal**~~ — Equivalente: `Identity.email`.
- ~~`X-New-Bearer` rolling~~ — Reemplazado por refresh reactivo explícito via `POST /auth/refresh`.

## Términos arquitectónicos (resumen — detalle en `architecture-rules.md`)

**L1 — Dominio** (`src/L1_domain/`) — TypeScript puro: entidades con comportamiento, value-objects, puertos (interfaces), errores tipados. Cero imports de Angular, RxJS, browser.

**L2 — Aplicación** (`src/L2_application/`) — Casos de uso. Orquestan el dominio. TypeScript puro. Importan solo L1.

**L3 — Periferia** (`src/L3_periphery/`) — Adaptadores: implementaciones HTTP, storage, guards, interceptors. Implementan puertos L1. Pueden importar Angular.

**LR — Render** (`src/LR_render/`) — UI Angular: pages, components, view-models con Signals. Importan L1+L2. NUNCA importan L3 directamente — la inyección viene por provider tokens en `src/app.config.ts`.

**Puerto (Port)** — Interface declarada en L1 que describe una capacidad sin comprometerse con una implementación. Ej: `AuthRepository`, `SessionStorage`. Permite que Fase 2 reemplace la implementación HTTP por una híbrida (HTTP + IndexedDB) sin tocar L1/L2.

**Adapter** — Implementación concreta de un puerto, vive en L3. Ej: `HttpAuthRepository`, `LocalStorageSessionStorage`.

**Use case** — Función o clase en L2 que orquesta uno o más puertos para cumplir una acción del producto. Ej: `LoginUseCase`, `LogoutUseCase`, `GetActiveSessionUseCase`.

**View-model** — Objeto en LR que expone estado reactivo (Angular Signals) a una página o componente. Aísla el template del cableado contra use cases. Ej: `LoginViewModel`.

## Puertos nuevos en Fase 2

**`Clock`** — Puerto L1 server-anchored. `now()` devuelve la hora actual ajustada por `offset = serverTime - clientTime` capturado en el último GET. `setServerTime(ServerTime)` actualiza el offset. Adapter L3: `ServerAnchoredClock`.

**`Connectivity`** — Puerto L1 reactivo. `current(): boolean` da el snapshot, `subscribe(listener): unsubscribe` notifica transiciones. Adapter L3: `BrowserConnectivity` con `navigator.onLine` + eventos `online`/`offline`.

**`MarkingsStorage`** — Puerto L1 para persistencia local de marcaciones y cola de envíos. El adapter L3 (`IndexedDbMarkingsStorage`) inyecta el port `IdentityStorage` (Fase 3) para derivar el `userEmail` — los métodos del puerto NO lo reciben. Wipe automático en logout vía `wipeUserScope()` (sin argumento).

**`SimulacrosApi`** — Puerto L1 para el backend de simulacros. `obtenerDelDia()` y `enviar(req)`. Adapter L3: `HttpSimulacrosApi`. **Nota Fase 3**: la cartilla queda rota en runtime hasta `fase-3-exam-learnex` migre estos endpoints.

## Puertos nuevos en Fase 3 (learnex)

**`IdentityStorage`** — Puerto L1 para persistencia local de la `Identity`. `read() / write(identity) / clear()`. Adapter L3: `LocalStorageIdentityStorage` (key `fiovi.identity`). DI via `InjectionToken IDENTITY_STORAGE` en `src/L3_periphery/tokens.ts`.

**`ProfileStorage`** — Puerto L1 para cache de `Profile` por rol. `read(role) / write(role, profile) / clear()`. Devuelve `CachedProfile {profile, cachedAt}`. La política de TTL la decide el use case (`GetProfileUseCase` con TTL 24h), no el storage. Adapter L3: `IndexedDbProfileStorage` (DB `fiovi-profile`, store `profile`).

**`OutboxStoragePort`** — Puerto L1 para la cola de envíos pendientes (extracción del adapter Markings). Solo expone `clear()` (usado en logout). El mismo `IndexedDbMarkingsStorage` implementa ambos ports (`useExisting` binding).

**`RouterPort`** — Puerto L1 para navegación abstracta sin importar `@angular/router` desde L2. `navigate(commands: unknown[]): void`. Adapter L3: factory inline en `app.config.ts` que envuelve el `Router` de Angular.

**`SwMessengerPort`** — Puerto L1 opcional para notificar al Service Worker (ej. `LOGOUT` en logout para invalidar caches). `post(message): void`.

**`AuthRepository`** (evolucionado en Fase 3) — `login(creds) / me() / refresh() / logout() / getProfile(role)`. Adapter L3: `HttpAuthRepository`. Todas las requests con `withCredentials: true`. URLs vía helper `apiPath` (interpola `tenantSlug` desde environment).

## Errores de dominio

**`InvalidCredentialsError`** — Login rechazado por credenciales incorrectas (HTTP 401 en `POST /auth/login`, con o sin `code: TENANT_AUTH_INVALID_CREDENTIALS`). UI: "Credenciales inválidas".

**`NetworkError`** — Falla de transporte o respuesta 5xx. UI: "No se pudo conectar al servidor. Inténtalo de nuevo."

**`SessionExpiredError`** — Endpoint protegido (no `/auth/*`) respondió 401 mid-operación. El `credentialsInterceptor` intenta refresh; si falla → propaga este error. Se distingue de `InvalidCredentialsError` (solo aplica a login).

### Errores nuevos en Fase 3 (learnex)

**`InvalidIdentityError`** — Invariante single-role roto en el constructor de `Identity` (`roles.length !== 1`). Lanzado defensivamente. No mostrado al usuario.

**`RefreshFailedError`** — `POST /auth/refresh` respondió 401 (con `code: TENANT_AUTH_REFRESH_TOKEN_INVALID` o `_MISSING`). El interceptor invoca `LogoutUseCase` y redirige a `/login`. Sin reintentos.

**`RateLimitError`** — `POST /auth/login` respondió 429 (5 intentos/min por IP). UI: "Demasiados intentos, esperá un minuto.".

**`ProfileNotAvailableError`** — `GET /{role}/me` respondió 403 (sin permission del rol) o 404 (TenantUser sin fila en `students`/`tutors`). UI alumno: header degradado con solo email + mensaje "Perfil no disponible".

**`UnsupportedRoleError`** — El back devolvió una identity con rol fuera del set soportado por el cliente (hoy `{student, tutor}`). Expone `role: string` con el valor recibido. Validado en `HttpAuthRepository.mapIdentity` ANTES de construir `Identity`. UI login: "Esta aplicación está disponible solo para alumnos y tutores. Contactá a tu administrador." Obsoleto cuando el producto agregue `admin`/`teacher`.

### Errores obsoletos (Fase 1+2, retirados en Fase 3)

- ~~**`InvalidSessionError`**~~ — Reemplazado por `InvalidIdentityError` + validación defensiva en `LocalStorageIdentityStorage.read()` (shape inválido → null + clear key).

**`InvalidServerTimeError`** — `ServerTime` recibido del backend no es ISO8601 parseable. Bug de backend; raramente visible al usuario.

**`InvalidSimulacroError`** — Entidad `Simulacro` o VO `EstadoSimulacro` rechazada en construcción (campos inválidos, fin ≤ inicio, estado fuera del set, etc.).

**`InvalidAlternativaError`** — VO `Alternativa` rechazado (string fuera de A–E).

**`InvalidMarcacionError`** — Entidad `Marcacion` rechazada (simulacroId vacío, pregunta no entero positivo).

**`OfflineStorageUnavailableError`** — IndexedDB no disponible en el browser. UI: banner persistente "Tu navegador no soporta marcaciones offline" + bloqueo de entrada a simulacros.

**`InvalidSubmissionTimeError`** — Backend rechaza POST porque `clientSubmittedAt` cae fuera de `[inicio, fin]`. UI: error operacional + redirect `/home`.

**`InvalidPayloadError`** — Backend rechaza POST por shape inválido (count no cuadra, alternativas fuera de A–E|null). Bug del cliente. UI: "Hubo un error inesperado, intenta de nuevo."

**`SimulacroCerradoError`** — Backend reporta que el simulacro ya está cerrado. UI: "Este simulacro ya cerró" + redirect `/home`.

**`SimulacroNoAsignadoError`** — Backend reporta 404. UI: refrescar `/home` (el simulacro fue retirado o el id es stale en cola).
