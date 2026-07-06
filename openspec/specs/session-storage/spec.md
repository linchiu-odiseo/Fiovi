# session-storage — Delta Spec (fase-3-login-learnex)

## REMOVED Requirements

### Requirement ELIMINADO: Persistencia de la sesión activa entre recargas (basada en `Session`)

La entidad `Session` y la key `lugia.session` dejan de existir. Reemplazados por `Identity` y la key `fiovi.identity`.

### Requirement ELIMINADO: Almacenamiento aislado tras `SessionStorage`

El puerto `SessionStorage` se elimina. Reemplazado por `IdentityStorage`.

### Requirement ELIMINADO: Integridad de dato persistido con `bearerToken` / `userEmail`

Los campos `bearerToken` y `userEmail` ya no son parte del dato persistido. El dato persiste `Identity`.

### Requirement ELIMINADO: Clave de almacenamiento `lugia.session`

La key `lugia.session` queda abandonada sin migración. Cualquier dato en esa key en el browser es tratado como legacy y se ignora.

---

## ADDED Requirements

### Requirement: Puerto `IdentityStorage` en L1

El sistema SHALL definir el puerto `IdentityStorage` en L1 con los métodos:

- `read() → Promise<Identity | null>`
- `write(identity: Identity) → Promise<void>`
- `clear() → Promise<void>`

La implementación concreta (`LocalStorageIdentityStorage`) reside en L3 y usa la key `fiovi.identity`. Ningún código en L1 o L2 SHALL referenciar `localStorage`, `sessionStorage`, `window` ni APIs equivalentes del navegador.

#### Scenario: L1 y L2 no referencian APIs de browser

- **WHEN** se inspecciona el código de `L1_domain/` y `L2_application/`
- **THEN** no aparecen los identificadores `localStorage`, `sessionStorage`, `window`, `document` ni `navigator`

#### Scenario: LR consume `IdentityStorage` solo vía DI

- **WHEN** se inspecciona el código de `LR_render/`
- **THEN** cualquier acceso a la identity se hace inyectando `IdentityStorage` o use cases que lo orquestan

### Requirement: `LocalStorageIdentityStorage` — key `fiovi.identity`, shape `Identity`

La implementación SHALL serializar `Identity` como JSON bajo la key exacta `fiovi.identity`. Al leer:

1. Si la key no existe → devolver `null`.
2. Si el JSON no se puede parsear → devolver `null` y eliminar la key.
3. Si el JSON no representa un `Identity` válido (campos faltantes o inválidos) → devolver `null` y eliminar la key.
4. Si la key `lugia.session` (legacy) existe → ignorarla sin migrar ni tocarla.

#### Scenario: Write + read round-trip de Identity

- **WHEN** se invoca `identityStorage.write(identity)` y luego `identityStorage.read()`
- **THEN** se obtiene la misma `Identity` serializada

#### Scenario: Storage vacío devuelve null

- **WHEN** `localStorage` no contiene la key `fiovi.identity`
- **THEN** `identityStorage.read()` devuelve `null`

#### Scenario: JSON corrupto — null y limpieza

- **WHEN** la key `fiovi.identity` contiene texto no parseable como JSON
- **THEN** `identityStorage.read()` devuelve `null`
- **AND** la key `fiovi.identity` es eliminada del storage

#### Scenario: Shape inválido — null y limpieza

- **WHEN** la key `fiovi.identity` contiene JSON válido pero sin `roles`, `expiresAt` u otros campos requeridos de `Identity`
- **THEN** `identityStorage.read()` devuelve `null`
- **AND** la key `fiovi.identity` es eliminada del storage

#### Scenario: Key legacy `lugia.session` es ignorada

- **WHEN** `localStorage` contiene la key `lugia.session` (dato de Fase 1/2) pero no `fiovi.identity`
- **THEN** `identityStorage.read()` devuelve `null`
- **AND** la key `lugia.session` NO es leída, migrada ni eliminada por este storage

#### Scenario: Logout limpia `fiovi.identity`

- **WHEN** `identityStorage.clear()` es invocado
- **THEN** la key `fiovi.identity` es eliminada del storage
- **AND** `identityStorage.read()` devuelve `null` después

### Requirement: Puerto `ProfileStorage` en L1

El sistema SHALL definir el puerto `ProfileStorage` en L1 con los métodos:

- `read(role: 'student' | 'tutor') → Promise<CachedProfile | null>`
- `write(role: 'student' | 'tutor', profile: StudentProfile | TutorProfile) → Promise<void>`
- `clear() → Promise<void>`

`CachedProfile` tiene la forma `{ profile: StudentProfile | TutorProfile, cachedAt: number }` donde `cachedAt` es un timestamp en milisegundos.

La implementación concreta (`IndexedDbProfileStorage`) reside en L3. Usa stores separados por rol: `profile.student`, `profile.tutor`.

#### Scenario: ProfileStorage write + read fresh — retorna profile

- **WHEN** se invoca `profileStorage.write('student', studentProfile)` y luego `profileStorage.read('student')`
- **THEN** devuelve `CachedProfile { profile: studentProfile, cachedAt }` con `cachedAt` dentro del TTL

#### Scenario: ProfileStorage read stale (más de 24h) — retorna null

- **WHEN** el `cachedAt` del profile almacenado es `now - 25 * 3600 * 1000`
- **THEN** `profileStorage.read(role)` devuelve `null`

#### Scenario: ProfileStorage read miss — retorna null

- **WHEN** no hay ningún profile almacenado para el rol solicitado
- **THEN** `profileStorage.read(role)` devuelve `null`

#### Scenario: ProfileStorage clear — limpia ambos roles

- **WHEN** `profileStorage.clear()` es invocado
- **THEN** `profileStorage.read('student')` devuelve `null`
- **AND** `profileStorage.read('tutor')` devuelve `null`

### Requirement: Logout limpia ambos storages

`LogoutUseCase` (L2) SHALL invocar tanto `IdentityStorage.clear()` como `ProfileStorage.clear()` durante el proceso de cierre de sesión. Ambas operaciones deben ejecutarse aunque el back falle.

#### Scenario: Logout limpia identity y profile

- **WHEN** `LogoutUseCase` se invoca
- **THEN** `IdentityStorage.clear()` es invocado
- **AND** `ProfileStorage.clear()` es invocado
- **AND** un refresh posterior a `/student/home` o `/tutor/home` redirige a `/login`

### Requirement: `MarkingsStorage` depende del port `IdentityStorage`, no de la implementación concreta

`IndexedDbMarkingsStorage` SHALL inyectar el puerto `IdentityStorage` (L1) para obtener el email del usuario activo cuando necesite delimitar el scope de las marcaciones. NO SHALL importar `LocalStorageIdentityStorage` ni ninguna otra implementación concreta.

#### Scenario: `IndexedDbMarkingsStorage` no importa implementación concreta de identity

- **WHEN** se inspecciona el código de `IndexedDbMarkingsStorage`
- **THEN** no importa `LocalStorageIdentityStorage` ni `LocalStorageSessionStorage`
- **AND** inyecta `IdentityStorage` (el token de DI del port)

#### Scenario: `wipeUserScope()` sin identity es no-op

- **WHEN** `IdentityStorage.read()` devuelve `null`
- **AND** se invoca `MarkingsStorage.wipeUserScope()`
- **THEN** la operación completa sin errores y sin borrar datos de ningún usuario
