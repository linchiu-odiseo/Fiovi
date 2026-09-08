# Delta for audit-log-capture

## ADDED Requirements

### Requirement: REQ-AL-01 — Captura de eventos HTTP

Un HTTP interceptor SHALL emitir un evento `H` por cada request que sale de `HttpClient` (independiente del método, path, o status de respuesta). El evento SHALL contener:

- `t`: timestamp epoch ms de cuando el interceptor empezó a procesar la request.
- `e`: `"H"` (literal).
- `m`: método numérico (1=GET, 2=POST, 3=PUT, 4=DELETE, 5=PATCH).
- `u`: endpoint ID numérico leído del `HttpContext` (default `0` cuando el adapter no lo marcó).
- `st`: HTTP status de la respuesta.
- `dur`: duración en ms desde start hasta respuesta.
- `c`: (opcional) código de error numérico, extraído SOLO cuando `st >= 400` y el body incluye `code` — leído según regla #3 de CLAUDE.md (nunca del `message`).
- `d`: (opcional) marks count, presente cuando el request context incluye `MARKS_COUNT_TOKEN`.
- `s`: (opcional) sessionId (últimos 8 chars) cuando el request context incluye `SESSION_ID_TOKEN`.

Errores de red (`HttpErrorResponse` con `status === 0` o failure sin respuesta HTTP) SHALL emitir además un evento `NW` con `u` y `s?`.

Los adapters HTTP existentes (`http-auth-repository`, `http-exams-api`, `http-tutor-exams-api`, `http-tutor-navigation-api`) SHALL marcar cada request con `context: new HttpContext().set(ENDPOINT_ID_TOKEN, ENDPOINT_IDS.foo)`.

El interceptor SHALL ser registrado CHAINED después de `credentialsInterceptor` (nunca antes).

#### Scenario: GET exitoso genera H con endpoint ID conocido

- **GIVEN** un adapter llama `http.get(apiPath.studentExamSessions(slug), { context: new HttpContext().set(ENDPOINT_ID_TOKEN, ENDPOINT_IDS.studentExamSessions) })`
- **WHEN** el back responde 200 en 142ms
- **THEN** `AuditLogStore.currentDayBatch()` contiene un evento con `e:"H"`, `m:1`, `u:<ENDPOINT_IDS.studentExamSessions>`, `st:200`, `dur:142`

#### Scenario: POST con 429 genera H con código de error extraído del body

- **GIVEN** un adapter llama `http.post(apiPath.submit(slug, id), body, { context: ... })`
- **WHEN** el back responde 429 con body `{ code: "TOO_MANY_REQUESTS", message: "..." }`
- **THEN** el evento H tiene `st:429` y `c:<ERROR_CODE_IDS.TOO_MANY_REQUESTS>`
- **AND** el evento H NO contiene el campo `message` ni ningún string humano del error

#### Scenario: Request sin marca de HttpContext cae en endpoint unknown

- **GIVEN** una request sale sin `HttpContext().set(ENDPOINT_ID_TOKEN, ...)`
- **WHEN** el interceptor la procesa
- **THEN** el evento H tiene `u:0`
- **AND** el interceptor NO lanza excepción

#### Scenario: NetworkError genera evento NW además del H

- **GIVEN** un adapter llama `http.post(apiPath.submit(...))` con `MARKS_COUNT_TOKEN` y `SESSION_ID_TOKEN` en el context
- **WHEN** la request falla sin llegar al back (`status === 0`)
- **THEN** `currentDayBatch()` contiene un evento `e:"NW"` con `u:<ENDPOINT_IDS.submit>` y `s:<sessionId>`
- **AND** contiene también un `e:"H"` con `st:0`

#### Scenario: Draft snapshot incluye marks count en el H

- **GIVEN** `DraftAutoSaveDispatcher.fire()` arma la request del snapshot con `MARKS_COUNT_TOKEN=12` en el context
- **WHEN** el interceptor procesa esa request
- **THEN** el evento H incluye `d:12`

### Requirement: REQ-AL-02 — Captura de eventos de aplicación

El adapter SHALL emitir eventos no-HTTP en los siguientes puntos:

- **`MK`**: cada vez que `SimulacroViewModel.setAlt(q, a)` o `clearAlt(q)` es invocado con éxito. Evento: `{ t, e:"MK", s, q, a }` donde `a` es `"A"|"B"|"C"|"D"|"E"` o `"0"` para clear.
- **`SS`**: al abrir una sesión de examen (primer render del view-model con `sessionId` cargado). Evento: `{ t, e:"SS", s }`.
- **`VC`**: al recibir `document.visibilitychange`. Evento: `{ t, e:"VC", v }` donde `v:0` cuando `document.visibilityState === 'hidden'`, `v:1` cuando `'visible'`.
- **`OF`**: al recibir `window.online` u `offline`. Evento: `{ t, e:"OF", o }` donde `o:0` offline, `o:1` online.
- **`AO`**: al primer bootstrap de la app en el día. Evento: `{ t, e:"AO", cold }` donde `cold:1` cold-start, `cold:0` warm.
- **`AI`**: en 2 momentos:
  - Al detectar `window.matchMedia('(display-mode: standalone)').matches === true` al bootstrap → `{ t, e:"AI", mode:"standalone" }` (1× por día).
  - Al recibir evento `window.appinstalled` → `{ t, e:"AI", mode:"prompt-accepted" }` (one-shot).
- **`DP`**: 1× por día, junto al primer `AO`. Evento: `{ t, e:"DP", ram, cores, screen, dpr }` donde:
  - `ram` = `navigator.deviceMemory` (número o `null` si no disponible).
  - `cores` = `navigator.hardwareConcurrency` (número o `null`).
  - `screen` = `"{width}x{height}"` (viewport en px).
  - `dpr` = `window.devicePixelRatio` (número).
- **`RT`**: cuando `credentialsInterceptor` dispara refresh en 401. Evento: `{ t, e:"RT", st, c? }` donde `st` es el status del `/refresh` y `c` el código si falló.
- **`AS`**: JUSTO ANTES del POST de auto-envío. Se emite tanto en modo tarea (setTimeout local del view-model) como en modo examen (via callback `onFire` del `ProgramarAutoEnvioUseCase`). Evento: `{ t, e:"AS", s }` donde `s` es el sessionId truncado. Permite distinguir en el log submit manual (click Enviar → solo aparece `H` con `u:21`) del auto-submit (aparece `AS` seguido de `H` con `u:21` casi al mismo tiempo).

Todos los `append` SHALL ser fire-and-forget: nunca bloquean al llamador. Excepciones (incluso `QuotaExceededError`) SHALL ser cachadas silenciosamente sin propagar.

Ninguno de los eventos SHALL contener PII (emails, nombres, tokens, cookies, response bodies, respuestas del examen).

#### Scenario: setAlt emite MK con pregunta y alternativa

- **GIVEN** `SimulacroViewModel` con sesión activa `sessionId = "a3f9c2b1"`
- **WHEN** el alumno invoca `setAlt(10, "C")`
- **THEN** `currentDayBatch()` contiene `{ e:"MK", s:"a3f9c2b1", q:10, a:"C" }`

#### Scenario: clearAlt emite MK con alternativa "0"

- **GIVEN** `SimulacroViewModel` con sesión activa
- **WHEN** el alumno invoca `clearAlt(10)`
- **THEN** `currentDayBatch()` contiene `{ e:"MK", s, q:10, a:"0" }`

#### Scenario: visibilitychange dispara VC

- **GIVEN** los listeners están registrados
- **WHEN** `document.visibilityState` pasa a `"hidden"` y se dispara `visibilitychange`
- **THEN** `currentDayBatch()` contiene `{ e:"VC", v:0 }`

#### Scenario: online/offline dispara OF

- **GIVEN** los listeners están registrados
- **WHEN** `window` recibe evento `offline`
- **THEN** `currentDayBatch()` contiene `{ e:"OF", o:0 }`

#### Scenario: Cold app-open emite AO con cold:1

- **GIVEN** primer bootstrap de la app en el navegador (sin previa sesión warm)
- **WHEN** `AppInitializer` corre
- **THEN** `currentDayBatch()` contiene `{ e:"AO", cold:1 }`

#### Scenario: PWA standalone emite AI standalone

- **GIVEN** `window.matchMedia('(display-mode: standalone)').matches === true`
- **WHEN** `AppInitializer` corre
- **THEN** `currentDayBatch()` contiene `{ e:"AI", mode:"standalone" }`

#### Scenario: appinstalled dispara AI prompt-accepted

- **GIVEN** la PWA no está instalada y el usuario acepta el prompt de instalación
- **WHEN** `window` recibe evento `appinstalled`
- **THEN** `currentDayBatch()` contiene `{ e:"AI", mode:"prompt-accepted" }`

#### Scenario: AS se emite antes del POST de auto-submit en modo examen

- **GIVEN** `SimulacroPageViewModel` con sesión activa `sessionId = "abc12345"` en modo examen (no tarea)
- **AND** el auto-envío está programado via `ProgramarAutoEnvioUseCase`
- **WHEN** el timer del use case dispara
- **THEN** `ProgramarAutoEnvioUseCase` invoca `input.onFire?.()` ANTES de llamar `enviar.execute()`
- **AND** el callback del view-model emite `{ e:"AS", s:"abc12345" }` al audit-log
- **AND** el evento `AS` aparece en `currentDayBatch()` ANTES del evento `H` con `u:21` correspondiente

#### Scenario: AS se emite antes del POST de auto-submit en modo tarea

- **GIVEN** `SimulacroPageViewModel` con sesión activa en modo tarea (`exam.esTarea() === true`)
- **AND** `scheduleAutoEnvio` programó un `setTimeout` local para el cierre personal
- **WHEN** el `setTimeout` dispara
- **THEN** el callback emite `{ e:"AS", s }` ANTES de invocar `this.submit()`

#### Scenario: DP se emite 1× por día

- **GIVEN** bootstrap del día
- **WHEN** `AppInitializer` corre
- **THEN** `currentDayBatch()` contiene exactamente 1 evento `{ e:"DP", ram, cores, screen, dpr }`
- **AND** si el usuario recarga la app en el mismo día, NO se agrega un segundo DP

#### Scenario: Append no bloquea ante excepción de IDB

- **GIVEN** IDB está en estado que arroja `QuotaExceededError` en `put`
- **WHEN** `SimulacroViewModel.setAlt(1, "A")` invoca `auditLog.append({ e:"MK", ... })`
- **THEN** `setAlt` retorna sin lanzar excepción
- **AND** la app continúa funcionando normalmente

### Requirement: REQ-AL-03 — Storage local y rotación diaria

Los eventos SHALL persistir en IndexedDB en una DB dedicada llamada `fiovi-audit-log` con un único object store `events`. Cada evento se guarda con una key derivada del timestamp y un contador para preservar orden.

El adapter SHALL calcular un `dayKey` en formato `YYYY-MM-DD` usando la timezone LOCAL del dispositivo (via `Date` estándar, sin ninguna librería de fecha adicional).

Al invocar `append(event)`:
1. Calcular `currentDayKey`.
2. Comparar contra el `dayKey` del último evento almacenado (o del meta store).
3. Si difieren → invocar `clearDay()` internamente (wipe del store) antes de escribir.
4. Escribir el evento nuevo con el `currentDayKey`.

`AuditLogStore.currentDayBatch()` SHALL retornar todos los eventos almacenados en orden cronológico ascendente.

`AuditLogStore.clearDay(dayKey?: string)` SHALL borrar todos los eventos. Si `dayKey` es provisto y difiere del `currentDayKey`, el método SHALL no-op (protege contra clears cross-day accidentales).

No hay cap de tamaño explícito ni retención > 1 día. El límite operativo lo pone el navegador (quota) y la rotación diaria.

#### Scenario: append en día 1 escribe sin wipe

- **GIVEN** IDB vacío
- **WHEN** se invoca `append({ e:"AO", cold:1 })`
- **THEN** `currentDayBatch()` contiene el evento y ningún otro

#### Scenario: append en día 2 dispara wipe automático de día 1

- **GIVEN** IDB tiene eventos con `dayKey="2026-08-25"` y hoy es `2026-08-26`
- **WHEN** se invoca `append({ e:"AO", cold:1 })` (el primer evento del día 2)
- **THEN** `currentDayBatch()` contiene SOLO el evento nuevo
- **AND** los eventos del día 1 fueron eliminados del store

#### Scenario: currentDayBatch retorna orden cronológico

- **GIVEN** IDB tiene 3 eventos con timestamps 100, 200, 300
- **WHEN** se invoca `currentDayBatch()`
- **THEN** retorna array `[evt(100), evt(200), evt(300)]` en ese orden

#### Scenario: clearDay con dayKey diferente al actual no borra nada

- **GIVEN** IDB tiene eventos del día `2026-08-26`
- **WHEN** se invoca `clearDay("2026-08-25")`
- **THEN** los eventos del `2026-08-26` permanecen intactos

### Requirement: REQ-AL-04 — Descarga desde profile

`ProfilePage` SHALL renderizar al final del menú un item con texto `"Descargar logs"` usando el mismo componente/clase (`menu-item`) que los items existentes (Historial, Configuración, Ayuda, Actualizaciones, Acerca de). En esta rama (Fase 0) el item es SIEMPRE visible — sin gating por feature flag ni por rol de usuario. NO se agrega divisor ni sección separada.

Click en el item SHALL:
1. Invocar `AuditLogStore.currentDayBatch()`.
2. Serializar los eventos a NDJSON (una línea JSON por evento, terminada en `\n`).
3. Crear un `Blob` con `type: "application/x-ndjson"`.
4. Disparar la descarga con filename `fiovi-audit-YYYY-MM-DD.ndjson` (donde YYYY-MM-DD es el `currentDayKey` local).
5. Mostrar un toast de éxito `"Logs descargados"` — reutilizando el sistema de toasts existente.

Si `currentDayBatch()` retorna array vacío, el item SHALL mostrar el toast `"Sin logs para hoy"` y NO disparar descarga.

#### Scenario: Click descarga NDJSON del día

- **GIVEN** `currentDayBatch()` retorna 3 eventos
- **WHEN** el usuario click en "Descargar logs"
- **THEN** el navegador dispara download de un archivo `.ndjson` con las 3 líneas JSON

#### Scenario: Click sin eventos muestra toast informativo

- **GIVEN** `currentDayBatch()` retorna array vacío
- **WHEN** el usuario click en "Descargar logs"
- **THEN** aparece toast "Sin logs para hoy"
- **AND** el navegador NO dispara ninguna descarga

#### Scenario: Item siempre visible en esta rama

- **GIVEN** `ProfilePage` se renderiza para cualquier usuario (student o tutor)
- **WHEN** el template evalúa la sección de menú
- **THEN** el item "Descargar logs" aparece SIEMPRE al final del menú, con el mismo estilo `menu-item` que los items existentes

### Requirement: REQ-AL-05 — Formato del payload y diccionarios

El payload SHALL ser NDJSON (una línea JSON por evento, separadas por `\n`, sin JSON array wrapping).

Cada evento SHALL usar keys de 1-3 caracteres para minimizar tamaño (`t`, `e`, `s`, `q`, `a`, `m`, `u`, `st`, `dur`, `c`, `d`, `v`, `o`, `cold`, `mode`, `ram`, `cores`, `screen`, `dpr`).

Los diccionarios `ENDPOINT_IDS`, `ERROR_CODE_IDS`, `METHOD_IDS` SHALL vivir en `src/L3_periphery/telemetry/audit-log-dictionaries.ts` como `const` exports:

- `ENDPOINT_IDS`: cubre TODOS los helpers exportados por `src/L3_periphery/http/api-paths.ts`. Cada endpoint tiene un ID numérico único. Un test SHALL verificar que cada helper de `api-paths` tiene entrada en `ENDPOINT_IDS`.
- `ERROR_CODE_IDS`: cubre todos los códigos `code` server documentados en L2/L3 (grep de literales string). Nuevos códigos que aparezcan sin entrada en el diccionario SHALL resolverse al ID `0` (unknown) sin lanzar excepción.
- `METHOD_IDS`: `{ GET:1, POST:2, PUT:3, DELETE:4, PATCH:5 }`.

Ningún evento SHALL contener strings de dominio libres, response bodies, headers, cookies, tokens, emails, ni respuestas del examen. Los valores permitidos son:
- Timestamps numéricos.
- IDs numéricos de los diccionarios.
- Códigos alfanuméricos cortos (event codes: `"H"`, `"MK"`, `"SS"`, etc.).
- Alternativas de examen (`"A"`, `"B"`, `"C"`, `"D"`, `"E"`, `"0"`).
- SessionId truncado a últimos 8 chars.
- Números primitivos (marks count, status HTTP, duration ms, RAM, cores, DPR).
- Strings pequeños de enum (`"standalone"`, `"prompt-accepted"`, `"390x844"`).

#### Scenario: NDJSON separado por newlines

- **GIVEN** IDB tiene 3 eventos
- **WHEN** el serializer produce el archivo
- **THEN** el contenido es 3 líneas JSON, cada una parseable independientemente con `JSON.parse`
- **AND** el archivo NO empieza con `[` ni termina con `]`

#### Scenario: Endpoint no catalogado resuelve a 0

- **GIVEN** un adapter llama `http.get(url)` sin `ENDPOINT_ID_TOKEN` en el context
- **WHEN** el interceptor procesa la request
- **THEN** el evento H tiene `u:0`

#### Scenario: Error code no catalogado resuelve a 0

- **GIVEN** el back responde 500 con body `{ code: "UNKNOWN_FUTURE_ERROR" }`
- **WHEN** el interceptor extrae el código
- **THEN** el evento H tiene `st:500` y `c:0`
- **AND** el interceptor NO lanza excepción

#### Scenario: No hay PII en ningún evento

- **GIVEN** el alumno completó un flujo típico (login, ver exámenes, marcar 10, submit)
- **WHEN** se serializa `currentDayBatch()` a NDJSON
- **THEN** el contenido NO incluye ningún email (regex `[a-z]+@[a-z]+`)
- **AND** NO incluye ningún token (regex `Bearer|Authorization`)
- **AND** NO incluye ningún nombre de usuario o slug de tenant literal
- **AND** NO incluye ningún response body JSON del back

### Requirement: REQ-AL-06 — Puente diseñado a Fase 1

`AuditLogStore` SHALL exponer `currentDayBatch()` y `clearDay(dayKey?)` como parte de su API pública. Estos métodos son consumidos hoy por el botón de descarga en `/profile` y en Fase 1 futura por un `AuditLogUploadDispatcher` (fuera de scope de este change).

El schema de eventos (10 tipos con keys cortas) SHALL ser estable respecto a Fase 1: el mismo formato NDJSON que se descarga hoy es el que se envía gzipped al back mañana. Ningún consumidor futuro debe requerir cambios al store ni a los diccionarios existentes (podrán extenderse con endpoints nuevos, pero no reindexarse).

#### Scenario: currentDayBatch es consumible por múltiples clientes

- **GIVEN** `AuditLogStore` con eventos guardados
- **WHEN** dos consumidores distintos invocan `currentDayBatch()` en secuencia
- **THEN** ambos reciben el mismo array de eventos
- **AND** `currentDayBatch()` NO consume ni borra los eventos (idempotente y read-only)

#### Scenario: Firma de clearDay es forward-compatible

- **GIVEN** `AuditLogStore.clearDay` con signatura `(dayKey?: string) => Promise<void>`
- **WHEN** se invoca sin argumento (uso interno de rotación)
- **THEN** borra todos los eventos del día actual
- **WHEN** se invoca con `dayKey` explícito (uso futuro de "confirmé el upload del día X")
- **THEN** borra solo si `dayKey === currentDayKey`, no-op en caso contrario
