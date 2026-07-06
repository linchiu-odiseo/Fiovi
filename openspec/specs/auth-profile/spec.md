# auth-profile Specification

## Purpose

Capability nueva. Define cómo Fiovi obtiene y cachea el perfil del usuario autenticado (alumno o tutor) desde los endpoints `GET /t/{slug}/student/me` y `GET /t/{slug}/tutor/me` de learnex. El perfil aporta nombre, apellido, código (DNI para alumno, código interno para tutor) y datos específicos del rol (área para alumno, aulas para tutor). El cache en IndexedDB con TTL 24h evita fetches repetitivos durante la sesión.

## Requirements

### Requirement: Value-objects de perfil separados por rol

El sistema SHALL definir dos value-objects independientes en L1 que representan el perfil del usuario según su rol:

- `StudentProfile { id: string, code: string, firstName: string, lastName: string, area: string | null }` — `code` es el DNI del alumno (8 dígitos, ej. `"79507732"`). `area` puede ser `null` si el alumno no ha rendido ningún examen — estado válido.
- `TutorProfile { id: string, code: string, firstName: string, lastName: string, email: string, classrooms: Classroom[] }` — `code` es el código interno del tutor (ej. `"T001"`). `classrooms` puede ser `[]` si el tutor no tiene aulas asignadas — estado válido.

`Classroom` SHALL tener: `{ id, code, name, modality, shift, campusName, cycleId, cycleName, studentCount }`.

Distinción explícita: `Identity.id` corresponde al TenantUser; `StudentProfile.id` / `TutorProfile.id` corresponde a la fila en `students` / `tutors`. No deben intercambiarse en futuros endpoints.

#### Scenario: Alumno con perfil completo

- **WHEN** el back devuelve `GET /t/{slug}/student/me` con `{ id: "573e8dfa-...", code: "79507732", firstName: "Gabriel", lastName: "Acuña Acuña", area: null }`
- **THEN** se construye `StudentProfile` con `code = "79507732"`, `firstName = "Gabriel"`, `lastName = "Acuña Acuña"`, `area = null`
- **AND** `area = null` es un estado válido — no indica error

#### Scenario: Alumno sin área asignada (área null)

- **WHEN** `StudentProfile.area` es `null`
- **THEN** el sistema no lanza error ni descarta el perfil
- **AND** la UI trata el campo como "Sin área asignada"

#### Scenario: Tutor con aulas asignadas

- **WHEN** el back devuelve `GET /t/{slug}/tutor/me` con `code: "T001"`, `firstName: "Carlos"`, `lastName: "Mendoza"`, `email: "tutor1@vonex.pe"` y `classrooms` con 2 entradas de `studentCount: 60` cada una
- **THEN** se construye `TutorProfile` con `classrooms.length === 2` y total de alumnos `= 120`

#### Scenario: Tutor sin aulas asignadas

- **WHEN** el back devuelve `classrooms: []`
- **THEN** se construye `TutorProfile` con `classrooms = []`
- **AND** es estado válido — no indica error

### Requirement: Puerto `ProfileStorage` en L1

El sistema SHALL definir el puerto `ProfileStorage` en L1 con los métodos:

- `read(role: 'student' | 'tutor') → Promise<CachedProfile | null>`
- `write(role: 'student' | 'tutor', profile: StudentProfile | TutorProfile) → Promise<void>`
- `clear() → Promise<void>`

`CachedProfile` SHALL contener `{ profile: StudentProfile | TutorProfile, cachedAt: number }`. La implementación concreta reside en L3 (`IndexedDbProfileStorage`). Ningún código en L1 o L2 SHALL referenciar la implementación concreta.

#### Scenario: Separación de port e implementación

- **WHEN** se inspecciona el código de `L1_domain/` y `L2_application/`
- **THEN** no aparecen referencias a `IndexedDbProfileStorage` ni a APIs de IndexedDB
- **AND** `ProfileStorage` se consume mediante inyección de dependencias

### Requirement: Puerto `AuthRepository` expone `getProfile(role)`

El puerto `AuthRepository` (L1) SHALL incluir el método `getProfile(role: 'student' | 'tutor') → Promise<StudentProfile | TutorProfile>`. La implementación concreta en L3 (`HttpAuthRepository`) llama al endpoint correspondiente según el rol.

#### Scenario: Routing por rol al endpoint correcto

- **WHEN** `AuthRepository.getProfile('student')` se invoca
- **THEN** la implementación hace `GET /t/{slug}/student/me`

- **WHEN** `AuthRepository.getProfile('tutor')` se invoca
- **THEN** la implementación hace `GET /t/{slug}/tutor/me`

### Requirement: `GetProfileUseCase` con cache TTL 24h

El sistema SHALL exponer `GetProfileUseCase` (L2) que implementa la siguiente lógica:

1. Consulta `ProfileStorage.read(role)`.
2. Si existe un `CachedProfile` con `cachedAt` dentro de las últimas 24 horas → devuelve el perfil cacheado sin hacer fetch.
3. Si no existe o el `cachedAt` tiene más de 24 horas (stale) → invoca `AuthRepository.getProfile(role)` → escribe el resultado en `ProfileStorage` → devuelve el perfil.
4. Si el fetch devuelve datos distintos a los cacheados → reemplaza el cache con los nuevos datos.

#### Scenario: Cache hit dentro de TTL — no hace fetch

- **WHEN** `ProfileStorage.read(role)` devuelve un perfil con `cachedAt = now - 1h`
- **THEN** `GetProfileUseCase` devuelve ese perfil sin invocar `AuthRepository.getProfile`

#### Scenario: Cache miss — fetch y escritura

- **WHEN** `ProfileStorage.read(role)` devuelve `null`
- **THEN** `GetProfileUseCase` invoca `AuthRepository.getProfile(role)`
- **AND** escribe el resultado en `ProfileStorage` con `cachedAt = now`
- **AND** devuelve el perfil obtenido del back

#### Scenario: Cache stale (más de 24h) — fetch y reemplazo

- **WHEN** `ProfileStorage.read(role)` devuelve un perfil con `cachedAt = now - 25h`
- **THEN** `GetProfileUseCase` invoca `AuthRepository.getProfile(role)`
- **AND** reemplaza el cache con los nuevos datos
- **AND** devuelve el perfil actualizado

#### Scenario: Back devuelve datos distintos al cache — reemplazo

- **WHEN** el cache contiene `firstName: "Carlos"` y el fetch devuelve `firstName: "Carlos M."`
- **THEN** `GetProfileUseCase` escribe el perfil nuevo en cache
- **AND** devuelve el perfil nuevo

### Requirement: Invalidación de cache en logout

El `LogoutUseCase` (L2) SHALL invocar `ProfileStorage.clear()` como parte del proceso de cierre de sesión. Tras el logout, cualquier lectura de `ProfileStorage` devuelve `null` para todos los roles.

#### Scenario: Logout limpia el cache de perfil

- **WHEN** `LogoutUseCase` se invoca
- **THEN** `ProfileStorage.clear()` es invocado
- **AND** `ProfileStorage.read('student')` devuelve `null` después del logout
- **AND** `ProfileStorage.read('tutor')` devuelve `null` después del logout

### Requirement: Mapeo de errores HTTP en endpoints de perfil

El sistema SHALL mapear los errores HTTP de `/{role}/me` a errores de dominio según la siguiente tabla:

| HTTP | Condición | Error de dominio |
|---|---|---|
| 401 | cualquier `code` | `SessionExpiredError` (el interceptor maneja refresh automático antes de que llegue al use case) |
| 403 | cualquier `code` | `ProfileNotAvailableError` |
| 404 | cualquier `code` | `ProfileNotAvailableError` |
| 5xx / red | — | `NetworkError` |

Prohibido clasificar por el campo `message` del response body.

#### Scenario: 401 en endpoint de perfil — interceptor reintenta

- **WHEN** `GET /t/{slug}/student/me` devuelve HTTP 401
- **THEN** el interceptor de credenciales invoca el refresh y reintenta la request original
- **AND** si el retry es exitoso, `GetProfileUseCase` recibe la respuesta como si nunca hubiera habido 401
- **AND** si el retry también falla, el caller recibe `SessionExpiredError`

#### Scenario: 403 en endpoint de perfil → `ProfileNotAvailableError`

- **WHEN** `GET /t/{slug}/student/me` devuelve HTTP 403
- **THEN** `GetProfileUseCase` rechaza con `ProfileNotAvailableError`

#### Scenario: 404 en endpoint de perfil → `ProfileNotAvailableError`

- **WHEN** `GET /t/{slug}/tutor/me` devuelve HTTP 404
- **THEN** `GetProfileUseCase` rechaza con `ProfileNotAvailableError`

#### Scenario: 5xx o error de red → `NetworkError`

- **WHEN** `GET /t/{slug}/student/me` devuelve HTTP 500 o el request falla en transporte
- **THEN** `GetProfileUseCase` rechaza con `NetworkError`

### Requirement: `StudentProfile.code` y `TutorProfile.code` — semántica diferente, etiqueta UI unificada

`StudentProfile.code` es el DNI del alumno (ej. `"79507732"`). `TutorProfile.code` es el código interno del tutor (ej. `"T001"`). Ambos se muestran en la UI con la etiqueta `"DNI / Código"`. El sistema SHALL NO usar `Identity.codigo` para mostrar el identificador visible al usuario — siempre se usa `Profile.code`.

#### Scenario: UI consume `Profile.code` — nunca `Identity.codigo`

- **WHEN** se inspecciona el código de `LR_render/`
- **THEN** el campo de DNI/Código de la home se liga a `profile.code`
- **AND** no se liga a `identity.codigo`
