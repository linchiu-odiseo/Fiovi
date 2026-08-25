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
