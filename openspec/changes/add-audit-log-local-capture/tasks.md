# Tasks: Add Audit Log Local Capture (Fase 0)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~600 (~400 prod + ~200 test) |
| 400-line budget risk | Medium — excepción justificada por cohesión |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | direct |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium (revisor puede leerlo por commits ordenados)

---

## Phase 1: Domain (L1 puro)

Nada. Este change es infra L3, no toca dominio.

## Phase 2: Application (L2 puro)

Nada. Este change no agrega use cases.

## Phase 3: Telemetry base — tipos, tokens, diccionarios (L3)

- [ ] 3.1 **CREATE** `src/L3_periphery/telemetry/audit-log-event.ts` — tipos discriminados por `e`: `AuditLogEvent = SSEvent | MKEvent | HEvent | NWEvent | VCEvent | OFEvent | RTEvent | AOEvent | AIEvent | DPEvent`. Cada tipo con los campos definidos en REQ-AL-01, REQ-AL-02. Export `EventCode` union `"SS"|"MK"|"H"|"NW"|"VC"|"OF"|"RT"|"AO"|"AI"|"DP"`. Cubre REQ-AL-05 (schema).
- [ ] 3.2 **CREATE** `src/L3_periphery/telemetry/tokens.ts` — `HttpContextToken`s: `ENDPOINT_ID_TOKEN = new HttpContextToken<number>(() => 0)`, `MARKS_COUNT_TOKEN = new HttpContextToken<number | undefined>(() => undefined)`, `SESSION_ID_TOKEN = new HttpContextToken<string | undefined>(() => undefined)`. Cubre Decision 1 y Decision 7.
- [ ] 3.3 **CREATE** `src/L3_periphery/telemetry/audit-log-dictionaries.ts` — `ENDPOINT_IDS` const con TODOS los helpers exportados por `src/L3_periphery/http/api-paths.ts` mapeados a IDs numéricos únicos (1..N, 0 reservado para unknown). `ERROR_CODE_IDS` const con todos los códigos `code` server documentados (grep de `L2_application/use-cases/` y `L3_periphery/http/`). `METHOD_IDS = { GET:1, POST:2, PUT:3, DELETE:4, PATCH:5 }`. Cubre REQ-AL-05.
- [ ] 3.4 **CREATE** `src/L3_periphery/telemetry/day-key.ts` — helper `todayLocalKey(now = new Date()): string` que retorna `YYYY-MM-DD` en local timezone. Sin dependencias externas. Cubre REQ-AL-03.
- [ ] 3.5 **CREATE** `tests/unit/L3_periphery/telemetry/audit-log-dictionaries.spec.ts` — test parametrizado: para cada helper exportado por `api-paths.ts` (importado con `import * as apiPaths`), verificar que `ENDPOINT_IDS[helperName]` está definido y es > 0. Verificar unicidad: `Object.values(ENDPOINT_IDS)` sin duplicados. Cubre REQ-AL-05.
- [ ] 3.6 **CREATE** `tests/unit/L3_periphery/telemetry/day-key.spec.ts` — tests: `todayLocalKey(new Date('2026-08-25T12:00:00-05:00'))` retorna `"2026-08-25"`; `todayLocalKey(new Date('2026-08-25T23:59:59-05:00'))` retorna `"2026-08-25"`; `todayLocalKey(new Date('2026-08-26T00:00:00-05:00'))` retorna `"2026-08-26"`. Cubre REQ-AL-03.

## Phase 4: AuditLogStore (L3)

- [ ] 4.1 **CREATE** `src/L3_periphery/telemetry/audit-log-store.service.ts` — `@Injectable({ providedIn: 'root' })` `AuditLogStore`. IDB con name `fiovi-audit-log`, version 1, dos object stores: `events` (autoIncrement key) y `meta` (kv). Métodos: `append(event: AuditLogEvent): void` (fire-and-forget, chequea day-key contra meta, si difiere → clear inline antes de put), `currentDayBatch(): Promise<AuditLogEvent[]>` (retorna todos ordenados por key), `clearDay(dayKey?: string): Promise<void>` (no-op si dayKey provisto y != currentKey). Todas las excepciones IDB cachadas silenciosamente. Cubre REQ-AL-03, Decision 5, Decision 8.
- [ ] 4.2 **CREATE** `tests/feature/L3_periphery/telemetry/audit-log-store.spec.ts` — import 'fake-indexeddb/auto'; beforeEach limpia IDB. Tests: append escribe evento; currentDayBatch retorna orden cronológico; rotación día 1 → día 2 wipea; clearDay con dayKey != actual no borra; append no lanza ante QuotaExceededError simulado (mock IDB `put` que rechaza). Cubre REQ-AL-03 scenarios.

## Phase 5: Interceptor HTTP (L3)

- [ ] 5.1 **CREATE** `src/L3_periphery/telemetry/audit-log.interceptor.ts` — `HttpInterceptorFn`. Al inicio: `start = Date.now()`, `endpointId = req.context.get(ENDPOINT_ID_TOKEN)`, `marks = req.context.get(MARKS_COUNT_TOKEN)`, `sessionId = req.context.get(SESSION_ID_TOKEN)`, `method = METHOD_IDS[req.method]`. `next(req).pipe(tap({ next: (event) => { if (event instanceof HttpResponse) { store.append({ t, e:'H', m:method, u:endpointId, st:event.status, dur:Date.now()-start, ...(marks!==undefined && { d:marks }), ...(sessionId && { s:sessionId }) }) } }, error: (err: HttpErrorResponse) => { const isNW = err.status === 0; const codeId = extractCodeId(err.error); store.append({ t, e:'H', m:method, u:endpointId, st:err.status, dur:Date.now()-start, ...(codeId!==0 && { c:codeId }), ...(marks!==undefined && { d:marks }), ...(sessionId && { s:sessionId }) }); if (isNW) store.append({ t, e:'NW', u:endpointId, ...(sessionId && { s:sessionId }) }); } }))`. Helper `extractCodeId(body: unknown): number` lee `body.code` (regla #3 CLAUDE.md), lookup en `ERROR_CODE_IDS`, default 0. Cubre REQ-AL-01, Decision 1, Decision 2.
- [ ] 5.2 **CREATE** `tests/feature/L3_periphery/telemetry/audit-log-interceptor.spec.ts` — TestBed con `provideHttpClient(withInterceptors([auditLogInterceptor]))` + `HttpTestingController` + `AuditLogStore` real (fake-indexeddb). Tests: GET 200 con ENDPOINT_ID_TOKEN → append H con m:1, st:200; POST 429 con body `{code:'TOO_MANY_REQUESTS'}` → H con c:<TOO_MANY_REQUESTS ID>; request sin token → H con u:0; error code no catalogado → c:0; MARKS_COUNT_TOKEN=12 → H con d:12; SESSION_ID_TOKEN='abc' → H con s:'abc'; NetworkError → H con st:0 + NW event. Cubre REQ-AL-01 scenarios, REQ-AL-05 scenarios.

## Phase 6: Listeners globales (L3)

- [ ] 6.1 **CREATE** `src/L3_periphery/telemetry/audit-log-listeners.ts` — función `installAuditLogListeners(store: AuditLogStore): void`. Registra: `document.addEventListener('visibilitychange', () => store.append({ t, e:'VC', v: document.visibilityState==='visible'?1:0 }))`; `window.addEventListener('online', ...)` y `'offline'` para OF; `window.addEventListener('appinstalled', ...)` para AI mode:prompt-accepted; check `matchMedia('(display-mode: standalone)').matches` → AI mode:standalone (1× por día usando meta store para idempotencia); compute DP `{ ram: navigator.deviceMemory, cores: navigator.hardwareConcurrency, screen: '${innerWidth}x${innerHeight}', dpr: devicePixelRatio }` (1× por día); `AO {cold: performance.getEntriesByType('navigation')[0]?.type === 'reload' ? 0 : 1}`. Todos vía `store.append`. Cubre REQ-AL-02.
- [ ] 6.2 **CREATE** `tests/feature/L3_periphery/telemetry/audit-log-listeners.spec.ts` — TestBed con fake-indexeddb + AuditLogStore real + `installAuditLogListeners`. Tests: dispatch de `document.dispatchEvent(new Event('visibilitychange'))` con `Object.defineProperty(document, 'visibilityState', {value:'hidden', configurable:true})` → VC con v:0; `window.dispatchEvent(new Event('offline'))` → OF con o:0; `window.dispatchEvent(new Event('appinstalled'))` → AI mode:prompt-accepted; bootstrap emite AO + DP + (AI standalone si matchMedia mockeado); segundo bootstrap del mismo día NO agrega DP duplicado. Cubre REQ-AL-02 scenarios.

## Phase 7: Marcar HttpContext en adapters HTTP (L3)

- [ ] 7.1 **MODIFY** `src/L3_periphery/http/http-auth-repository.ts` — en cada `http.get/post` agregar `context: new HttpContext().set(ENDPOINT_ID_TOKEN, ENDPOINT_IDS.foo)` con el helper correspondiente (login, selectTenant, listSsoProviders, me, refresh, logout, profile). Import `HttpContext` y tokens/dictionaries. Cubre REQ-AL-01 (adapters marcan endpoint).
- [ ] 7.2 **MODIFY** `src/L3_periphery/http/http-exams-api.ts` — ídem para: studentExamSessions, submit, submitProgressSnapshot. Cubre REQ-AL-01.
- [ ] 7.3 **MODIFY** `src/L3_periphery/http/http-tutor-exams-api.ts` — ídem para todos los helpers tutor (~8 endpoints). Cubre REQ-AL-01.
- [ ] 7.4 **MODIFY** `src/L3_periphery/http/http-tutor-navigation-api.ts` — ídem para helpers tutor navigation (~4). Cubre REQ-AL-01.
- [ ] 7.5 **MODIFY** los tests existentes de estos adapters si romperon por firma cambiada — no debería (el `HttpContext` es un option adicional, no cambia comportamiento observable), pero verificar. Ajustar si hay que passar `HttpContext.any()` en mocks.

## Phase 8: Marcar MARKS_COUNT en draft dispatcher (L3)

- [ ] 8.1 **MODIFY** `src/L3_periphery/envio/draft-auto-save-dispatcher.service.ts` — en el punto donde se arma la request del snapshot (probablemente el use case invocado internamente o el adapter que llama), setear `context.set(MARKS_COUNT_TOKEN, currentDirtyCount)` y `context.set(SESSION_ID_TOKEN, sessionId)`. Si el snapshot POST se hace dentro del use case `guardar-draft.use-case.ts` (L2), este punto se movería a `http-exams-api.ts` donde el use case termina llamando al adapter (respetando boundary L2 no importa Angular). Verificar en implementación cuál es el punto real. Cubre REQ-AL-01 (marks count), Decision 7.
- [ ] 8.2 **UPDATE** el test correspondiente para verificar que el `HttpContext` se popula. Si `guardar-draft.use-case.spec.ts` no puede verificarlo (por ser L2 puro), agregar test en `tests/feature/L3_periphery/http/http-exams-api-draft.spec.ts` que verifica el HttpContext del request capturado por `HttpTestingController`. Cubre REQ-AL-01 scenarios.

## Phase 9: Hook MK en simulacro view-model (LR)

- [ ] 9.1 **MODIFY** `src/LR_render/view-models/simulacro.view-model.ts` — inject `AuditLogStore`. En los métodos `setAlt(q, a)` y `clearAlt(q)`, al final del flujo exitoso (después de `markingsStorage.setMarking` / `remove`), llamar `this.auditLog.append({ t: Date.now(), e: 'MK', s: this.sessionId(), q, a: a ?? '0' })`. Fire-and-forget, no await, no try/catch (el store ya caches). Cubre REQ-AL-02.
- [ ] 9.2 **MODIFY** `src/LR_render/view-models/simulacro.view-model.ts` — al inicializar la sesión (donde se resuelve el sessionId), emitir `SS`: `this.auditLog.append({ t: Date.now(), e: 'SS', s: this.sessionId() })`. Debe ser 1× por sesión abierta, no en cada re-render. Usar effect() con guard o llamar explícitamente en el punto de bootstrap del VM. Cubre REQ-AL-02.
- [ ] 9.3 **MODIFY** `tests/feature/LR_render/view-models/simulacro.view-model.spec.ts` — agregar tests: `setAlt(10, 'C')` → `AuditLogStore.append` fue llamado con `{e:'MK', s, q:10, a:'C'}`; `clearAlt(10)` → append con `a:'0'`; init de sesión → append con `{e:'SS', s}`. Mock del `AuditLogStore` en TestBed. Cubre REQ-AL-02 scenarios.

## Phase 10: Item "Descargar logs" en profile (LR)

- [ ] 10.1 **CREATE** `src/L3_periphery/telemetry/audit-log-serializer.ts` — clase `AuditLogSerializer` con método `downloadCurrentDay(): Promise<void>` que: 1) invoca `store.currentDayBatch()`; 2) si empty → toast "Sin logs para hoy" y return; 3) serializa a NDJSON (`events.map(e => JSON.stringify(e)).join('\n') + '\n'`); 4) crea `Blob([ndjson], { type: 'application/x-ndjson' })`; 5) trigger download via anchor click con filename `fiovi-audit-${todayLocalKey()}.ndjson`; 6) toast "Logs descargados". Inject `AuditLogStore` + `ToastService` (o el equivalente existente). Cubre REQ-AL-04.
- [ ] 10.2 **CREATE** `tests/feature/L3_periphery/telemetry/audit-log-serializer.spec.ts` — tests: currentDayBatch empty → toast "Sin logs para hoy" y no dispara download; currentDayBatch con N eventos → blob NDJSON con N líneas + download disparado (verificar via mock de `URL.createObjectURL` y anchor.click). Cubre REQ-AL-04 scenarios.
- [ ] 10.3 **MODIFY** `src/LR_render/pages/profile/profile.page.ts` — inject `AuditLogSerializer`. Método `onDescargarLogsClick(): void` que llama `serializer.downloadCurrentDay()`. Cubre REQ-AL-04.
- [ ] 10.4 **MODIFY** `src/LR_render/pages/profile/profile.page.html` — al final del menú, después del último item existente ("Acerca de"), agregar un item nuevo con el MISMO patrón `<li><button class="menu-item">…</button></li>` que los demás items (icono `download` + label "Descargar logs" + `(click)="onDescargarLogsClick()"`). SIN divisor separador. SIN `@if` — siempre visible en esta rama. Cubre REQ-AL-04.

## Phase 11: Wiring en app.config.ts

- [ ] 11.1 **MODIFY** `src/app.config.ts` — chain interceptor: cambiar `withInterceptors([credentialsInterceptor])` a `withInterceptors([credentialsInterceptor, auditLogInterceptor])`. Verificar que `AuditLogStore` está disponible via `providedIn: 'root'` (no requiere provide explícito). Agregar `provideAppInitializer(() => { installAuditLogListeners(inject(AuditLogStore)); })` (o el patrón equivalente en Angular 22 para APP_INITIALIZER). Cubre Decision 2 y REQ-AL-02 (listeners boot).

## Phase 11.5: Auto-submit event (AS)

- [x] 11.5.1 **MODIFY** `src/L3_periphery/telemetry/audit-log-event.ts` — agregar tipo `ASEvent { t, e:"AS", s }`. Extender union `AuditLogEvent`. Cubre REQ-AL-02 (nuevo AS).
- [x] 11.5.2 **MODIFY** `src/L2_application/use-cases/programar-auto-envio.use-case.ts` — agregar callback opcional `onFire?: () => void` en `ProgramarAutoEnvioInput`. Invocar `input.onFire?.()` DENTRO del `setTimeout` callback, JUSTO ANTES de `enviar.execute()`. Cubre REQ-AL-02 (AS modo examen).
- [x] 11.5.3 **MODIFY** `src/LR_render/view-models/simulacro.view-model.ts` — helper privado `emitAutoSubmit()` que hace `this.auditLog.append({ e:'AS', ...})`. En modo tarea: invocar dentro del `setTimeout` de `scheduleAutoEnvio` antes de `this.submit()`. En modo examen: pasar `onFire: () => this.emitAutoSubmit()` al `programarAutoEnvio.execute(...)`. Cubre REQ-AL-02 (AS modo tarea).
- [x] 11.5.4 **MODIFY** `tests/unit/L2_application/programar-auto-envio.use-case.spec.ts` — nuevo test verificando que `onFire` se invoca ANTES de `enviar.execute` (verificar orden via array de calls).
- [x] 11.5.5 **MODIFY** `tests/feature/LR_render/view-models/simulacro.view-model.spec.ts` — nuevo test dentro de `describe('auto-envío disparado por el timer')` verificando que el view-model pasa `onFire` (callback definido) al use case.

## Phase 12: Verify (blocking gates)

- [ ] 12.1 `npm test` — tests unit + feature verdes. Verificar cobertura de: dictionaries (parametrizado por `api-paths`), day-key, store (rotation), interceptor (H + NW + error codes + marks), listeners (VC/OF/AI/AO/DP), serializer (empty + N events), simulacro view-model (MK + SS).
- [ ] 12.2 `npm run lint` — sin errores ESLint. Verificar que no rompen las boundaries de imports (`hexagonal-guard` a nivel ESLint).
- [ ] 12.3 `npm run format:check` — sin drift en archivos modificados.
- [ ] 12.4 `npx tsc --noEmit` — sin errores de tipos.
- [ ] 12.5 **`hexagonal-guard` subagent** (gate bloqueante per CONTRIBUTING.md) — verificar: `src/L3_periphery/telemetry/` no importa L2 ni LR; `src/LR_render/view-models/simulacro.view-model.ts` puede inyectar `AuditLogStore` (L3) — patrón permitido; ningún nuevo puerto anémico o mapper ceremonial; `simulacro.view-model` no acopla a IDB directo (usa el adapter).
- [ ] 12.6 Verificación manual mínima: `npm run dev` → login → abrir un examen → marcar 3 preguntas → cerrar sesión → ir a /profile → click "Descargar logs" → abrir archivo descargado → confirmar líneas NDJSON con eventos SS + MK + H (login, exam-sessions, marcaciones marcadas).
- [ ] 12.7 Verificación de tamaño: contar bytes del NDJSON descargado tras un flujo típico. Confirmar < 6 KB crudos (per Success Criteria del proposal).
- [ ] 12.8 Verificación anti-PII: `grep` del archivo NDJSON descargado por: emails (regex `[a-z]+@[a-z]+`), tokens (regex `Bearer|Authorization`), slug del tenant (`vonex`). Todos deben retornar 0 matches.

## Design Revision Tasks (2026-09-04)

> Tareas del pivote de diseño acordado tras testear Fase 0 con datos reales (~11 KB en 8 min, dominado por `MK`) + recomendación de revisor senior. Ver `proposal.md` § Design Revision (2026-09-04) y `design.md` § Revision Log — 2026-09-04 para el contexto completo. Estas tareas se suman a — no reemplazan — las 40 tareas de arriba, que quedan como registro histórico del diseño original.

### Sub-bloque A — Drop MK

- [x] A.1 Remover el emit de `MK` en `src/LR_render/view-models/simulacro.view-model.ts` (`setAlt`/`clearAlt`).
- [x] A.2 Remover `MKEvent` del union `AuditLogEvent` en `src/L3_periphery/telemetry/audit-log-event.ts`.
- [x] A.3 Actualizar/eliminar en `tests/feature/LR_render/view-models/simulacro.view-model.spec.ts` los casos que aseveran emisión de `MK`.
- [x] A.4 Actualizar `tests/feature/L3_periphery/telemetry/audit-log-store.spec.ts` si referencia `MK`.

### Sub-bloque C — v+chg en eventos H de draft

- [x] C.1 Agregar `DRAFT_VERSION_TOKEN` y `DRAFT_DELTA_TOKEN` a `src/L3_periphery/telemetry/tokens.ts`.
- [x] C.2 En `HttpExamsApi.guardarDraft`: mantener `lastEmittedComposition: Map<sessionId, Map<questionNumber, alternativaCode>>` y `versionCounter: Map<sessionId, number>`, computar el delta vs `lastEmittedComposition`, setear ambos tokens en el `HttpContext` antes de disparar la request. Desviación del plan original: NO se inyecta `MarkingsStorage` — `req.responses` (el string compacto que ya arma `GuardarDraftUseCase`) es la composición completa vigente para ese POST, así que se parsea directamente en vez de releer IDB (evita un segundo read que podría desincronizarse del body enviado).
- [x] C.3 En `audit-log.interceptor.ts`: leer los 2 tokens nuevos, agregar `v` y `chg` al evento `H` emitido (solo cuando están seteados).
- [x] C.4 Actualizar la interfaz `HEvent` en `audit-log-event.ts`: agregar `v?: number` y `chg?: readonly [number, string][]`.
- [x] C.5 Actualizar `http-exams-api-draft.spec.ts` para verificar que los tokens se setean con el delta correcto.
- [x] C.6 Actualizar `audit-log-interceptor.spec.ts` para verificar que `v`+`chg` se propagan al evento `H`.
- [x] C.7 Agregar test de reset de versionado cuando aparece un `sessionId` nuevo.

### Sub-bloque D — Batch-on-serialize en AuditLogSerializer

- [x] D.1 Extender `AuditLogSerializer` con el helper privado `groupIntoBatches(events, windowMs=2000)`.
- [x] D.2 Modificar `downloadCurrentDay` para llamar a `serializeBatchedNdjson` en vez del serializer plano actual.
- [x] D.3 Agregar `serializeBatchedNdjson(events)` exportado, junto al `serializeToNdjson` existente.
- [x] D.4 Agregar `serializeSlice(sinceMs, untilMs): Promise<{payload, batchId, eventCount, bytesRaw}>` — `batchId` es `crypto.randomUUID()` (no ULID hecho a mano — ver design.md § "Batched output shape" para la justificación); `payload` es el NDJSON batcheado.
- [x] D.5 Actualizar `audit-log-serializer.spec.ts`: verificar que el batching agrupa eventos por `(e, s?, window)`, verificar que eventos singleton quedan como líneas planas, verificar que `batchId` se genera.

### Sub-bloque E — clearRange puente a Fase 1

- [x] E.1 Agregar `clearRange(sinceMs, untilMs): Promise<void>` a `AuditLogStore`.
- [x] E.2 Comportamiento: abre una tx `readwrite`, recorre con cursor `STORE_EVENTS`, borra las filas cuyo `t` cae en el rango.
- [x] E.3 Actualizar `audit-log-store.spec.ts` para verificar que `clearRange` afecta solo el rango indicado.

## Sub-bloque F — Senior format iteration 2 (2026-09-04)

> Testeo real mostró que el formato batcheado por ventana de 2s (Sub-bloque D) seguía siendo demasiado verboso para el escenario 10h/día × 20 exámenes. Revisor senior + usuario prescribieron un formato más agresivo: collapse por `(e, s?, u?)` sin ventana de tiempo, `t0`/`dt` por grupo/entrada, y auto-hoist de campos constantes. Ver `design.md` § Revision Log — 2026-09-04 (iteration 2 — senior format).

- [x] F.1 Agregar diccionario `SSO_ERROR_IDS` + helper `lookupSsoError(code)` a `src/L3_periphery/telemetry/audit-log-dictionaries.ts`.
- [x] F.2 Agregar campo opcional `se?: number` a `AOEvent` en `src/L3_periphery/telemetry/audit-log-event.ts`.
- [x] F.3 En `src/L3_periphery/telemetry/audit-log-listeners.ts`, leer `window.location.search` (`?sso_error=X`) al emitir `AO` en el bootstrap; incluir `se` solo cuando el param está presente. Defensivo ante URL ausente/malformada.
- [x] F.4 Reescribir `groupIntoBatches` en `src/L3_periphery/telemetry/audit-log-serializer.ts` con el nuevo formato senior: sin ventana de tiempo, key `(e, s?, u?)` por instancia, `t0`/`dt`, auto-hoist de campos idénticos, singletons SIEMPRE en forma batcheada (`x`).
- [x] F.5 Agregar `parseBatchedNdjson(ndjson): AuditLogEvent[]` exportado — inversa exacta de `serializeBatchedNdjson`.
- [x] F.6 Actualizar `serializeSlice(sinceMs, untilMs)` para usar el nuevo formato (batchId y rango half-open sin cambios).
- [x] F.7 Reescribir `tests/feature/L3_periphery/telemetry/audit-log-serializer.spec.ts` para el nuevo formato, incluyendo el test de reversibilidad round-trip (el más importante del archivo).
- [x] F.8 Agregar tests de `AO.se` en `tests/feature/L3_periphery/telemetry/audit-log-listeners.spec.ts` (código conocido → id; código desconocido → 0; sin param → campo ausente).

## Sub-bloque G — CLK clock calibration event (2026-09-04)

> El reloj del dispositivo del alumno puede driftear respecto al reloj NTP-sincronizado del back; los reclamos de auditoría necesitan un ancla de calibración para correlacionar timestamps de cliente con logs del back. Se aprovecha el `serverTime` que ya viaja en cada response de `HttpExamsApi.getTodaysExams()` — sin nuevo endpoint ni polling dedicado. Ver `design.md` § Revision Log — 2026-09-04 (iteration 3 — clock calibration event).

- [x] G.1 Agregar `CLKEvent` a `src/L3_periphery/telemetry/audit-log-event.ts` y sumarlo al union `AuditLogEvent`.
- [x] G.2 En `src/L3_periphery/http/http-exams-api.ts`: constantes `CLOCK_CHECK_INTERVAL_MS` (4h) y `CLOCK_DRIFT_THRESHOLD_MS` (500ms), campos de instancia `lastCalibrationCheckAt`/`lastEmittedOffset`, inject de `AuditLogStore`, método privado `maybeCalibrateClock(serverTime: number)`.
- [x] G.3 Invocar `maybeCalibrateClock` desde `getTodaysExams()` inmediatamente después de construir el `ServerTime` (pasando `serverTime.toMillis()`).
- [x] G.4 Agregar 4 tests a `tests/feature/L3_periphery/http/http-exams-api.spec.ts`: primer poll emite CLK; segundo poll dentro de 4h no emite; poll tras 4h sin drift no emite; poll tras 4h con drift >500ms emite con el nuevo `srv`.
- [x] G.5 Actualizar `design.md` con la Revision Log de esta iteración.
- [x] G.6 Actualizar este archivo (`tasks.md`) marcando G.1-G.6.
