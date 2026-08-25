# Proposal: Add Audit Log Local Capture (Fase 0)

## Intent

Cuando un alumno reclama "marqué en el examen X y no aparece mi nota", hoy Fiovi no tiene evidencia local ni server-side que permita reconstruir qué pasó. El backend borra el `submit-progress-snapshot` al finalizar el examen (ver memoria `backend-borra-snapshot-al-finalizar`), por lo que el snapshot server-side **no sirve** como fuente de auditoría post-facto. Los access logs de learnex tampoco capturan el body de la request, solo la línea del HTTP.

Este change agrega instrumentación **local** en Fiovi que captura, en el propio dispositivo del alumno:
- Toda petición HTTP que sale de `HttpClient` (endpoint, status, duración, código de error, marks count si es draft/submit).
- Eventos de aplicación no visibles al back: marcaciones individuales (`MK`), visibility change, offline/online transitions, app open (cold/warm), app install detection, device profile, refresh token attempts, network errors, session start.

Fase 0 = solo captura local en IndexedDB + descarga manual desde un item nuevo en `/profile`. **Sin cambios en backend, sin upload automático, sin feature flag** (siempre activo en esta rama; cuando se promueva a `develop` se decide si necesita gating). Fase 1 futura (fuera de scope) = upload automático gzipped al back con feature flag y rollup server-side.

## Scope

### In Scope
- Adapter `AuditLogStore` en `src/L3_periphery/telemetry/` con IDB directo (patrón de `indexed-db-markings-storage.ts`), 1 object store, keys planas.
- Interceptor HTTP funcional `audit-log.interceptor.ts` chained después de `credentialsInterceptor`; loguea CADA request como evento `H` con endpoint ID numérico leído de `HttpContext`.
- Diccionarios numéricos: `ENDPOINT_IDS` (todos los helpers de `api-paths.ts` — auth, exams, tutor, ~20+ endpoints), `ERROR_CODE_IDS` (todos los `code` server documentados en L2/L3 — auth, exams, draft), `METHOD_IDS` (1=GET, 2=POST, 3=PUT, 4=DELETE, 5=PATCH).
- Cada adapter existente (`http-auth-repository`, `http-exams-api`, `http-tutor-exams-api`, `http-tutor-navigation-api`) marca sus requests con `context: new HttpContext().set(ENDPOINT_ID_TOKEN, ENDPOINT_IDS.foo)`.
- Hook en `simulacro.view-model.ts` para emitir eventos `MK` (marcación) y `AS` (auto-submit fired) sin acoplar el view-model al adapter (fire-and-forget append).
- Callback opcional `onFire` en `ProgramarAutoEnvioUseCase` (L2) — invocado justo antes del POST de auto-envío en modo examen, para que el view-model emita `AS` sin duplicar lógica de timing.
- Hook en `draft-auto-save-dispatcher.service.ts` para pasar `d` (marks count) al momento del `fire()` — se agrega al `HttpContext` de la request del snapshot.
- Listeners globales instalados desde `provideAppInitializer()`: `visibilitychange` → `VC`, `online`/`offline` → `OF`, primer app open → `AO`, `matchMedia('(display-mode: standalone)')` + `appinstalled` → `AI`, device profile inicial → `DP`.
- Rotación diaria automática: al `append`, si el `dayKey` (formato `YYYY-MM-DD` local del dispositivo) cambió respecto al último → `wipe + reset`. Corte a las **00:00 local del dispositivo**. Sin scheduler dedicado.
- Item nuevo "Descargar logs" al final del menú de `profile.page.ts`, con el mismo estilo que los demás items (Historial, Configuración, Ayuda, etc.) — sin divisor, sin sección separada. Siempre visible en esta rama. Click → descarga archivo `fiovi-audit-YYYY-MM-DD.ndjson` crudo del día actual.
- Tests unitarios (Vitest puro sobre helpers de serialización y diccionarios) + feature (Vitest + jsdom + `fake-indexeddb/auto` + `HttpTestingController` para adapter, interceptor y serializer).
- Gate obligatorio `hexagonal-guard` sin violaciones (per CONTRIBUTING.md regla #3).

### Out of Scope
- Backend: endpoint de upload, tabla `audit_events_raw`, rollup, tabla `exam_session_diagnostic`, endpoint admin de resumen — todo Fase 1.
- Upload automático desde cliente — Fase 1.
- Compresión gzip del payload — Fase 1 (Fase 0 descarga crudo).
- Feature flag (build-time o runtime) — no necesario en esta rama, se evalúa al promover a `develop`.
- Cohort selection / canary — Fase 1 futura.
- Detección de anomalías cross-user (correlación 429 por tenant) — Fase 1.
- Panel de dashboard admin — Fase 1.
- Retención >1 día en local — Fase 0 explícitamente decide 1 día.
- Helpers `window.__audit` de consola — descartado por "sin sobreingeniería".
- Script `tools/analyze-audit-log.mjs` — descartado, se usa `jq`/DuckDB/VS Code sobre NDJSON directo.
- CSV export en el botón — solo NDJSON.
- Contador vivo "N eventos · X KB" en el item del profile — descartado por simplicidad.
- Botón "vaciar logs de hoy" en UI — la rotación diaria automática lo hace.
- Cross-midnight session handling — sin código especial (nadie examina a las 00:00 local del dispositivo).
- I18n de strings del item (solo es-PE hardcoded).
- Formato columnar pipe-delimited — descartado en favor de NDJSON por analizabilidad; el gramaje bajo (~4-16 KB/día) no lo justifica.
- Nuevas variables en `.env` / cambios en `scripts/build-env.mjs` / cambios en `environment.ts`.

## Capabilities

### New Capabilities
- `audit-log-capture`: captura local de eventos de aplicación + peticiones HTTP en IndexedDB, con rotación diaria automática y descarga NDJSON desde el menú de profile.

### Modified Capabilities
- Ninguna existente. Los adapters HTTP existentes agregan una línea de `HttpContext` cada uno, pero la capability principal (auth, exams, tutor) no cambia su contrato ni su comportamiento observable.

## Approach

- **L1 (domain)**: nada. La instrumentación es infra pura, no lógica de dominio. Ningún puerto, ninguna entidad, ningún error de dominio nuevo.
- **L2 (application)**: nada. Ningún use case nuevo ni modificado.
- **L3 (adapters + infra)**:
  - Nueva carpeta `src/L3_periphery/telemetry/` con: `audit-log-store.service.ts`, `audit-log.interceptor.ts`, `audit-log-event.ts` (tipos discriminados por `e`), `audit-log-dictionaries.ts` (ENDPOINT_IDS, ERROR_CODE_IDS, METHOD_IDS), `audit-log-serializer.ts` (NDJSON + blob download), `tokens.ts` (`ENDPOINT_ID_TOKEN`, `MARKS_COUNT_TOKEN`), `audit-log-listeners.ts` (listeners globales VC/OF/AO/AI/DP).
  - `AuditLogStore.append(event)` — fire-and-forget async, no bloquea llamador. Escribe a IDB con day-key rotation check inline.
  - `AuditLogStore.currentDayBatch(): AuditLogEvent[]` — expuesto para uso del botón HOY y del futuro dispatcher de Fase 1 (puente diseñado).
  - `AuditLogStore.clearDay(dayKey: string)` — expuesto para rotación interna y confirmación de upload futura.
  - `auditLogInterceptor` funcional: lee `ENDPOINT_ID_TOKEN` de `HttpContext` (default `0` = unknown para detectar endpoints no instrumentados), captura start timestamp, envuelve la observable con `tap` para leer status/duration, emite `H` event. Extrae `c` del body si el response trae `code` (regla #3 de CLAUDE.md).
  - Cada adapter HTTP existente agrega `context: new HttpContext().set(ENDPOINT_ID_TOKEN, ENDPOINT_IDS.foo)` en sus requests (~24 líneas totales entre los 4 adapters).
  - `draft-auto-save-dispatcher.service.ts`: agrega `MARKS_COUNT_TOKEN` al context de la request del snapshot para que el interceptor lo lea y agregue el campo `d` al evento H de draft.
- **LR (render)**:
  - `profile.page.html`: item nuevo "Descargar logs" al final del menú, con el mismo `<li><button class="menu-item">…</button></li>` que los items existentes. Handler llama `serializer.downloadCurrentDay()`. Sin `@if` — siempre visible en esta rama.
  - `profile.page.ts`: método `onDescargarLogsClick()` que inyecta el serializer y dispara la descarga.
  - `simulacro.view-model.ts`: en cada `setAlt(q, a)` y `clearAlt(q)` existente, agregar llamada fire-and-forget a `auditLog.append({ e: 'MK', s, q, a })`. El view-model recibe `AuditLogStore` via `inject()`.
- **App bootstrap (`app.config.ts`)**:
  - Registrar `auditLogInterceptor` chained: `withInterceptors([credentialsInterceptor, auditLogInterceptor])`.
  - `AuditLogStore` con `providedIn: 'root'` (no factory necesario).
  - `provideAppInitializer()` nuevo que instala los listeners globales (`visibilitychange`, `online`/`offline`, primer AO/DP/AI del día).

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/L3_periphery/telemetry/audit-log-store.service.ts` | New | Adapter IDB con append, currentDayBatch, clearDay, day-rotation check |
| `src/L3_periphery/telemetry/audit-log.interceptor.ts` | New | HttpInterceptorFn que emite `H` events |
| `src/L3_periphery/telemetry/audit-log-event.ts` | New | Tipos discriminados por `e` (11 tipos: SS, MK, H, NW, VC, OF, RT, AO, AI, DP, AS) |
| `src/L2_application/use-cases/programar-auto-envio.use-case.ts` | Modified | Nuevo callback opcional `onFire` invocado antes del POST |
| `src/L3_periphery/telemetry/audit-log-dictionaries.ts` | New | ENDPOINT_IDS, ERROR_CODE_IDS, METHOD_IDS |
| `src/L3_periphery/telemetry/audit-log-serializer.ts` | New | NDJSON serialize + blob download |
| `src/L3_periphery/telemetry/tokens.ts` | New | HttpContextToken de endpoint ID + marks count |
| `src/L3_periphery/telemetry/audit-log-listeners.ts` | New | Listeners globales VC/OF/AO/AI/DP |
| `src/L3_periphery/http/http-auth-repository.ts` | Modified | Marca ~6 requests con ENDPOINT_ID_TOKEN |
| `src/L3_periphery/http/http-exams-api.ts` | Modified | Marca ~3 requests con ENDPOINT_ID_TOKEN |
| `src/L3_periphery/http/http-tutor-exams-api.ts` | Modified | Marca ~8 requests con ENDPOINT_ID_TOKEN |
| `src/L3_periphery/http/http-tutor-navigation-api.ts` | Modified | Marca ~4 requests con ENDPOINT_ID_TOKEN |
| `src/L3_periphery/envio/draft-auto-save-dispatcher.service.ts` | Modified | Agrega MARKS_COUNT_TOKEN al context del snapshot |
| `src/LR_render/view-models/simulacro.view-model.ts` | Modified | Fire-and-forget append MK en setAlt/clearAlt |
| `src/LR_render/pages/profile/profile.page.ts` | Modified | Handler onDescargarLogsClick |
| `src/LR_render/pages/profile/profile.page.html` | Modified | Item nuevo "Descargar logs" al final del menú, mismo estilo que los otros (siempre visible en esta rama) |
| `src/app.config.ts` | Modified | Chain interceptor, provider Store, appInitializer listeners |
| `tests/feature/L3_periphery/telemetry/audit-log-store.spec.ts` | New | Tests con fake-indexeddb (append + rotation) |
| `tests/feature/L3_periphery/telemetry/audit-log-interceptor.spec.ts` | New | Tests con HttpTestingController (H events + error codes + marks count) |
| `tests/feature/L3_periphery/telemetry/audit-log-serializer.spec.ts` | New | Test NDJSON + download blob |

Volumen estimado: **~350-450 LOC prod + ~200-250 LOC test en ~19 archivos**. Un solo PR.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Latencia de IDB en dispositivos lentos degrada UX del examen | Baja | `append` es fire-and-forget async, no bloquea al llamador. Excepciones cachadas silenciosamente. |
| Loop de 429 en el back llena IDB rápido | Baja | Retención 1 día natural + volumen máximo estimado <20 KB/día. Aún un burst de 1000× 429 en un día = ~30 KB. Nada. |
| Endpoint no marcado con `ENDPOINT_ID_TOKEN` cae en bucket "unknown" (id=0) | Media | Es una señal útil, no un bug. Los `H|u:0` en el log alertan que falta instrumentar. Test verifica que cada helper de `apiPath.*` tenga entrada en `ENDPOINT_IDS`. |
| `HttpContext` es patrón nuevo en el codebase | Baja | Documentado en `design.md` + ejemplo replicado en cada adapter modificado. |
| IDB storage quota alcanzada (dispositivos con storage muy lleno) | Baja | `AuditLogStore.append` cacha `QuotaExceededError` silenciosamente. Log queda incompleto pero app no rompe. |
| Interceptor chained cambia el orden de ejecución vs `credentialsInterceptor` | Baja | Se agrega DESPUÉS de credentials, no interfiere. Test de integración verifica orden. |
| `simulacro.view-model` adquiere dependencia con adapter L3 | Baja | Ya inyecta otros ports L1 (MarkingsStorage). Este es un adapter L3 de infra, no rompe boundaries hexagonales (view-model puede consumir L3 directamente per architecture-rules del proyecto). |

## Rollback Plan

- **Revert del PR** restaura el estado previo. Sin migración de datos, sin cambios de contrato externos, sin coordinación con learnex.
- IDB del alumno queda con la DB `fiovi-audit-log` huérfana; el navegador la limpia con el resto del site data si el usuario borra caché. Sin problema operativo — no interfiere con la DB de marcaciones (`fiovi-cartilla-*`).
- Los `HttpContext` marks en los adapters son no-op sin el interceptor → revert del interceptor los deja como setters de contexto sin lector. Pueden dejarse o quitarse según se prefiera (el revert completo del PR los quita todos automáticamente).

## Dependencies

- Ninguna externa nueva.
- `fake-indexeddb` presente en `devDependencies` (usado por `indexed-db-markings-storage.spec.ts`).

## Success Criteria

- [ ] Toda petición HTTP que sale de `HttpClient` genera evento `H` en IDB con `m`, `u` (endpoint ID != 0), `st`, `dur`.
- [ ] Errores 4xx/5xx con `code` en body incluyen `c` (error code ID) en el evento `H`.
- [ ] Requests de draft/submit incluyen `d` (marks count al momento del fire).
- [ ] Cada `setAlt(q, a)` y `clearAlt(q)` en `simulacro.view-model` emite evento `MK` con `s`, `q`, `a`.
- [ ] `visibilitychange`, `online`/`offline`, cold-app-open generan `VC`, `OF`, `AO` respectivamente.
- [ ] `AI` se emite al detectar `display-mode: standalone` (1× por día) y al recibir evento `appinstalled` (one-shot).
- [ ] `AS` se emite JUSTO ANTES del POST de auto-envío tanto en modo tarea (setTimeout local) como en modo examen (via `onFire` del `ProgramarAutoEnvioUseCase`) — permite distinguir en el análisis submit manual (click) de submit automático (timer).
- [ ] `DP` se emite 1× por día con `ram`, `cores`, `screen`, `dpr`.
- [ ] Al abrir la app en un día nuevo (naive comparison de `YYYY-MM-DD` local), los logs del día anterior se borran automáticamente.
- [ ] Item "Descargar logs" aparece al final del menú de `/profile` con el mismo estilo que los demás items (siempre visible en esta rama).
- [ ] Click en el item descarga `fiovi-audit-YYYY-MM-DD.ndjson` con todo el batch del día actual, formato NDJSON (una línea por evento, JSON parseable independiente).
- [ ] Ningún evento en la descarga contiene PII: cero emails, cero nombres, cero tokens, cero response bodies.
- [ ] Tamaño típico verificado: examen normal (10 preguntas, sin errores) < 300 B crudos; día promedio (20 exámenes) < 6 KB crudos.
- [ ] Tests Vitest verdes: store (append + rotation), interceptor (H events + error codes + marks count), serializer (NDJSON + download blob), listeners (VC/OF/AO).
- [ ] `hexagonal-guard` sin violaciones (per CONTRIBUTING.md regla #3).
- [ ] `design.md` documenta explícitamente el puente a Fase 1: el futuro upload dispatcher consumirá `AuditLogStore.currentDayBatch()` sin cambios al store.
