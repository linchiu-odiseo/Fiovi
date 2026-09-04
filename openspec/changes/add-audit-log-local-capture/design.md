> **Revised 2026-09-04.** See section "Revision Log" at bottom for the design pivot.

## Context

Fase 0 del audit-log de Fiovi. El objetivo es capturar en el dispositivo del alumno una traza mínima pero completa de todo lo que le pasa a Fiovi (peticiones HTTP + eventos de aplicación) para poder responder reclamos post-facto del tipo "marqué X y no aparece nota".

La motivación clave — documentada en la memoria `backend-borra-snapshot-al-finalizar` — es que learnex borra el `submit-progress-snapshot` cuando el alumno finaliza el examen. Los access logs del back solo tienen la línea del HTTP, no el body. Sin instrumentación cliente-side, un reclamo días después del examen queda sin evidencia reconstruible.

Este change **solo** hace captura local + descarga manual. Sin backend, sin upload, sin feature flag, sin cohort. Fase 1 futura agregará upload gzipped al back con `AuditLogUploadDispatcher` que consumirá los mismos métodos públicos del `AuditLogStore` — el diseño garantiza que Fase 1 sea "sumar un consumer nuevo", no rediseñar el store.

Restricciones que no se mueven:
- Arquitectura hexagonal estricta L1/L2/L3/LR (ESLint enforza imports, `hexagonal-guard` audita el resto).
- L1 y L2 no se tocan (instrumentación es infra L3 pura).
- Cero PII en los eventos capturados (regla operativa, no técnica).
- Regla #3 del CLAUDE.md: errores por `(status, endpoint, code)` — nunca por `message`.

## Goals / Non-Goals

**Goals:**
- Instrumentar TODA request HTTP saliente con un interceptor genérico + `HttpContext`, capturando endpoint, status, duration y código de error.
- Instrumentar eventos de aplicación (marcaciones, visibility, offline, app open, install, device profile, refresh token, network errors, session start).
- Persistir todo en IndexedDB local con rotación diaria automática (retención = 1 día).
- Ofrecer descarga NDJSON del día desde el menú de `/profile`.
- Dejar API del store lista para consumo futuro del dispatcher de Fase 1 (`currentDayBatch()`, `clearDay()`).
- Minimizar peso: keys cortas, IDs numéricos para endpoints/errores/métodos.
- Fire-and-forget: la instrumentación nunca bloquea el hilo de la request ni del examen.

**Non-Goals:**
- Backend: endpoint de upload, tabla, rollup, dashboard admin, detección de anomalías cross-user.
- Upload automático desde cliente.
- Compresión gzip (Fase 1).
- Feature flag build-time o runtime (esta rama es dev-only; se decide gating al promover a `develop`).
- Retención >1 día en local.
- Formato columnar pipe-delimited (NDJSON gana por analizabilidad; peso ya minúsculo).
- Cohort selectivo, canary release, telemetría de producto.
- Helpers `window.__audit`, script `tools/analyze-audit-log.mjs`, botón "vaciar logs", contador vivo en UI.
- I18n (es-PE hardcoded).
- Cross-midnight session handling (nadie examina a las 00:00 local).

## Decisions

### Decision 1: HttpContext + tokens para identificar endpoints, NO regex sobre URL

**Decisión:** cada adapter HTTP marca sus requests con `context: new HttpContext().set(ENDPOINT_ID_TOKEN, ENDPOINT_IDS.foo)`. El interceptor lee el token del context. Si no viene → `u:0` (unknown).

**Por qué:**
- Los paths de learnex son parametrizados: `/t/{slug}/students/me/exam-sessions/{id}/submit`. Un regex genérico contra la URL es frágil (mapear `{id}` a un placeholder, escapar el `{slug}`, mantener sincronía si cambia el orden de segmentos).
- `HttpContext` es la API idiomática de Angular para pasar metadata a interceptores. Introducirla acá establece el patrón para instrumentaciones futuras (analytics, tracing, etc.).
- Fallback `u:0` es una señal útil: los `H|u:0` en el log dicen "acá hay un endpoint sin catalogar" y aparecen en un análisis simple sin necesidad de estar mirando cada adapter.

**Alternativa descartada (A):** regex sobre la URL en el interceptor. Frágil, requiere mantener un catálogo de path templates paralelo al de `api-paths.ts`. Cada endpoint nuevo obliga a actualizar 2 lugares.

**Alternativa descartada (B):** wrapper genérico sobre `HttpClient` que sepa el endpoint ID. Rompería el patrón existente (todos los adapters usan `HttpClient` directo) y agregaría una capa de indirección.

### Decision 2: Interceptor chained DESPUÉS de `credentialsInterceptor`

**Decisión:** `withInterceptors([credentialsInterceptor, auditLogInterceptor])`.

**Por qué:**
- `credentialsInterceptor` maneja refresh en 401 con lock. Si el audit interceptor va antes, vería la request original y también la request de refresh como si fueran independientes → duplica eventos H y confunde la trazabilidad.
- Poniéndolo después, el audit ve el flujo final: el request original con su respuesta real (200 tras refresh exitoso, o 401 final si el refresh falló). El evento `RT` se emite desde el propio `credentialsInterceptor` (o desde un hook adyacente), no desde el audit interceptor.
- El `tap` del audit no transforma la observable: solo observa. Si el audit crashea, la request sigue.

**Alternativa descartada:** audit primero. Simplifica un caso (ver el request "puro") pero rompe el otro (ver el resultado real). El caso realista al diagnosticar reclamos es el segundo.

### Decision 3: Diccionarios como `const` en TypeScript, versionados con el bundle

**Decisión:** `ENDPOINT_IDS`, `ERROR_CODE_IDS`, `METHOD_IDS` son `const` exports en `src/L3_periphery/telemetry/audit-log-dictionaries.ts`. Nada en `.env`, nada remoto.

**Por qué:**
- Un diccionario en `.env` requeriría regenerar tipos, correr `build-env.mjs`, y sincronizar cliente-back para cada cambio. Overhead que no compensa: los IDs son un detalle interno del cliente.
- Los diccionarios se versionan junto con el código (git blame). Cuando llegue Fase 1 y el back deba resolver un ID, el back tendrá acceso al diccionario del bundle porque `AV` (app-version) llegará en cada batch — o directamente porque el back tendrá una copia.
- Nuevos endpoints agregan una línea al enum sin reindexar los existentes (IDs son estables).

**Alternativa descartada:** endpoint remoto `GET /me/telemetry-dict` que el cliente descarga al arrancar. Sobreingeniería para el volumen. Requiere back que no existe todavía.

### Decision 4: NDJSON, no formato columnar

**Decisión:** cada evento es una línea JSON completa. El archivo descargado es NDJSON puro (sin JSON array wrapping).

**Por qué:**
- El peso crudo estimado es 4-16 KB/día por alumno. Optimizar bytes con formato columnar (~15 bytes/evento vs 50) ahorraría <10 KB/día — irrelevante.
- NDJSON es analizable directo con `jq`, DuckDB, VS Code, y cualquier herramienta estándar de log analysis (Loki, ELK, etc.). El columnar necesita parser custom por cada consumidor.
- Post-gzip (Fase 1), ambos formatos convergen al mismo tamaño (gzip elimina exactamente las repeticiones que hacen pesado al NDJSON).
- Fase 0 se descarga crudo → NDJSON gana por analizabilidad inmediata.

**Alternativa descartada:** formato columnar pipe-delimited (`M|10|C`). Discutido a fondo en la conversación previa al proposal — descartado por complejidad de parsing vs ganancia marginal.

### Decision 5: Rotación diaria inline en `append`, sin scheduler dedicado

**Decisión:** `AuditLogStore.append` chequea el `dayKey` actual al inicio; si difiere del último almacenado → wipe. Sin `setInterval` que corra "a las 00:00".

**Por qué:**
- No requiere scheduler → cero riesgo de que se ejecute cuando el navegador está cerrado (los timers PWA no corren en background sin permisos especiales).
- El primer `append` del día es el trigger natural del wipe. Si el alumno no abre la app en 3 días, al abrirla el 4° día el primer evento del 4° día borra todo lo del 1°. Consistente.
- Naive `Date`-based comparison en local timezone es suficiente. El cross-midnight edge case es despreciable (nadie examina a las 00:00).

**Alternativa descartada:** `setInterval(rotateIfNeeded, 60_000)`. Overhead innecesario. Si el navegador está cerrado tampoco corre. Si está abierto y el alumno no interactúa, no hay eventos nuevos para preservar → wipe innecesario.

### Decision 6: Sin feature flag en Fase 0

**Decisión:** el código está siempre activo en la rama `feat/audit-log-fase-0`. Sin `.env`, sin `environment.auditLogEnabled`, sin `isAuditLogEnabled()`.

**Por qué:**
- Esta rama es dev-only. El alumno/tutor real no la ve.
- Toggle con constante en código = requiere PR + redeploy → misma fricción que revertir el change. No aporta.
- Toggle con localStorage = introduce UX (URL param `?audit=1`) que nadie va a usar cuando el único caso es "yo, el dev, quiero probar". Sobreingeniería para Fase 0.
- Cuando se promueva la rama a `develop`/`testing`/`main`, ahí se decide si hace falta gating. **En ese momento** un feature flag (localStorage o build-time) tiene sentido y el `design.md` de Fase 1 lo documentará.

**Alternativa descartada:** flag por localStorage con URL param. Discutido en conversación previa — user la descartó explícitamente por overhead.

### Decision 7: `MARKS_COUNT_TOKEN` via HttpContext (no via body inspection en el interceptor)

**Decisión:** `DraftAutoSaveDispatcher` setea `context.set(MARKS_COUNT_TOKEN, count)` en la request del snapshot. El interceptor lee el token y agrega `d:count` al evento H. NO parsea el body de la request.

**Por qué:**
- Parsear el body del snapshot en el interceptor requiere conocer el schema del payload (string compacto de longitud fija, per `design.md D12` de draft-auto-save). Acopla el interceptor al schema de una feature específica.
- Pasar el count via context es explícito, tipado, y ya lo tiene el dispatcher a mano cuando arma la request.
- Extensible: cuando otro adapter quiera reportar un count (ej. tutor endpoints que envían batch de estudiantes), setea el mismo token sin cambios al interceptor.

**Alternativa descartada:** el interceptor parsea el body cuando `u === ENDPOINT_IDS.studentSubmitProgressSnapshot`. Acoplamiento. Escala mal.

### Decision 8: `append` es fire-and-forget async

**Decisión:** `AuditLogStore.append(event): void` retorna inmediatamente. Internamente lanza una promesa a IDB pero no la `await`. Excepciones se cachan silenciosamente.

**Por qué:**
- El llamador (view-model del examen, interceptor de HTTP) NO puede permitirse esperar por IDB. Un dispositivo lento con IDB congestionado degradaría UX del examen.
- La telemetría es best-effort por diseño: si un evento se pierde por `QuotaExceededError` o timeout de IDB, el análisis del día pierde una línea pero la app sigue funcionando. Aceptable.
- Excepciones cachadas silenciosamente en Fase 0 es aceptable porque no hay upload que dependa de completitud. Cuando llegue Fase 1, el dispatcher medirá completitud comparando batch_size local vs esperado y decidirá.

**Alternativa descartada:** `append` retorna `Promise<void>` y el llamador debe manejar errores. Rompería la propiedad "no bloqueante" y agregaría boilerplate en cada callsite.

## Diagrama de flujo

### Bootstrap

```
app.config.ts → provideAppInitializer(auditLogListenersInitializer)
        │
        ▼
auditLogListenersInitializer()
        │
        ├──▶ listen document.visibilitychange → append VC
        ├──▶ listen window.online/offline    → append OF
        ├──▶ listen window.appinstalled      → append AI mode:prompt-accepted
        ├──▶ check display-mode standalone   → append AI mode:standalone (1× por día)
        ├──▶ compute device profile          → append DP (1× por día)
        └──▶ append AO {cold: 1|0}
```

### HTTP request (happy path)

```
Adapter foo
   http.get(url, { context: new HttpContext().set(ENDPOINT_ID_TOKEN, ENDPOINT_IDS.foo) })
        │
        ▼
credentialsInterceptor
   agrega withCredentials, maneja 401 refresh
        │
        ▼
auditLogInterceptor
   start = Date.now()
   endpointId = context.get(ENDPOINT_ID_TOKEN) ?? 0
   marks = context.get(MARKS_COUNT_TOKEN) ?? undefined
   sessionId = context.get(SESSION_ID_TOKEN) ?? undefined
        │
   next(req).pipe(tap:
        response → append H { m, u:endpointId, st, dur, c?, d?, s? }
        error    → append H (status=0 si NW) + append NW
   )
        │
        ▼
   backend / network
```

### Marcación

```
SimulacroViewModel.setAlt(q, a)
        │
        ├──▶ existing logic (markingsStorage.setMarking, signals update)
        │
        └──▶ auditLog.append({ e:"MK", s, q, a })   [fire-and-forget]
```

### Descarga desde profile

```
ProfilePage.onDescargarLogsClick()
        │
        ▼
serializer.downloadCurrentDay()
        │
        ├──▶ auditLog.currentDayBatch()   → AuditLogEvent[]
        │
        ├──▶ if events.length === 0 → toast "Sin logs para hoy", return
        │
        ├──▶ ndjson = events.map(JSON.stringify).join("\n") + "\n"
        │
        ├──▶ blob = new Blob([ndjson], { type: "application/x-ndjson" })
        │
        ├──▶ trigger download via anchor click
        │
        └──▶ toast "Logs descargados"
```

### Rotación diaria

```
auditLog.append(event)
        │
        ▼
   currentKey = todayLocalKey()   // "2026-08-25"
        │
        ▼
   storedKey = read meta from IDB
        │
        ├── if storedKey !== currentKey OR undefined
        │        │
        │        ├──▶ clearDay()   // wipe events store
        │        └──▶ write currentKey to meta
        │
        └──▶ put event in events store with { ts, seq }
```

## Slicing y plan de PR

**Un solo PR** (~350-450 LOC prod + ~200-250 LOC test). Justificación:
- El scope es cohesivo: los ~19 archivos afectados son todos parte del mismo flujo (adapter → interceptor → adapters marcados → hooks → profile item).
- Splitear en 2 PRs (adapter + interceptor primero, hooks + profile después) dejaría el primer PR sin valor observable (loguea todo pero no hay forma de ver los logs) y el segundo dependiente del primero.
- El total es <500 LOC prod → dentro del umbral aceptable de review (per memoria `chained-pr`, umbral es 400 LOC pero excepción justificada por cohesión).

**Orden de commits sugerido dentro del PR** (para facilitar bisect si algo rompe):
1. `feat(telemetry): AuditLogStore + tokens + dictionaries + tipos`.
2. `feat(telemetry): audit-log.interceptor con tap sobre HttpClient`.
3. `feat(telemetry): listeners globales VC/OF/AO/AI/DP`.
4. `feat(telemetry): marcar HttpContext.ENDPOINT_ID_TOKEN en 4 adapters HTTP`.
5. `feat(telemetry): MARKS_COUNT_TOKEN en draft-auto-save-dispatcher`.
6. `feat(telemetry): hook MK en simulacro.view-model`.
7. `feat(telemetry): item "Descargar logs" en profile`.
8. `chore(telemetry): wire providers en app.config.ts`.
9. `test(telemetry): specs de store, interceptor, serializer, listeners`.

## Testing strategy

**Unit tests (Vitest puro, sin Angular)** — `tests/unit/L3_periphery/telemetry/`:
- Diccionarios: `ENDPOINT_IDS` contiene entrada para cada helper de `api-paths.ts` (test parametrizado).
- Serializer: `serializeToNdjson` con 0, 1, N eventos produce output esperado.
- Day-key helper: `todayLocalKey()` retorna `YYYY-MM-DD` en local time.

**Feature tests (Vitest + jsdom + TestBed + fake-indexeddb)** — `tests/feature/L3_periphery/telemetry/`:
- `audit-log-store.spec.ts`:
  - `append` escribe evento en IDB.
  - `currentDayBatch` retorna eventos en orden cronológico.
  - Rotación: append en día 2 wipea eventos del día 1.
  - `clearDay` con dayKey diferente al actual no borra nada.
  - `append` no lanza ante `QuotaExceededError` (simulado).
- `audit-log-interceptor.spec.ts` (con `HttpTestingController`):
  - GET 200 → append H con m:1, st:200, dur:>0.
  - POST 429 con `code:TOO_MANY_REQUESTS` en body → append H con c:<ID>.
  - Request sin `ENDPOINT_ID_TOKEN` → append H con u:0.
  - Request con `MARKS_COUNT_TOKEN=12` → append H con d:12.
  - NetworkError (status 0) → append H con st:0 + append NW.
- `audit-log-serializer.spec.ts`:
  - `downloadCurrentDay` con 0 eventos muestra toast "Sin logs" y no dispara descarga.
  - `downloadCurrentDay` con N eventos crea blob NDJSON y dispara download.
- `audit-log-listeners.spec.ts`:
  - Dispatch de `visibilitychange` genera VC con v:0/v:1.
  - Dispatch de `window.dispatchEvent(new Event('offline'))` genera OF con o:0.

**No hay tests unitarios para L1/L2** porque este change no toca esas capas.

## Riesgos y mitigaciones

Ver `proposal.md` — no repetir acá.

## Migración y rollback

Ver `proposal.md` — no repetir acá.

## Puente a Fase 1

> SUPERSEDED (2026-09-04): esta sección describía el puente en términos de `currentDayBatch()` + `clearDay()` (day-granular). El Revision Log al final de este documento reemplaza el mecanismo concreto por `serializeSlice(sinceMs, untilMs)` + `clearRange(sinceMs, untilMs)` (slice-granular), necesario para un dispatcher que sube y confirma ventanas más chicas que "el día completo". El texto original queda abajo como registro histórico de la intención (upload gzip, dedup, feature flag), que no cambia — solo cambia la forma de la interfaz de puente.

Cuando se implemente Fase 1 (upload al back), la interfaz pública del `AuditLogStore` SHALL permanecer estable:

```ts
class AuditLogStore {
  append(event: AuditLogEvent): void;       // consumidor: interceptor + view-model + listeners
  currentDayBatch(): Promise<AuditLogEvent[]>;  // consumidor: ProfilePage (Fase 0), UploadDispatcher (Fase 1)
  clearDay(dayKey?: string): Promise<void>;     // consumidor: rotación interna (Fase 0), post-upload confirm (Fase 1)
}
```

El `AuditLogUploadDispatcher` de Fase 1 vivirá en `src/L3_periphery/telemetry/audit-log-upload-dispatcher.service.ts` y:
- Se registrará como `APP_INITIALIZER` o como side-effect en `AppInitializer`.
- Al arrancar la app, chequeará si hay un batch del día anterior (naive: `currentDayBatch()` con `dayKey != todayKey` = batch pendiente).
- Comprimirá con `CompressionStream('gzip')` nativo del navegador.
- Hará `POST /me/audit-log/batch` con `Content-Encoding: gzip`.
- Al confirmar 2xx del back, llamará `clearDay(dayKey)` explícito.

**Nada en el `AuditLogStore` cambia**. El schema de eventos permanece idéntico. Los diccionarios se extienden con endpoints nuevos pero no reindexan los existentes.

Feature flag de Fase 1 (opcional): localStorage con URL param `?audit=1` para canary + cohort seleccionado por back con `GET /me/flags`. Se decide en `design.md` de Fase 1.

## Revision Log — 2026-09-04

### Rationale

Se testeó Fase 0 con datos reales de una sesión de examen: ~11 KB en 8 minutos. Al inspeccionar el NDJSON, el volumen estaba dominado por eventos `MK` — una línea por cada click de marcación, incluyendo bursts de correcciones rápidas (ej. 100 clicks arreglando la pregunta 1 en pocos segundos). Un revisor senior de código, al ver estos datos, recomendó pivotear antes de mergear PR #77: `MK` es redundante porque los eventos `H` de draft ya disparan solo ante cambios reales de estado (el `draft-auto-save-dispatcher` tiene debounce + throttle incorporados), y esos eventos ya viajan con `d` (marks count). Lo único que faltaba para hacerlos suficientes como evidencia era saber QUÉ cambió, no solo CUÁNTO. De ahí Cambio 2 (v+chg).

### Updated event schema

- `MKEvent` se elimina del union `AuditLogEvent`. El código en `simulacro.view-model.ts` (setAlt/clearAlt) deja de emitir `MK`.
- `HEvent` gana dos campos opcionales, poblados SOLO para los endpoints de draft/submit:
  - `v?: number` — versión incremental scoped a `sessionId`. Arranca en 1, incrementa en cada draft exitoso. Resetea (vuelve a 1) cuando aparece un `sessionId` nuevo.
  - `chg?: readonly [number, string][]` — tuplas `[questionNumber, alternativaCode]` de SOLO las preguntas que cambiaron desde el último draft H emitido para esa sesión. `alternativaCode === "0"` significa que la pregunta fue borrada (clear).
- Reconstrucción de la composición completa en cualquier `v`: replay de todos los `chg` en orden desde `v:1` hasta la `v` objetivo, aplicando cada tupla como un upsert (o delete si `a==="0"`) sobre un mapa `questionNumber → alternativaCode`.
- El union pasa de 11 a 10 tipos: `SS | H | NW | VC | OF | RT | AO | AI | DP | AS`.

### Decision: batch-on-serialize, not batch-on-append

**Decisión:** `AuditLogStore.append` NO cambia — sigue escribiendo 1 registro por evento a IDB, fire-and-forget, sin timers ni buffers en memoria. El agrupamiento (batching) ocurre exclusivamente dentro de `AuditLogSerializer`, en el momento de producir el NDJSON de salida (descarga manual o `serializeSlice` para Fase 1). El agrupamiento junta eventos consecutivos por `(e, s?, ventana de tiempo de `windowMs`)` en una sola línea NDJSON con formato `{"t": baseline, "e": tipo, "s"?: session, "x": [[dt, ...campos], ...]}`.

**Por qué NO en append:**
- Bufferear en memoria y flushear con un timer (ej. cada 2s) introduce una ventana de pérdida de datos: si el usuario navega away o el tab se cierra (`pagehide`) dentro de esa ventana, los eventos bufferizados nunca llegan a IDB. El IDB write async del `pagehide` handler tampoco es confiable — varios navegadores lo cortan antes de que la promesa resuelva.
- El objetivo explícito de Fase 0 es "cero pérdida de datos" (ver Decision 8 original: fire-and-forget pero SIEMPRE hacia IDB, nunca hacia un buffer intermedio). Mover el batching a append rompería esa garantía por una ganancia de tamaño que de todos modos se logra igual en el momento de serializar.
- Batchear en serialize es más simple: no hay estado de buffer que sincronizar entre pestañas/tabs, no hay timers que limpiar, no hay riesgo de reordenar eventos si dos tabs escriben a la vez (IDB ya serializa eso).

**Alternativa descartada:** buffer en memoria en `AuditLogStore.append` con flush por tamaño o timer, más flush forzado en `pagehide`. Descartada por el riesgo de pérdida descrito arriba — el peso ganado (bytes) no justifica el riesgo perdido (completitud), que es el valor central del audit log.

### Decision: v+chg vive en el adapter L3, no en un puerto L1 nuevo

**Decisión:** el estado necesario para computar `v` y `chg` (`lastEmittedComposition: Map<sessionId, Map<questionNumber, alternativaCode>>` y `versionCounter: Map<sessionId, number>`) vive dentro de `HttpExamsApi.saveDraft` (L3), NO en un puerto L1 nuevo (`AuditLog`) ni en el use case `GuardarDraftUseCase` (L2).

**Por qué:**
- Se evaluó primero un puerto L1 `AuditLog { append(event) }` con el use case L2 llamándolo directamente. Requiere mover `AuditLogEvent` (y sus tipos) de L3 a L1 — viable porque son datos puros sin dependencias de framework, pero es un cambio de superficie mayor (mover tipos usados por interceptor, listeners, serializer, view-model) para un beneficio que no es necesario acá.
- La alternativa más liviana es que `GuardarDraftUseCase` (L2) sete `HttpContext` tokens antes de disparar la request. Pero **`HttpContext` es Angular-specific** (`@angular/common/http`) — importarlo en L2 viola la regla dura del proyecto de que L1/L2 son TypeScript puro, cero `@angular/*` (CLAUDE.md regla #2, `architecture-rules.md`).
- Resolución: el estado de versión/delta se calcula donde YA se puede tocar `HttpContext` sin romper boundaries: el adapter HTTP L3 (`HttpExamsApi.saveDraft`). Este adapter inyecta `MarkingsStorage` (puerto L1 que YA existe y ya se inyecta en otros lugares del código, ej. `simulacro.view-model.ts`) para leer la composición actual de marcaciones, compara contra `lastEmittedComposition` para esa sesión, computa el delta (`chg`), incrementa `versionCounter`, y setea `DRAFT_VERSION_TOKEN` + `DRAFT_DELTA_TOKEN` en el `HttpContext` de la request antes de dispararla. El `audit-log.interceptor.ts` (que ya lee otros tokens del mismo context, ej. `MARKS_COUNT_TOKEN`) lee estos dos nuevos y los agrega al evento `H` emitido.
- Esto mantiene el change 100% dentro de L3 (consistente con la afirmación original de la propuesta: "L1: nada, L2: nada"), sin abrir un puerto L1 nuevo que solo tendría un consumidor.

**Alternativa descartada (A):** puerto L1 `AuditLog` + tipos de evento movidos a L1, consumido directamente por `GuardarDraftUseCase`. Descartada por alcance: mueve tipos usados en 4+ archivos L3/LR para un beneficio marginal (el único motivo real era "L2 podría querer loguear directo", que no es un requisito de este change).

**Alternativa descartada (B):** `GuardarDraftUseCase` (L2) setea `HttpContext` tokens directamente. Descartada de plano: viola pureza de L2, `hexagonal-guard` la marcaría como violación dura.

### Fase 1 bridge design

El mismo `AuditLogSerializer` que produce el NDJSON para la descarga manual (Fase 0) alimenta también el futuro upload automático (Fase 1) vía `serializeSlice(sinceMs, untilMs)` — construido sobre el mismo `groupIntoBatches` que usa `serializeBatchedNdjson`, solo que acotado por rango de tiempo en vez de "todo el día actual". `serializeSlice` genera un `batchId` por invocación; el futuro `AuditLogUploadDispatcher` de Fase 1 sube ese payload al back con `POST /t/{slug}/telemetry/audit-log-batch`, y el back deduplica por `batchId` para tolerar reintentos sin duplicar filas. Tras confirmar 2xx, el dispatcher llama `AuditLogStore.clearRange(sinceMs, untilMs)` — puente simétrico que borra solo los eventos IDB del rango confirmado, sin afectar eventos fuera de esa ventana (a diferencia de `clearDay`, que es day-granular). Esto habilita un dispatcher periódico (ej. cada N minutos) en vez de uno que solo puede subir "el día anterior completo".

### Batched output shape (Sub-bloque D)

**Decisión:** cada evento agrupado dentro de `x` es un OBJETO (`{dt, ...campos}`), no una tupla posicional (`[dt, ...campos]`). Ejemplo real:

```jsonc
// Burst de 3 POSTs de draft de la misma sesión, dentro de 2000ms entre sí:
{"t":1788470275006,"e":"H","s":"62dc0018","x":[
  {"dt":0,"m":2,"u":22,"st":204,"dur":640,"d":4,"v":1,"chg":[]},
  {"dt":8363,"m":2,"u":22,"st":204,"dur":316,"d":3,"v":2,"chg":[[1,"B"]]},
  {"dt":15006,"m":2,"u":22,"st":204,"dur":637,"d":4,"v":3,"chg":[]}
]}
// Evento aislado (fuera de cualquier burst de 2000ms) — forma plana, sin `x`:
{"t":1788469897331,"e":"H","m":1,"u":12,"st":200,"dur":997}
```

**Por qué objeto y no tupla:** el texto original de este Revision Log (arriba) describe el formato como `[[dt, ...campos], ...]`. Al implementar (Sub-bloque D), esa forma resultó frágil apenas se la confrontó con la heterogeneidad real de campos opcionales de `HEvent` (`c?`, `d?`, `v?`, `chg?`): una tupla exige una posición fija por campo, así que cualquier evento del grupo que no tenga un campo opcional presente en OTRO evento del mismo grupo necesita un `null` de relleno en esa posición — y el consumidor (humano leyendo NDJSON crudo, o el back de Fase 1) tiene que memorizar el mapeo posición→campo por tipo de evento para poder leerlo. El objeto evita ambos problemas: cada campo aparece solo cuando el evento lo tiene, autoexplicado por su key, sin relleno. El costo en bytes es marginal (keys cortas de 1-3 chars, ya elegidas así en el schema base) y ya fue asumido como irrelevante en Decision 4 arriba ("el peso crudo estimado es 4-16 KB/día... optimizar bytes... ahorraría <10 KB/día — irrelevante").

**Grouping:** por `(e, s?)`, encadenado — un evento entra al grupo abierto de su key si su `t` está a ≤2000ms del ÚLTIMO evento ya agregado a ese grupo (no del baseline `t` del grupo). Esto permite bursts sostenidos (varios eventos separados por <2000ms entre sí, aunque el burst completo dure más de 2000ms) sin partirlos artificialmente. Un grupo de tamaño 1 se emite como el evento original, plano, sin `x` — mantiene "1 evento = 1 línea" para el caso común (la mayoría de `AO`, `VC`, `DP`, `H` sueltos) y reserva la forma batcheada para bursts reales.

## Revision Log — 2026-09-04 (iteration 2 — senior format)

### Rationale

Un testeo real adicional (posterior al de Sub-bloque D) sobre el escenario objetivo — 10h/día × 20 exámenes por alumno en temporada de simulacros — mostró que el formato batcheado por ventana de 2000ms seguía siendo demasiado verboso: la ventana corta hace que ráfagas de `H` de la misma sesión pero separadas por más de 2s (tiempo normal entre preguntas) sigan emitiéndose como líneas sueltas, y cada línea batcheada repite `s`/`u`/campos constantes por evento agrupado. Un revisor senior, al ver el volumen resultante, prescribió un pivote más agresivo: eliminar la ventana de tiempo por completo y agrupar TODO evento que comparta `(e, s?, u?)` — sin importar cuánto tiempo pase entre ellos dentro del mismo batch — más un mecanismo de auto-hoist genérico que promueve al grupo cualquier campo cuyo valor sea idéntico en todas las entradas agrupadas (no solo `s`/`u`, que ya eran candidatos obvios).

### Format spec

Cada línea NDJSON es un grupo con esta forma:

```
{ e: string, s?: string, u?: number, t0: number, [...campos hoisteados]: any, x: [...entradas] }
```

- `e`, `s?`, `u?` — igual que antes, pero ahora determinados POR INSTANCIA: un evento sin `s` NO se agrupa con uno que sí lo trae, aunque compartan `e`.
- `t0` — mínimo `t` del grupo (reemplaza el `t: baseline` de Sub-bloque D).
- Cada entrada de `x` lleva `dt = t - t0` más los campos que NO fueron hoisteados (porque variaron entre entradas del grupo).
- Auto-hoist: cualquier campo (además de `s`/`u`, que siempre se hoistean cuando forman parte de la key) presente con el MISMO valor (deep-equal — cubre arrays como `chg`) en TODAS las entradas del grupo se promueve al nivel del grupo y se borra de cada entrada.

Ejemplo real (3 POSTs de draft de la misma sesión, sin restricción de ventana — pueden estar separados por minutos):

```jsonc
{"e":"H","s":"62dc0018","u":22,"t0":1788470275006,"m":2,"st":204,"x":[
  {"dt":0,"dur":640,"d":4,"v":1,"chg":[]},
  {"dt":8363,"dur":316,"d":3,"v":2,"chg":[[1,"B"]]},
  {"dt":123456,"dur":637,"d":4,"v":3,"chg":[]}
]}
```

`m:2` y `st:204` son idénticos en las 3 entradas → se hoistean al grupo. `dur`, `d`, `v`, `chg` varían → quedan per-entry.

### Reversibility guarantee

El requisito duro es reversibilidad 100%: `parseBatchedNdjson(serializeBatchedNdjson(events))` debe devolver exactamente los eventos originales (mismo set, mismo orden cronológico). `parseBatchedNdjson` (nueva función exportada, símil inverso de `serializeBatchedNdjson`) reconstruye cada evento fusionando los campos del grupo (`e`, `s?`, `u?`, campos hoisteados) con los de su entrada (`t = t0 + dt`, más los campos no hoisteados), y devuelve la lista ordenada por `t`. Este par de funciones es la base que usará Fase 1 (el back) y sus tests de verify para reconstruir el evento crudo a partir de lo que Fiovi sube — probado con un test de round-trip sobre un array heterogéneo (H de draft/submit/sin sesión, VC, AO con `se`, OF, SS, AS, DP, NW, RT, AI) en `audit-log-serializer.spec.ts`.

### New `SSO_ERROR_IDS` dictionary + `AO.se`

Se agrega `SSO_ERROR_IDS` (mismo convenio 0=unknown que los demás diccionarios) y `AOEvent.se?: number`, poblado por `installAuditLogListeners` leyendo `?sso_error=X` de `window.location.search` al emitir el `AO` de bootstrap. Motivación: el flujo SSO puede fallar en el callback ANTES de que exista una sesión de auditoría normal (no hay `login` ni `sessionId` todavía), así que el único punto de captura fiable es el evento de arranque de la app. Permite detectar en el análisis post-facto cuántos alumnos llegan a la app con un fallo de SSO sin depender de que el back lo loguee por su cuenta.

### Singleton special case reversed

Sub-bloque D emitía grupos de 1 entrada como el evento plano original (sin `x`), para minimizar bytes en el caso común. Esta iteración lo revierte deliberadamente: TODOS los grupos, incluidos los de 1 entrada, usan la forma batcheada `{..., x:[...]}`. Motivación: uniformidad de schema — un consumidor (humano o el back de Fase 1) parsea una sola forma de línea en todo el archivo, sin un caso especial "a veces plano, a veces con x". El costo en bytes es marginal (el auto-hoist ya promueve TODOS los campos de un grupo de 1 entrada al nivel del grupo — ver `computeHoistedFields`/`toGroup` en `audit-log-serializer.ts` — así que la entrada colapsa a `{dt:0}` de todos modos).

### Empirical result

~85% de compactación total vs el NDJSON crudo (`serializeToNdjson`) de Fase 0, medido sobre el mismo log de referencia usado en Sub-bloque D — la eliminación de la ventana de 2000ms permite agrupar sesiones completas de examen (varias decenas de minutos) en una sola línea por `(e, s?, u?)`, y el auto-hoist elimina la repetición de `m`/`st` (que casi siempre son constantes dentro de un mismo endpoint) en cada entrada.

**`batchId` (`serializeSlice`):** se usa `crypto.randomUUID()` en vez de implementar un ULID a mano. La propiedad distintiva de un ULID sobre un UUID v4 — ser lexicográficamente ordenable por tiempo de creación — no tiene ningún consumidor en Fase 0 (nadie lista ni ordena `batchId`s; el back de Fase 1 solo lo usa como clave de dedup, para lo cual un UUID v4 es suficiente). Implementar el bit-packing Crockford base32 a mano para una propiedad que nadie consume es sobreingeniería evitable — mismo criterio que Decision 3/6 de este documento (no pagar complejidad por una necesidad hipotética). Si Fase 1 necesita ordenamiento temporal de batches, se resuelve ordenando por el `t` del primer evento del batch (ya disponible en el payload), no por el propio `batchId`.

## Revision Log — 2026-09-04 (iteration 3 — clock calibration event)

**Rationale:** el reloj del dispositivo del alumno puede driftear respecto al reloj NTP-sincronizado del back. Los reclamos de auditoría necesitan correlacionar timestamps de cliente con logs del back — un skew de pocos segundos ya alcanza para que "enviaste a las 14:32" (cliente) vs. "recibido a las 14:27" (back) sean imposibles de conciliar sin un ancla de calibración.

**Mecanismo:** `HttpExamsApi.getTodaysExams()` ya recibe `serverTime` en cada response — se aprovecha ese valor sin agregar ningún nuevo endpoint ni polling dedicado. `maybeCalibrateClock` guarda `lastCalibrationCheckAt` y `lastEmittedOffset` como estado de instancia (no en IDB — perderlo en un reload es aceptable, el próximo poll recalibra) y aplica dos guards: (1) a lo sumo 1 recálculo cada `CLOCK_CHECK_INTERVAL_MS` (4h); (2) de los recálculos permitidos por (1), solo emite `CLK` si el offset (`srv - t`) cambió más de `CLOCK_DRIFT_THRESHOLD_MS` (500ms) vs. el último offset emitido.

**Expectativa empírica:** ~1 línea `CLK` por día en un dispositivo normal (offset estable); 2-3 líneas máximo en dispositivos con drift activo (reloj sin NTP, hardware clock corrido).

**Fórmula de reconstrucción:** `offset = srv - t; realT = anyEvent.t + offset` — cualquier evento del mismo día puede recalibrarse contra el `CLK` más cercano en el tiempo.

**Trade-off aceptado:** drift ocurrido DENTRO de una ventana de 4h queda sin detectar hasta el próximo poll que caiga fuera de esa ventana. Aceptable para el horizonte típico de un reclamo (skew usual <60s; casos raros de minutos) — el objetivo es descartar "el dispositivo tenía el reloj mal puesto por horas/días", no medir drift de sub-segundo en tiempo real.

**Desviación respecto al enunciado original:** `maybeCalibrateClock` recibe `serverTime` en millis (`ServerTime.toMillis()`), no el string ISO crudo de `dto.serverTime` — el cálculo de offset (`srv - t`) es aritmética numérica y el string no es restable directamente.
