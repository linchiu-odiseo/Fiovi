# auth-session — Delta Spec (fase-3-login-learnex)

## REMOVED Requirements

### Requirement ELIMINADO: Autenticación con credenciales → `Session` + `BearerToken`

El sistema ya NO devuelve una entidad `Session` con `BearerToken` al hacer login. `Session`, `BearerToken` e `InvalidSessionError` se eliminan del dominio.

### Requirement ELIMINADO: Una sola sesión activa (basada en `Session`)

Reemplazado por invariante de identidad única basada en `Identity`.

### Requirement ELIMINADO: La `Session` es una entidad de dominio con comportamiento

`Session.isExpired(now)`, `Session.principal()`, `Session.bearerToken` eliminados. El comportamiento equivalente migra a `Identity`.

### Requirement ELIMINADO: Renovación automática del bearer vía `X-New-Bearer`

`ActualizarBearerSiRenovadoUseCase` y la lectura de `X-New-Bearer` se eliminan. El refresh reactivo por 401 en interceptor reemplaza el rolling refresh.

### Requirement ELIMINADO: `GetActiveSessionUseCase`

Renombrado a `GetIdentityUseCase`.

---

## ADDED Requirements

### Requirement: Entidad `Identity` en L1

El sistema SHALL definir la entidad `Identity` en L1 con la siguiente forma:

```
Identity {
  id: string           // UUID del TenantUser
  tenantId: string
  email: string
  codigo: string | null  // presente en alumno, null en tutor en learnex actual
  roles: string[]
  permissions: string[]
  expiresAt: number    // timestamp ms
}
```

`Identity` SHALL exponer los siguientes métodos:

- `isExpired(now: number): boolean` — `true` si `expiresAt < now`.
- `shouldRefresh(now: number, thresholdMs: number): boolean` — `true` si `expiresAt - now < thresholdMs`.
- `role(): string` — devuelve el único elemento de `roles`. Si `roles.length !== 1`, lanza `InvalidIdentityError`.
- `hasPermission(permission: string): boolean` — `true` si `permission` está en `permissions`.

#### Scenario: `Identity.role()` con rol único devuelve el rol

- **WHEN** `Identity` se construye con `roles: ["student"]`
- **THEN** `identity.role()` devuelve `"student"` sin error

#### Scenario: `Identity.role()` con más de un rol lanza `InvalidIdentityError`

- **WHEN** `Identity` se construye con `roles: ["student", "tutor"]`
- **THEN** `identity.role()` lanza `InvalidIdentityError`

#### Scenario: `Identity.role()` con roles vacío lanza `InvalidIdentityError`

- **WHEN** `Identity` se construye con `roles: []`
- **THEN** `identity.role()` lanza `InvalidIdentityError`

#### Scenario: `Identity.isExpired` con `expiresAt` en el pasado

- **WHEN** `identity.expiresAt = now - 1000`
- **THEN** `identity.isExpired(now)` devuelve `true`

#### Scenario: `Identity.isExpired` con `expiresAt` en el futuro

- **WHEN** `identity.expiresAt = now + 60_000`
- **THEN** `identity.isExpired(now)` devuelve `false`

#### Scenario: `Identity.shouldRefresh` cuando queda menos del umbral para expirar

- **WHEN** `identity.expiresAt = now + 30_000` y `thresholdMs = 60_000`
- **THEN** `identity.shouldRefresh(now, 60_000)` devuelve `true`

#### Scenario: `Identity.shouldRefresh` cuando queda más del umbral para expirar

- **WHEN** `identity.expiresAt = now + 120_000` y `thresholdMs = 60_000`
- **THEN** `identity.shouldRefresh(now, 60_000)` devuelve `false`

#### Scenario: `Identity.hasPermission` con permiso presente

- **WHEN** `identity.permissions` incluye `"student:exams:view"`
- **THEN** `identity.hasPermission("student:exams:view")` devuelve `true`

#### Scenario: `Identity.hasPermission` con permiso ausente

- **WHEN** `identity.permissions` no incluye `"admin:panel:view"`
- **THEN** `identity.hasPermission("admin:panel:view")` devuelve `false`

### Requirement: Errores de dominio nuevos

El sistema SHALL definir en L1:

- `InvalidIdentityError` — invariante single-role roto en `Identity.role()`.
- `RefreshFailedError` — el endpoint `/auth/refresh` devolvió 401 con `code` `TENANT_AUTH_REFRESH_TOKEN_INVALID` o `TENANT_AUTH_REFRESH_TOKEN_MISSING`.
- `RateLimitError` — el back respondió HTTP 429.
- `ProfileNotAvailableError` — 403 o 404 en `/{role}/me`.
- `UnsupportedRoleError` — el back devolvió una identity con un rol fuera del set soportado por el cliente (hoy `{student, tutor}`). Expone la propiedad `role: string` con el valor recibido. Validado en el mapper L3 antes de construir `Identity`. Cuando el producto agregue soporte para `admin`/`teacher`, el error queda obsoleto.

Los errores `InvalidCredentialsError`, `NetworkError` y `SessionExpiredError` se mantienen.

#### Scenario: Login con rol no soportado (admin/teacher) es rechazado en el mapper L3

- **WHEN** el back responde 200 a `POST /auth/login` con `user.roles: ["admin"]` o `user.roles: ["teacher"]`
- **THEN** `HttpAuthRepository.mapIdentity` lanza `UnsupportedRoleError("admin"|"teacher")` ANTES de construir `Identity`
- **AND** `LoginUseCase` propaga el error sin persistir en `IdentityStorage`
- **AND** `LoginViewModel` muestra mensaje "Esta aplicación está disponible solo para alumnos y tutores. Contactá a tu administrador." y retorna outcome `'unsupported-role'`

#### Scenario: AppInitializer con cookie viva de rol no soportado limpia server-side

- **WHEN** `InitializeSessionUseCase.execute()` invoca `repo.me()` y recibe `UnsupportedRoleError`
- **THEN** el use case llama `repo.logout()` best-effort (try/catch — errores de red ignorados)
- **AND** `IdentityStorage.clear()` se ejecuta
- **AND** el use case retorna `null` (igual que `SessionExpiredError`)

### Requirement: `LoginUseCase` reescrito — devuelve `Identity`

`LoginUseCase` (L2) SHALL enviar credenciales al backend, obtener una `Identity` desde `AuthRepository.login()`, persistirla en `IdentityStorage` y disparar `GetProfileUseCase` en paralelo (fire-and-forget). El resultado del use case es la `Identity`.

#### Scenario: Login de alumno exitoso

- **WHEN** se invoca `LoginUseCase.execute({ email: "79507732@vonex.edu.pe", password: "79507732" })` con respuesta válida del back
- **THEN** devuelve `Identity` con `roles: ["student"]`, `email: "79507732@vonex.edu.pe"`, `expiresAt` poblado
- **AND** la `Identity` queda persistida en `IdentityStorage`
- **AND** se dispara `GetProfileUseCase` (sin bloquear el retorno del use case)

#### Scenario: Login de tutor exitoso

- **WHEN** se invoca `LoginUseCase` con credenciales de tutor
- **THEN** devuelve `Identity` con `roles: ["tutor"]`, `codigo: null`
- **AND** la `Identity` queda persistida en `IdentityStorage`

#### Scenario: Login con credenciales inválidas (401 + code TENANT_AUTH_INVALID_CREDENTIALS)

- **WHEN** `AuthRepository.login()` rechaza con `InvalidCredentialsError`
- **THEN** `LoginUseCase` rechaza con `InvalidCredentialsError`
- **AND** no se persiste ninguna identity

#### Scenario: Login con rate limit (429)

- **WHEN** `AuthRepository.login()` rechaza con `RateLimitError`
- **THEN** `LoginUseCase` rechaza con `RateLimitError`

#### Scenario: Login con error de red

- **WHEN** `AuthRepository.login()` rechaza con `NetworkError`
- **THEN** `LoginUseCase` rechaza con `NetworkError`

### Requirement: `InitializeSessionUseCase` — bootstrap de la app

`InitializeSessionUseCase` (L2) SHALL ser invocado por el `AppInitializer` al arrancar la app. Su flujo:

1. Invoca `AuthRepository.me()` (`GET /t/{slug}/auth/me`).
2. Si responde con identity válida → persiste en `IdentityStorage` → dispara `GetProfileUseCase` en paralelo.
3. Si responde con 401 → limpia `IdentityStorage` → devuelve `null` (el caller navega a `/login`).
4. Si responde con `NetworkError` → devuelve el error sin limpiar el storage (estado offline — UI maneja).

#### Scenario: AppInitializer con cookies válidas — identity restaurada

- **WHEN** `AuthRepository.me()` devuelve identity válida
- **THEN** `InitializeSessionUseCase` persiste la identity en `IdentityStorage`
- **AND** dispara `GetProfileUseCase` en paralelo
- **AND** devuelve la `Identity`

#### Scenario: AppInitializer con 401 — sesión inválida

- **WHEN** `AuthRepository.me()` rechaza con `SessionExpiredError` (HTTP 401)
- **THEN** `InitializeSessionUseCase` limpia `IdentityStorage`
- **AND** devuelve `null`

#### Scenario: AppInitializer con NetworkError — estado offline

- **WHEN** `AuthRepository.me()` rechaza con `NetworkError`
- **THEN** `InitializeSessionUseCase` no limpia el storage
- **AND** propaga el `NetworkError` al caller

### Requirement: `RefreshIdentityUseCase`

`RefreshIdentityUseCase` (L2) SHALL invocar `AuthRepository.refresh()` (`POST /t/{slug}/auth/refresh`) y actualizar `IdentityStorage` con la identity renovada. Si el refresh falla con `RefreshFailedError`, SHALL invocar `LogoutUseCase` y emitir el error para que el caller redirija a `/login`.

#### Scenario: Refresh exitoso — identity actualizada

- **WHEN** `AuthRepository.refresh()` devuelve identity renovada
- **THEN** `IdentityStorage` se actualiza con la nueva identity
- **AND** `RefreshIdentityUseCase` devuelve la identity renovada

#### Scenario: Refresh con token inválido — logout forzado

- **WHEN** `AuthRepository.refresh()` rechaza con `RefreshFailedError`
- **THEN** `LogoutUseCase` es invocado
- **AND** `RefreshIdentityUseCase` propaga `RefreshFailedError`

### Requirement: `GetIdentityUseCase` (renombrado de `GetActiveSessionUseCase`)

`GetIdentityUseCase` (L2) SHALL leer `IdentityStorage` y devolver la `Identity` si existe y no está expirada, o `null` en caso contrario. La evaluación de expiración SHALL usar el puerto `Clock` (`this.clock.now().getTime()`) — NUNCA `Date.now()` directo ni una función `nowMs` inyectada por separado.

#### Scenario: Identity persistida válida

- **WHEN** `IdentityStorage` contiene una identity con `expiresAt` en el futuro relativo a `clock.now()`
- **THEN** `GetIdentityUseCase.execute()` devuelve la `Identity`

#### Scenario: Storage vacío

- **WHEN** `IdentityStorage` no contiene datos
- **THEN** `GetIdentityUseCase.execute()` devuelve `null`

#### Scenario: Reloj local desviado no afecta el resultado cuando el `Clock` está calibrado

- **GIVEN** el reloj local del dispositivo (`Date.now()`/`vi.setSystemTime`) está adelantado 30 minutos respecto del servidor
- **AND** el `Clock` inyectado ya fue calibrado con el `serverTime` real (offset negativo que compensa el adelanto)
- **AND** `identity.expiresAt` es un timestamp real y futuro del servidor
- **WHEN** `GetIdentityUseCase.execute()` corre
- **THEN** la `Identity` se devuelve como válida (no expirada)

#### Scenario: Reloj local desviado SÍ afecta el resultado cuando el `Clock` no está calibrado

- **GIVEN** el mismo desvío de 30 minutos del escenario anterior
- **AND** el `Clock` inyectado NO fue calibrado (offset = 0, comportamiento idéntico a `Date.now()`)
- **WHEN** `GetIdentityUseCase.execute()` corre
- **THEN** la `Identity` se evalúa como expirada, reproduciendo el bug que este change corrige para el caso calibrado

### Requirement: `LogoutUseCase` expandido — limpieza completa

`LogoutUseCase` (L2) SHALL realizar las siguientes acciones en orden, de manera que cada error en un paso NO impida ejecutar los siguientes (best-effort en pasos de limpieza local):

1. Invocar `AuthRepository.logout()` (llama `POST /t/{slug}/auth/logout` — clears cookies server-side).
2. Limpiar `IdentityStorage`.
3. Limpiar `ProfileStorage`.
4. Limpiar la outbox (queue offline de envíos pendientes).
5. Limpiar las marcaciones del usuario (`MarkingsStorage.wipeUserScope()`).

#### Scenario: Logout exitoso — limpieza completa

- **WHEN** `LogoutUseCase.execute()` se invoca con sesión activa
- **THEN** `AuthRepository.logout()` es llamado
- **AND** `IdentityStorage.clear()` es llamado
- **AND** `ProfileStorage.clear()` es llamado
- **AND** outbox y marcaciones del usuario son limpiados

#### Scenario: Logout idempotente — sin sesión activa

- **WHEN** `LogoutUseCase.execute()` se invoca sin sesión activa
- **THEN** la operación completa sin errores

#### Scenario: Fallo en llamada al back durante logout no bloquea la limpieza local

- **WHEN** `AuthRepository.logout()` falla con `NetworkError`
- **THEN** `IdentityStorage.clear()` y `ProfileStorage.clear()` son invocados de todos modos

### Requirement: `AuthSession` empareja `Identity` con el `serverTime` de la misma respuesta

El sistema SHALL definir en L1 el value-object `AuthSession`:

```
AuthSession {
  identity: Identity
  serverTime: ServerTime | null
}
```

`serverTime` es `null` cuando la respuesta HTTP no incluyó el campo `serverTime`, o cuando lo incluyó pero no pudo parsearse como ISO 8601 válido. Ninguno de los dos casos es un error — el caller simplemente no calibra el `Clock` para esa respuesta.

#### Scenario: `AuthSession` con `serverTime` presente y válido

- **WHEN** la respuesta HTTP incluye `serverTime: "2026-09-14T15:07:11.123Z"`
- **THEN** `AuthSession.serverTime` es una instancia de `ServerTime` cuyo `toMillis()` corresponde a ese timestamp

#### Scenario: `AuthSession` con `serverTime` ausente

- **WHEN** la respuesta HTTP no incluye el campo `serverTime` (backend no desplegado aún)
- **THEN** `AuthSession.serverTime` es `null`
- **AND** `AuthSession.identity` se construye normalmente, sin error

#### Scenario: `AuthSession` con `serverTime` inválido

- **WHEN** la respuesta HTTP incluye `serverTime: "not-a-date"`
- **THEN** `AuthSession.serverTime` es `null` (el mapper capturó el `InvalidServerTimeError` y logueó un `console.warn`)
- **AND** `AuthSession.identity` se construye normalmente, sin error
- **AND** la promesa de `login`/`selectTenant`/`me`/`refresh` NO rechaza por este motivo

### Requirement: `login`, `selectTenant`, `refresh` y `me` calibran el `Clock` antes de persistir y agendar

`LoginUseCase`, `SelectTenantUseCase`, `RefreshIdentityUseCase` e `InitializeSessionUseCase` (L2) SHALL, cuando `AuthSession.serverTime` no sea `null`, invocar `Clock.setServerTime(serverTime)` **antes** de escribir la identity en `IdentityStorage` y **antes** de invocar `SessionRefreshScheduler.schedule(identity.expiresAt)`. Cuando `serverTime` sea `null`, el paso de calibración SHALL omitirse silenciosamente — el resto del flujo (persistencia, agendado, fetch de perfil) continúa sin cambios.

#### Scenario: Login exitoso con `serverTime` — calibra antes de agendar

- **WHEN** `LoginUseCase.execute(credentials)` resuelve con `AuthSession { identity, serverTime: <válido> }`
- **THEN** `Clock.setServerTime(serverTime)` se invoca
- **AND** la invocación ocurre antes de `SessionRefreshScheduler.schedule(identity.expiresAt)`
- **AND** la `Identity` queda persistida en `IdentityStorage`, igual que hoy

#### Scenario: Login exitoso sin `serverTime` — no calibra, comportamiento sin cambios

- **WHEN** `LoginUseCase.execute(credentials)` resuelve con `AuthSession { identity, serverTime: null }`
- **THEN** `Clock.setServerTime(...)` NO se invoca
- **AND** el resto del flujo (persistencia, agendado de refresh, fetch de perfil) ocurre exactamente igual que antes de este change

#### Scenario: `select-tenant` exitoso con `serverTime` — calibra antes de agendar

- **WHEN** `SelectTenantUseCase.execute(input)` resuelve con `AuthSession { identity, serverTime: <válido> }`
- **THEN** `Clock.setServerTime(serverTime)` se invoca antes de `SessionRefreshScheduler.schedule(identity.expiresAt)`

#### Scenario: Refresh exitoso con `serverTime` — calibra antes de re-agendar

- **WHEN** `RefreshIdentityUseCase.execute()` resuelve con `AuthSession { identity, serverTime: <válido> }`
- **THEN** `Clock.setServerTime(serverTime)` se invoca antes de `SessionRefreshScheduler.schedule(identity.expiresAt)`
- **AND** `IdentityStorage` se actualiza con la nueva identity, igual que hoy

#### Scenario: AppInitializer con `serverTime` — calibra antes de agendar el refresh proactivo

- **WHEN** `InitializeSessionUseCase.execute()` invoca `AuthRepository.me()` y resuelve con `AuthSession { identity, serverTime: <válido> }`
- **THEN** `Clock.setServerTime(serverTime)` se invoca antes de `SessionRefreshScheduler.schedule(identity.expiresAt)`

#### Scenario: Refresh fallido — no se calibra ni se agenda

- **WHEN** `RefreshIdentityUseCase.execute()` rechaza con `RefreshFailedError`
- **THEN** `Clock.setServerTime(...)` NO se invoca (comportamiento sin cambios respecto al requirement existente de logout forzado)

### Requirement: Puerto `AuthRepository` evolucionado

El puerto `AuthRepository` (L1) SHALL tener los métodos:

- `login(credentials: { email: string; password: string; captchaToken?: string }) → Promise<AuthSession | SelectionChallenge>`
- `selectTenant(input: { selectionToken: string; slug: string }) → Promise<AuthSession>`
- `me() → Promise<AuthSession>`
- `refresh() → Promise<AuthSession>`
- `logout() → Promise<void>`
- `getProfile(role: 'student' | 'tutor') → Promise<StudentProfile | TutorProfile>`
- `listSsoProviders() → Promise<SsoProvider[]>`

`AuthSession` reemplaza a `Identity` como tipo de retorno de `login` (rama no-selection), `selectTenant`, `me` y `refresh`. La rama `SelectionChallenge` de `login` no cambia.

#### Scenario: Puerto expone `AuthSession` en vez de `Identity` bare

- **WHEN** se inspecciona `AuthRepository` en L1
- **THEN** `me()` y `refresh()` devuelven `Promise<AuthSession>`, no `Promise<Identity>`
- **AND** `login()` devuelve `Promise<AuthSession | SelectionChallenge>`
- **AND** `selectTenant()` devuelve `Promise<AuthSession>`

#### Scenario: `AuthSession.identity` sigue siendo la `Identity` completa

- **WHEN** `AuthRepository.me()` resuelve
- **THEN** `result.identity` es una `Identity` válida con todos los campos existentes
  (`id`, `tenantId`, `tenantSlug`, `email`, `codigo`, `roles`, `role()`, `expiresAt`, `isExpired(now)`)
