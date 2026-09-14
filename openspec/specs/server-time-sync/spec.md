# server-time-sync Specification

## Purpose
Captures server time from API responses and provides a Clock port that applies local offset for accurate countdown and submission time computation.

## Requirements

### Requirement: Puerto `Clock` server-anchored en L1

La capa L1 SHALL definir el puerto `Clock` que expone `now(): Date` (o equivalente) devolviendo la hora actual ajustada por el `offset` capturado del backend. NO se usa `Date.now()` directo en L1, L2 o en lógica de dominio fuera de este puerto.

#### Scenario: Lectura sin offset previo

- **WHEN** se construye el `Clock` y aún no se ha capturado un `serverTime`
- **THEN** `clock.now()` devuelve la hora local sin ajuste (offset = 0)

#### Scenario: Lectura con offset positivo

- **WHEN** el último GET reportó `serverTime` 5 segundos delante del reloj local
- **AND** el reloj local marca 8:47:00
- **THEN** `clock.now()` devuelve 8:47:05

#### Scenario: Lectura con offset negativo

- **WHEN** el último GET reportó `serverTime` 3 segundos detrás del reloj local
- **AND** el reloj local marca 8:47:00
- **THEN** `clock.now()` devuelve 8:46:57

### Requirement: Captura del `serverTime` en respuestas de red que lo expongan

El sistema SHALL extraer el `serverTime` de cada respuesta HTTP que lo incluya y entregarlo al `Clock` server-anchored para actualizar el offset. Esto ya no está limitado a `GET /simulacros` (`HttpExamsApi`) — las respuestas de los endpoints de auth (`POST /auth/login`, `POST /auth/select-tenant`, `POST /t/{slug}/auth/refresh`, `GET /t/{slug}/auth/me`, vía `HttpAuthRepository`) también son una fuente de calibración cuando el backend incluye el campo.

El campo `serverTime` en las respuestas de auth es **opcional**: su ausencia (backend no desplegado todavía, o endpoint que no lo soporta) NO es un error — simplemente no hay calibración en esa respuesta particular. Un valor presente pero no parseable como ISO 8601 tampoco es un error para el flujo de auth: se descarta, se loguea con `console.warn`, y la respuesta se procesa normalmente sin calibrar el `Clock`.

#### Scenario: Offset actualizado en cada GET /simulacros (sin cambios)

- **WHEN** llega una respuesta de `GET /v3/simulacros` con `serverTime` `2026-06-12T08:15:05-05:00`
- **AND** el reloj local del cliente marca `2026-06-12T08:15:00-05:00`
- **THEN** el offset se actualiza a +5 segundos

#### Scenario: Offset actualizado desde una respuesta de auth con `serverTime` presente

- **WHEN** `POST /auth/login` responde con `serverTime: "2026-09-14T15:07:11.123Z"` en el body
- **AND** el reloj local del cliente difiere de ese valor
- **THEN** `ServerAnchoredClock.setServerTime(...)` se invoca con ese `serverTime`
- **AND** las lecturas posteriores de `clock.now()` reflejan el nuevo offset — antes de que ocurra ningún `GET /simulacros`

#### Scenario: Respuesta de auth sin `serverTime` — sin calibración, sin error

- **WHEN** `POST /auth/login` responde sin el campo `serverTime` en el body
- **THEN** el offset del `Clock` no cambia
- **AND** el login se procesa normalmente (identity persistida, sesión iniciada)

#### Scenario: Respuesta de auth con `serverTime` inválido — sin calibración, sin error

- **WHEN** `POST /t/{slug}/auth/refresh` responde con `serverTime: "not-a-date"` en el body
- **THEN** el offset del `Clock` no cambia
- **AND** se emite un `console.warn`
- **AND** el refresh se procesa normalmente (identity persistida, scheduler re-agendado)

### Requirement: Adapter `ServerAnchoredClock` en L3

La capa L3 SHALL implementar `ServerAnchoredClock` que cumple el puerto `Clock`. Internamente mantiene el `offsetMs` actualizado, con valor inicial `0`. Expone un método `setServerTime(serverTime: Date)` invocado por el adapter HTTP.

#### Scenario: Adapter inicializa con offset cero

- **WHEN** el `ServerAnchoredClock` se construye por primera vez
- **THEN** `clock.now()` devuelve `new Date()` exactamente

#### Scenario: Adapter expone método para actualizar offset

- **WHEN** se invoca `clock.setServerTime(serverTime)` con un timestamp del backend
- **THEN** el offset interno se recalcula como `serverTime.getTime() - Date.now()`

### Requirement: Countdowns en la UI usan el `Clock` server-anchored

Los view-models de `/home` y `/simulacro/:id` SHALL usar el `Clock` server-anchored para todos los countdowns visibles al alumno ("Cierra a las HH:MM · MM min restantes", "Disponible a las HH:MM"). La evaluación de expiración de sesión (`GetIdentityUseCase`) y el cálculo del delay de refresh proactivo (`SessionRefreshScheduler.schedule`) SHALL usar el mismo puerto `Clock` — no `Date.now()` directo — para que la calibración obtenida en login/refresh/me también beneficie a esas dos decisiones, no solo a los countdowns visibles.

#### Scenario: Countdown anclado al server, no al reloj local (sin cambios)

- **WHEN** el alumno cambia la hora de su celular 10 minutos hacia atrás
- **THEN** los countdowns siguen reflejando la hora real del servidor (sin retroceder 10 min)

#### Scenario: Expiración de sesión anclada al server, no al reloj local

- **GIVEN** el `Clock` fue calibrado en el login más reciente
- **WHEN** el alumno adelanta la hora de su celular 30 minutos
- **AND** `authGuard`/`roleGuard` consultan `GetIdentityUseCase` inmediatamente después
- **THEN** la identity se evalúa como no expirada (el reloj adelantado del dispositivo no la hace parecer vencida)

#### Scenario: Delay de refresh proactivo anclado al server, no al reloj local

- **GIVEN** el `Clock` fue calibrado en el login más reciente
- **WHEN** el alumno adelanta la hora de su celular 30 minutos
- **AND** `BrowserSessionRefreshScheduler.schedule(identity.expiresAt)` se invoca
- **THEN** el `delayMs` calculado usa `clock.now()` calibrado, no el reloj adelantado del dispositivo — no produce un `delayMs` de `0` artificial por el desvío

#### Scenario: Countdown se actualiza periódicamente

- **WHEN** un simulacro está abierto y la UI muestra "45 min restantes"
- **THEN** el view-model recalcula el countdown cada segundo usando `clock.now()`
- **AND** la UI refleja el cambio sin parpadeo

### Requirement: Persistencia del offset entre navegaciones

El offset capturado SHALL persistir mientras la app esté abierta. Una nueva navegación dentro de la PWA NO debe resetear el offset.

#### Scenario: Offset sobrevive navegación

- **WHEN** el alumno está en `/home` con offset = +5s, navega a `/simulacro/:id` y vuelve a `/home`
- **THEN** el offset sigue siendo +5s
- **AND** no se requiere un GET extra para reanclar
