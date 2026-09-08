# audit-log-capture Specification

## Purpose

Registra en el dispositivo del alumno una traza forense de lo que hizo la app —requests HTTP, marcaciones, cambios de visibilidad, cortes de red, auto-envíos— y la sube al back en paquetes sellados. Existe para responder el reclamo "marqué X y no aparece en mi nota", que hasta ahora quedaba ciego porque learnex borra el `submit-progress-snapshot` al finalizar el examen.

La captura es best-effort y sin PII: nunca bloquea al llamador, nunca propaga excepciones, y no guarda emails, nombres, tokens, cookies, response bodies ni respuestas del examen.

**Nota sobre el alcance real (2026-09-08).** Este spec describe lo que quedó en el repo al cerrar el change `add-audit-log-local-capture`, no el plan original. Dos desvíos importantes respecto de la propuesta inicial:

- Los eventos `MK` (una entrada por marcación) se implementaron y **después se revirtieron**: eran redundantes con los `H` del draft, que ya llevan el conteo de marcas. No buscar ese código, no reintroducirlo.
- La Fase 1 (subida al back) **dejó de ser trabajo futuro** y forma parte del sistema — ver REQ-AL-06.

## Requirements

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
- **THEN** el store contiene un evento con `e:"H"`, `m:1`, `u:<ENDPOINT_IDS.studentExamSessions>`, `st:200`, `dur:142`

#### Scenario: POST con 429 genera H con código de error extraído del body

- **GIVEN** un adapter llama `http.post(apiPath.submit(slug, id), body, { context: ... })`
- **WHEN** el back responde 429 con body `{ code: "TOO_MANY_REQUESTS", message: "..." }`
- **THEN** el evento H tiene `st:429` y `c:<ERROR_CODE_IDS.TOO_MANY_REQUESTS>`
- **AND** el evento H NO contiene el campo `message` ni ningún string humano del error

#### Scenario: Request sin marca de HttpContext cae en endpoint unknown

- **GIVEN** una request sale sin `HttpContext().set(ENDPOINT_ID_TOKEN, ...)`
- **WHEN** el interceptor la procesa
- **THEN** el evento H tiene `u:0`

#### Scenario: Error de red emite H y NW

- **GIVEN** el dispositivo perdió conexión
- **WHEN** una request falla con `HttpErrorResponse` de `status === 0`
- **THEN** el store contiene un evento `H` con `st:0`
- **AND** contiene además un evento `{ e:"NW", u }`

#### Scenario: Snapshot de draft lleva el conteo de marcas

- **GIVEN** el dispatcher de draft arma la request con `MARKS_COUNT_TOKEN = 12`
- **WHEN** el interceptor procesa la request
- **THEN** el evento H incluye `d:12`

### Requirement: REQ-AL-02 — Captura de eventos de aplicación

El adapter SHALL emitir eventos no-HTTP en los siguientes puntos:

- **`SS`**: al abrir una sesión de examen (primer render del view-model con `sessionId` cargado). Evento: `{ t, e:"SS", s }`.
- **`VC`**: al recibir `document.visibilitychange`. Evento: `{ t, e:"VC", v }` donde `v:0` cuando `document.visibilityState === 'hidden'`, `v:1` cuando `'visible'`.
- **`OF`**: al recibir `window.online` u `offline`. Evento: `{ t, e:"OF", o }` donde `o:0` offline, `o:1` online.
- **`AO`**: al primer bootstrap de la app en el día. Evento: `{ t, e:"AO", cold }` donde `cold:1` cold-start, `cold:0` warm.
- **`AI`**: en 2 momentos:
  - Al detectar `window.matchMedia('(display-mode: standalone)').matches === true` al bootstrap → `{ t, e:"AI", mode:"standalone" }` (1× por día).
  - Al recibir evento `window.appinstalled` → `{ t, e:"AI", mode:"prompt-accepted" }` (one-shot).
- **`DP`**: 1× por día, junto al primer `AO`. Evento: `{ t, e:"DP", ram, cores, screen, dpr }` donde `ram` = `navigator.deviceMemory` (número o `null`), `cores` = `navigator.hardwareConcurrency` (número o `null`), `screen` = `"{width}x{height}"` (viewport en px), `dpr` = `window.devicePixelRatio`.
- **`RT`**: cuando `credentialsInterceptor` dispara refresh en 401. Evento: `{ t, e:"RT", st, c? }` donde `st` es el status del `/refresh` y `c` el código si falló.
- **`AS`**: JUSTO ANTES del POST de auto-envío. Se emite tanto en modo tarea (setTimeout local del view-model) como en modo examen (via callback `onFire` del `ProgramarAutoEnvioUseCase`). Evento: `{ t, e:"AS", s }` donde `s` es el sessionId truncado. Permite distinguir el submit manual (click Enviar → solo aparece `H` con `u:21`) del auto-submit (aparece `AS` seguido de `H` con `u:21` casi al mismo tiempo).
- **`CLK`**: calibración de reloj. Emitido desde `HttpExamsApi.getTodaysExams()` a lo sumo 1 vez cada 4h por instancia de app, y solo cuando el offset (`srv - t`) cambió más de 500ms respecto del último emitido. Evento: `{ t, e:"CLK", srv }`. El consumidor reconstruye `offset = srv - t` y `realT = t + offset`, que es lo que permite ubicar los demás eventos en tiempo real cuando el reloj del dispositivo está corrido.

El set de tipos de evento SHALL ser exactamente `SS | H | NW | VC | OF | RT | AO | AI | DP | AS | CLK` (11 tipos), expuesto como `EventCode = AuditLogEvent['e']`.

Todos los `append` SHALL ser fire-and-forget: nunca bloquean al llamador. Excepciones (incluso `QuotaExceededError`) SHALL ser cachadas silenciosamente sin propagar.

Ninguno de los eventos SHALL contener PII (emails, nombres, tokens, cookies, response bodies, respuestas del examen).

#### Scenario: visibilitychange dispara VC

- **GIVEN** los listeners están registrados
- **WHEN** `document.visibilityState` pasa a `"hidden"` y se dispara `visibilitychange`
- **THEN** el store contiene `{ e:"VC", v:0 }`

#### Scenario: online/offline dispara OF

- **GIVEN** los listeners están registrados
- **WHEN** `window` recibe evento `offline`
- **THEN** el store contiene `{ e:"OF", o:0 }`

#### Scenario: Cold app-open emite AO con cold:1

- **GIVEN** primer bootstrap de la app en el navegador (sin previa sesión warm)
- **WHEN** `AppInitializer` corre
- **THEN** el store contiene `{ e:"AO", cold:1 }`

#### Scenario: PWA standalone emite AI standalone

- **GIVEN** `window.matchMedia('(display-mode: standalone)').matches === true`
- **WHEN** `AppInitializer` corre
- **THEN** el store contiene `{ e:"AI", mode:"standalone" }`

#### Scenario: appinstalled dispara AI prompt-accepted

- **GIVEN** la PWA no está instalada y el usuario acepta el prompt de instalación
- **WHEN** `window` recibe evento `appinstalled`
- **THEN** el store contiene `{ e:"AI", mode:"prompt-accepted" }`

#### Scenario: AS se emite antes del POST de auto-submit en modo examen

- **GIVEN** `SimulacroPageViewModel` con sesión activa `sessionId = "abc12345"` en modo examen (no tarea)
- **AND** el auto-envío está programado via `ProgramarAutoEnvioUseCase`
- **WHEN** el timer del use case dispara
- **THEN** `ProgramarAutoEnvioUseCase` invoca `input.onFire?.()` ANTES de llamar `enviar.execute()`
- **AND** el callback del view-model emite `{ e:"AS", s:"abc12345" }` al audit-log
- **AND** el evento `AS` aparece en el store ANTES del evento `H` con `u:21` correspondiente

#### Scenario: AS se emite antes del POST de auto-submit en modo tarea

- **GIVEN** `SimulacroPageViewModel` con sesión activa en modo tarea (`exam.esTarea() === true`)
- **AND** `scheduleAutoEnvio` programó un `setTimeout` local para el cierre personal
- **WHEN** el `setTimeout` dispara
- **THEN** el callback emite `{ e:"AS", s }` ANTES de invocar `this.submit()`

#### Scenario: CLK se emite solo cuando el offset cambió lo suficiente

- **GIVEN** ya se emitió un `CLK` con un offset dado hace menos de 4h
- **WHEN** `getTodaysExams()` vuelve a resolver con un offset que difiere en menos de 500ms
- **THEN** NO se emite un segundo `CLK`

#### Scenario: DP se emite 1× por día

- **GIVEN** bootstrap del día
- **WHEN** `AppInitializer` corre
- **THEN** el store contiene exactamente 1 evento `{ e:"DP", ram, cores, screen, dpr }`
- **AND** si el usuario recarga la app en el mismo día, NO se agrega un segundo DP

#### Scenario: Append no bloquea ante excepción de IDB

- **GIVEN** IDB está en estado que arroja `QuotaExceededError` en `put`
- **WHEN** un llamador invoca `auditLog.append({ e:"SS", ... })`
- **THEN** el llamador retorna sin lanzar excepción
- **AND** la app continúa funcionando normalmente

### Requirement: REQ-AL-03 — Storage local y retención

Los eventos SHALL persistir en IndexedDB en una DB dedicada llamada `fiovi-audit-log` (version 2) con tres object stores: `events` (autoIncrement), `meta` (kv) y `packages` (paquetes sellados listos para subir).

El adapter SHALL calcular un `dayKey` en formato `YYYY-MM-DD` usando la timezone LOCAL del dispositivo (via `Date` estándar, sin ninguna librería de fecha adicional).

**La retención es "hasta que se suban", con un techo de `MAX_AGE_DAYS = 7`.** El modelo original de Fase 0 —borrar todo el store en el primer `append` de cada día— SHALL NOT usarse: como los listeners emiten un `AO` al arrancar, ese append disparaba la rotación y el alumno que cerraba la app a la noche perdía lo no subido antes de que el dispatcher pudiera correr. La pérdida no era una carrera improbable, era segura.

En su lugar:

1. Un evento vive hasta que se confirma que llegó al back (borrado del paquete que lo contiene).
2. `pruneExpired(now)` SHALL borrar eventos y paquetes más viejos que `MAX_AGE_DAYS`. Existe para acotar el IndexedDB cuando las subidas fallan de forma sostenida (sin conexión, backend caído, cliente sin compresión), no como política de negocio.
3. La poda SHALL dispararse con el cambio de day-key en `meta` — el mismo mecanismo barato de antes, que corre como mucho una vez por día y no necesita scheduler.

`append` SHALL encolar serialmente los escritos (`tail`). Sin esa cola, varios appends disparados de corrido (el arranque emite `AO` + `DP` + `AI` casi en el mismo tick) leen el day-key antes de que el primero lo actualice, todos creen que les toca podar, y una poda puede pasar por encima de un evento recién escrito. Encadenarlos es además lo que garantiza que el orden de inserción sea el cronológico.

La API pública del store SHALL ser: `append`, `currentDayBatch`, `eventsInRange(sinceMs, untilMs)` (half-open), `pendingEvents`, `sealPackage(pkg, eventKeys)`, `pendingPackages`, `deletePackage(batchId)`, `pruneExpired`.

#### Scenario: un evento no subido sobrevive al cambio de día

- **GIVEN** el store tiene eventos del día `2026-08-25` que nunca se subieron
- **WHEN** la app arranca el `2026-08-26` y emite su primer `AO`
- **THEN** los eventos del `2026-08-25` siguen en el store
- **AND** quedan disponibles para el próximo intento de subida

#### Scenario: la poda borra lo que pasó el techo de edad

- **GIVEN** el store tiene eventos con más de 7 días de antigüedad
- **WHEN** se invoca `pruneExpired(now)`
- **THEN** esos eventos y sus paquetes fueron eliminados
- **AND** los más nuevos que el corte permanecen intactos

#### Scenario: currentDayBatch retorna orden cronológico

- **GIVEN** IDB tiene 3 eventos con timestamps 100, 200, 300
- **WHEN** se invoca `currentDayBatch()`
- **THEN** retorna array `[evt(100), evt(200), evt(300)]` en ese orden

#### Scenario: appends concurrentes no se pisan

- **GIVEN** el arranque emite `AO`, `DP` y `AI` en el mismo tick
- **WHEN** los tres `append` corren
- **THEN** los tres eventos quedan en el store
- **AND** ninguna poda borró a otro append de la misma tanda

### Requirement: REQ-AL-04 — Salidas manuales desde profile

`ProfilePage` SHALL exponer dos salidas manuales, ambas como `menu-item` con el mismo estilo que el resto del menú y sin divisor ni sección separada.

**"Descargar logs"** — baja el NDJSON crudo del día al dispositivo. Es una herramienta de diagnóstico local, así que SHALL estar gateada por `!environment.production`: nunca aparece en un build de producción. El gate es contra `production` y no contra `devTools` porque `devTools` sale del `.env` de la VM de prod, que desde el repo no se puede verificar.

Click SHALL: invocar el batch del día, serializar a NDJSON (una línea JSON por evento, terminada en `\n`), crear un `Blob` con `type: "application/x-ndjson"`, disparar la descarga con filename `fiovi-audit-YYYY-MM-DD.ndjson`, y mostrar toast `"Logs descargados"`. Con el batch vacío SHALL mostrar `"Sin logs para hoy"` y NO disparar descarga.

**"Soporte"** — sella lo pendiente y drena la cola contra el back, para cuando el alumno reclama y sus logs de las últimas horas todavía no salieron por el ciclo normal. SHALL estar gateado por `role() === 'student'`: el endpoint es `student/...` y learnex responde 404 a quien no sea alumno vinculado, con lo cual a un tutor solo podría mostrarle el estado de error.

El flujo SHALL pedir confirmación antes de mandar, aplicar un cooldown de 10 minutos entre envíos exitosos, y **mirar el resultado** de la subida en vez de asumir éxito por ausencia de excepción: la subida es best-effort y no lanza nunca, así que un `await` a secas siempre parecería exitoso. En particular, un resultado `ok` con `sent === 0` significa que el back rechazó el paquete y se descartó — SHALL reportarse como error, no como enviado.

#### Scenario: Click descarga NDJSON del día

- **GIVEN** el batch del día tiene 3 eventos
- **WHEN** el usuario click en "Descargar logs"
- **THEN** el navegador dispara download de un archivo `.ndjson` con las 3 líneas JSON

#### Scenario: Click sin eventos muestra toast informativo

- **GIVEN** el batch del día está vacío
- **WHEN** el usuario click en "Descargar logs"
- **THEN** aparece toast "Sin logs para hoy"
- **AND** el navegador NO dispara ninguna descarga

#### Scenario: "Descargar logs" no existe en producción

- **GIVEN** un build con `environment.production === true`
- **WHEN** `ProfilePage` renderiza el menú
- **THEN** el item "Descargar logs" NO aparece

#### Scenario: el tutor no ve "Soporte"

- **GIVEN** `ProfilePage` se renderiza para un usuario con `role() === 'tutor'`
- **WHEN** el template evalúa el menú
- **THEN** el item "Soporte" NO aparece
- **AND** para `role() === 'student'` SÍ aparece

#### Scenario: paquete descartado por el back no se reporta como enviado

- **GIVEN** el usuario confirma el envío desde el modal de Soporte
- **WHEN** la subida retorna `{ status:'ok', sent:0 }` porque el back rechazó el paquete
- **THEN** el modal muestra el estado de error
- **AND** NO se marca el cooldown

### Requirement: REQ-AL-05 — Formato del payload y diccionarios

El payload SHALL ser NDJSON (una línea JSON por evento, separadas por `\n`, sin JSON array wrapping).

Cada evento SHALL usar keys de 1-4 caracteres para minimizar tamaño (`t`, `e`, `s`, `m`, `u`, `st`, `dur`, `c`, `d`, `v`, `o`, `srv`, `cold`, `mode`, `ram`, `cores`, `screen`, `dpr`).

Los diccionarios `ENDPOINT_IDS`, `ERROR_CODE_IDS`, `METHOD_IDS` SHALL vivir en `src/L3_periphery/telemetry/audit-log-dictionaries.ts` como `const` exports:

- `ENDPOINT_IDS`: cubre TODOS los helpers exportados por `src/L3_periphery/http/api-paths.ts`. Cada endpoint tiene un ID numérico único. Un test SHALL verificar que cada helper de `api-paths` tiene entrada en `ENDPOINT_IDS`.
- `ERROR_CODE_IDS`: cubre todos los códigos `code` server documentados en L2/L3. Nuevos códigos que aparezcan sin entrada en el diccionario SHALL resolverse al ID `0` (unknown) sin lanzar excepción.
- `METHOD_IDS`: `{ GET:1, POST:2, PUT:3, DELETE:4, PATCH:5 }`.

Los IDs de los diccionarios SHALL poder extenderse con entradas nuevas, pero NOT reindexarse: un log viejo tiene que seguir siendo legible con el diccionario nuevo.

Ningún evento SHALL contener strings de dominio libres, response bodies, headers, cookies, tokens, emails, ni respuestas del examen. Los valores permitidos son:

- Timestamps numéricos.
- IDs numéricos de los diccionarios.
- Códigos alfanuméricos cortos (event codes: `"H"`, `"SS"`, `"CLK"`, etc.).
- SessionId truncado a últimos 8 chars.
- Números primitivos (marks count, status HTTP, duration ms, RAM, cores, DPR).
- Strings pequeños de enum (`"standalone"`, `"prompt-accepted"`, `"390x844"`).

#### Scenario: NDJSON separado por newlines

- **GIVEN** el store tiene 3 eventos
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
- **WHEN** se serializa el batch a NDJSON
- **THEN** el contenido NO incluye ningún email (regex `[a-z]+@[a-z]+`)
- **AND** NO incluye ningún token (regex `Bearer|Authorization`)
- **AND** NO incluye ningún nombre de usuario o slug de tenant literal
- **AND** NO incluye ningún response body JSON del back

### Requirement: REQ-AL-06 — Subida al back (Fase 1)

Los eventos capturados SHALL subirse a `POST /t/{slug}/student/telemetry/audit-log-batch` (helper `apiPaths.auditLogBatch`), en paquetes sellados y comprimidos.

**Sellado.** `AuditLogUploadDispatcherService` SHALL partir lo pendiente en paquetes que no superen `MAX_PACKAGE_BYTES = 48KB` (contra el tope de 64KB del contrato server) y sellarlos con `sealPackage`. El `batchId` SHALL asignarse AL SELLAR, no en cada intento de subida: si se generara uno nuevo por intento, un reintento mandaría los mismos eventos con otro id y el dedup del back —que es por `batchId`— no serviría de nada, con lo que un POST que llega pero cuya respuesta se pierde termina en dos filas.

**Compresión.** El payload SHALL viajar como base64 de gzip (`enc:'gzip'`) cuando `CompressionStream` está disponible, y como base64 del NDJSON crudo (`enc:'none'`) cuando no lo está — en ese caso comprime el server.

**Reintentos.** Un fallo de red o de servidor SHALL NOT borrar el paquete: el próximo ciclo reintenta el mismo `batchId` y el back deduplica. Solo SHALL descartarse un paquete cuando el problema es el paquete mismo —status `400`, `413`, `422`—, porque reenviar exactamente los mismos bytes no puede dar otro resultado. `401`, `403` y `404` SHALL conservarse: hablan del estado del sistema, no del payload, y ese estado cambia (un 403 puede ser una migración de permisos sin aplicar; un 404 de alumno no vinculado se arregla cuando lo vinculan). Descartarlos tiraría justo los logs del período en que algo estaba mal configurado, que es cuando más falta hacen. Lo retenido queda acotado por el techo de 7 días.

**Cadencia.** `AuditLogUploadScheduler` SHALL subir con una cadencia base de 5 horas, sorteando el momento dentro de una ventana de dispersión de 30 minutos, con la cita persistida en `localStorage` (absoluta, no un `setTimeout`: un timer en memoria muere al cerrar la app, y re-sortear desde cero en cada apertura haría que alguien que entra y sale seguido no suba nunca). SHALL además hacer flush al ocultarse la app, y SHALL callarse por completo mientras hay un examen en curso (`ExamActivity.isActive()`): el alumno rindiendo no ve un solo request de telemetría.

**Concurrencia.** `uploadPending()` SHALL coordinarse con la Web Locks API (`navigator.locks`) para que dos pestañas del mismo origen —o dos ticks del propio intervalo— no suban el mismo rango dos veces.

**Sin feature flag.** El arranque del scheduler SHALL NOT estar detrás de una variable de entorno. El flag `AUDIT_LOG_UPLOAD_ENABLED` que existió gateaba únicamente este arranque, no el camino manual de "Soporte" (que llama `flushNow()` directo sobre el mismo servicio), con lo cual apagaba la mitad de lo que decía apagar. El rollout lo gobierna la promoción de ramas.

#### Scenario: un paquete que no llegó se reintenta con el mismo batchId

- **GIVEN** un paquete sellado con `batchId = "b-1"` cuya subida falló por red
- **WHEN** el siguiente ciclo vuelve a intentar
- **THEN** se envía el mismo `batchId = "b-1"`
- **AND** el back deduplica y queda una sola fila

#### Scenario: un 422 descarta el paquete y un 404 no

- **GIVEN** un paquete pendiente
- **WHEN** el back responde `422`
- **THEN** el paquete se elimina del store
- **WHEN** en cambio el back responde `404`
- **THEN** el paquete permanece pendiente para el próximo ciclo

#### Scenario: no se sube nada durante un examen

- **GIVEN** `ExamActivity.isActive()` retorna `true`
- **WHEN** el heartbeat del scheduler corre
- **THEN** no se dispara ninguna subida
- **AND** lo pendiente queda en IndexedDB para después

#### Scenario: dos pestañas no suben el mismo rango

- **GIVEN** dos pestañas del mismo origen con la app abierta
- **WHEN** ambas invocan `uploadPending()` a la vez
- **THEN** una toma el lock y sube
- **AND** la otra retorna `{ status:'busy' }` sin enviar nada

#### Scenario: sin CompressionStream el payload viaja en claro y comprime el server

- **GIVEN** un navegador sin `CompressionStream`
- **WHEN** el dispatcher arma el paquete
- **THEN** el payload va como base64 del NDJSON con `enc:'none'`
- **AND** el server lo guarda comprimido
