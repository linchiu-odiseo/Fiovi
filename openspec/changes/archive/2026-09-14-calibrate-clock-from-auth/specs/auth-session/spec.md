# auth-session — Delta Spec (calibrate-clock-from-auth)

## MODIFIED Requirements

### Requirement: Puerto `AuthRepository` evolucionado

El puerto `AuthRepository` (L1) SHALL tener los métodos:

- `login(credentials: { email: string; password: string; captchaToken?: string }) → Promise<AuthSession | SelectionChallenge>`
- `selectTenant(input: { selectionToken: string; slug: string }) → Promise<AuthSession>`
- `me() → Promise<AuthSession>`
- `refresh() → Promise<AuthSession>`
- `logout() → Promise<void>`
- `getProfile(role: 'student' | 'tutor') → Promise<StudentProfile | TutorProfile>`
- `listSsoProviders() → Promise<SsoProvider[]>`

`AuthSession` reemplaza a `Identity` como tipo de retorno de `login` (rama no-selection),
`selectTenant`, `me` y `refresh`. La rama `SelectionChallenge` de `login` no cambia.

#### Scenario: Puerto expone `AuthSession` en vez de `Identity` bare

- **WHEN** se inspecciona `AuthRepository` en L1
- **THEN** `me()` y `refresh()` devuelven `Promise<AuthSession>`, no `Promise<Identity>`
- **AND** `login()` devuelve `Promise<AuthSession | SelectionChallenge>`
- **AND** `selectTenant()` devuelve `Promise<AuthSession>`

#### Scenario: `AuthSession.identity` sigue siendo la `Identity` completa

- **WHEN** `AuthRepository.me()` resuelve
- **THEN** `result.identity` es una `Identity` válida con todos los campos existentes
  (`id`, `tenantId`, `tenantSlug`, `email`, `codigo`, `roles`, `role()`, `expiresAt`, `isExpired(now)`)

### Requirement: `GetIdentityUseCase` (renombrado de `GetActiveSessionUseCase`)

`GetIdentityUseCase` (L2) SHALL leer `IdentityStorage` y devolver la `Identity` si existe y no
está expirada, o `null` en caso contrario. La evaluación de expiración SHALL usar el puerto
`Clock` (`this.clock.now().getTime()`) — NUNCA `Date.now()` directo ni una función `nowMs`
inyectada por separado.

#### Scenario: Identity persistida válida

- **WHEN** `IdentityStorage` contiene una identity con `expiresAt` en el futuro relativo a
  `clock.now()`
- **THEN** `GetIdentityUseCase.execute()` devuelve la `Identity`

#### Scenario: Storage vacío

- **WHEN** `IdentityStorage` no contiene datos
- **THEN** `GetIdentityUseCase.execute()` devuelve `null`

#### Scenario: Reloj local desviado no afecta el resultado cuando el `Clock` está calibrado

- **GIVEN** el reloj local del dispositivo (`Date.now()`/`vi.setSystemTime`) está adelantado 30
  minutos respecto del servidor
- **AND** el `Clock` inyectado ya fue calibrado con el `serverTime` real (offset negativo que
  compensa el adelanto)
- **AND** `identity.expiresAt` es un timestamp real y futuro del servidor
- **WHEN** `GetIdentityUseCase.execute()` corre
- **THEN** la `Identity` se devuelve como válida (no expirada)

#### Scenario: Reloj local desviado SÍ afecta el resultado cuando el `Clock` no está calibrado

- **GIVEN** el mismo desvío de 30 minutos del escenario anterior
- **AND** el `Clock` inyectado NO fue calibrado (offset = 0, comportamiento idéntico a `Date.now()`)
- **WHEN** `GetIdentityUseCase.execute()` corre
- **THEN** la `Identity` se evalúa como expirada, reproduciendo el bug que este change corrige
  para el caso calibrado

## ADDED Requirements

### Requirement: `AuthSession` empareja `Identity` con el `serverTime` de la misma respuesta

El sistema SHALL definir en L1 el value-object `AuthSession`:

```
AuthSession {
  identity: Identity
  serverTime: ServerTime | null
}
```

`serverTime` es `null` cuando la respuesta HTTP no incluyó el campo `serverTime`, o cuando lo
incluyó pero no pudo parsearse como ISO 8601 válido. Ninguno de los dos casos es un error — el
caller simplemente no calibra el `Clock` para esa respuesta.

#### Scenario: `AuthSession` con `serverTime` presente y válido

- **WHEN** la respuesta HTTP incluye `serverTime: "2026-09-14T15:07:11.123Z"`
- **THEN** `AuthSession.serverTime` es una instancia de `ServerTime` cuyo `toMillis()` corresponde
  a ese timestamp

#### Scenario: `AuthSession` con `serverTime` ausente

- **WHEN** la respuesta HTTP no incluye el campo `serverTime` (backend no desplegado aún)
- **THEN** `AuthSession.serverTime` es `null`
- **AND** `AuthSession.identity` se construye normalmente, sin error

#### Scenario: `AuthSession` con `serverTime` inválido

- **WHEN** la respuesta HTTP incluye `serverTime: "not-a-date"`
- **THEN** `AuthSession.serverTime` es `null` (el mapper capturó el `InvalidServerTimeError` y
  logueó un `console.warn`)
- **AND** `AuthSession.identity` se construye normalmente, sin error
- **AND** la promesa de `login`/`selectTenant`/`me`/`refresh` NO rechaza por este motivo

### Requirement: `login`, `selectTenant`, `refresh` y `me` calibran el `Clock` antes de persistir y agendar

`LoginUseCase`, `SelectTenantUseCase`, `RefreshIdentityUseCase` e `InitializeSessionUseCase`
(L2) SHALL, cuando `AuthSession.serverTime` no sea `null`, invocar
`Clock.setServerTime(serverTime)` **antes** de escribir la identity en `IdentityStorage` y
**antes** de invocar `SessionRefreshScheduler.schedule(identity.expiresAt)`. Cuando
`serverTime` sea `null`, el paso de calibración SHALL omitirse silenciosamente — el resto del
flujo (persistencia, agendado, fetch de perfil) continúa sin cambios.

#### Scenario: Login exitoso con `serverTime` — calibra antes de agendar

- **WHEN** `LoginUseCase.execute(credentials)` resuelve con `AuthSession { identity, serverTime: <válido> }`
- **THEN** `Clock.setServerTime(serverTime)` se invoca
- **AND** la invocación ocurre antes de `SessionRefreshScheduler.schedule(identity.expiresAt)`
- **AND** la `Identity` queda persistida en `IdentityStorage`, igual que hoy

#### Scenario: Login exitoso sin `serverTime` — no calibra, comportamiento sin cambios

- **WHEN** `LoginUseCase.execute(credentials)` resuelve con `AuthSession { identity, serverTime: null }`
- **THEN** `Clock.setServerTime(...)` NO se invoca
- **AND** el resto del flujo (persistencia, agendado de refresh, fetch de perfil) ocurre
  exactamente igual que antes de este change

#### Scenario: `select-tenant` exitoso con `serverTime` — calibra antes de agendar

- **WHEN** `SelectTenantUseCase.execute(input)` resuelve con `AuthSession { identity, serverTime: <válido> }`
- **THEN** `Clock.setServerTime(serverTime)` se invoca antes de
  `SessionRefreshScheduler.schedule(identity.expiresAt)`

#### Scenario: Refresh exitoso con `serverTime` — calibra antes de re-agendar

- **WHEN** `RefreshIdentityUseCase.execute()` resuelve con `AuthSession { identity, serverTime: <válido> }`
- **THEN** `Clock.setServerTime(serverTime)` se invoca antes de
  `SessionRefreshScheduler.schedule(identity.expiresAt)`
- **AND** `IdentityStorage` se actualiza con la nueva identity, igual que hoy

#### Scenario: AppInitializer con `serverTime` — calibra antes de agendar el refresh proactivo

- **WHEN** `InitializeSessionUseCase.execute()` invoca `AuthRepository.me()` y resuelve con
  `AuthSession { identity, serverTime: <válido> }`
- **THEN** `Clock.setServerTime(serverTime)` se invoca antes de
  `SessionRefreshScheduler.schedule(identity.expiresAt)`

#### Scenario: Refresh fallido — no se calibra ni se agenda

- **WHEN** `RefreshIdentityUseCase.execute()` rechaza con `RefreshFailedError`
- **THEN** `Clock.setServerTime(...)` NO se invoca (comportamiento sin cambios respecto al
  requirement existente de logout forzado)
