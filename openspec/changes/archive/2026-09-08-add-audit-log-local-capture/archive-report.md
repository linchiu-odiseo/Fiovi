# Archive Report: add-audit-log-local-capture

## Change Summary

**Change Name**: add-audit-log-local-capture
**Archived Date**: 2026-09-08
**Branches**: `feat/audit-log-fase-0` (PR #83), `fix/audit-log-upload-always-on` (PR #84)
**Status**: ARCHIVED CON PENDIENTES ABIERTOS — ver "Lo que queda afuera"

## Alcance entregado

Instrumenta Fiovi con captura local de eventos de aplicación y peticiones HTTP en IndexedDB, y los sube a learnex en paquetes sellados. Cubre el diagnóstico de reclamos "marqué X y no aparece la nota", que hasta ahora quedaba ciego porque learnex borra el `submit-progress-snapshot` al finalizar el examen.

Se entregó en dos fases sobre el mismo change:

- **Fase 0 — captura local (PR #83, primera mitad).** 11 tipos de evento con keys cortas y diccionarios numéricos para endpoints y códigos de error; store IDB con rotación; interceptor HTTP encadenado después de `credentialsInterceptor`; listeners globales; descarga NDJSON desde `/profile`.
- **Fase 1 — subida al back (PR #83, segunda mitad + PR #84).** Dispatcher con paquetes sellados, gzip y dedup por `batchId`; scheduler con cadencia de 5h, dispersión de 30 min, cita persistida, flush al ocultar y silencio total durante examen; coordinación entre pestañas con Web Locks. Par backend: **odiseo-peru/learnex#1089** (endpoint + cron de retención) y **#1110** (vista de soporte).

### Capas tocadas

| Capa | Impacto |
|---|---|
| L1 (domain) | ninguno |
| L2 (application) | `ProgramarAutoEnvioUseCase` expone callback opcional `onFire` (hook para el evento `AS`) |
| L3 (adapters) | `src/L3_periphery/telemetry/` completo (store, interceptor, listeners, serializer, dispatcher, scheduler, diccionarios, tokens); 4 adapters HTTP marcan requests con `HttpContext` |
| LR (render) | `simulacro.view-model` emite `SS`/`AS`; `/profile` suma "Descargar logs" (solo dev) y "Soporte" (solo alumno) |

## Desvíos respecto del plan original

Estos son los dos motivos por los que el `tasks.md` quedó con casillas sin tildar en las Fases 3 a 12: el plan se superó en el camino y tildarlo habría mentido sobre qué hay en el repo.

1. **Eventos `MK` — implementados y después revertidos.** Una entrada por marcación era redundante con los `H` del draft, que ya llevan el conteo de marcas. El Sub-bloque A del pivote de diseño los sacó. No buscar ese código, no reintroducirlo.
2. **La Fase 1 dejó de ser trabajo futuro.** `REQ-AL-06` estaba escrito como "puente diseñado a Fase 1 (fuera de scope)". El spec mergeado lo reescribe como el requisito real de subida, porque eso es lo que quedó en el repo.

Además, el modelo de retención cambió: Fase 0 borraba todo el store en el primer `append` del día, y eso rompía Fase 1 de forma segura (el `AO` del arranque disparaba la rotación y se perdía lo no subido de la noche anterior). Ahora la retención es "hasta que se suban", con techo de 7 días.

## Artefactos mergeados a los specs principales

1. **`openspec/specs/audit-log-capture/spec.md`** — capacidad NUEVA (no existía antes). 6 requisitos, reconciliados contra el código real y no copiados del delta:
   - REQ-AL-01 — Captura de eventos HTTP (sin cambios respecto del delta)
   - REQ-AL-02 — Captura de eventos de aplicación (**sin `MK`**, **con `CLK`**; set final de 11 tipos)
   - REQ-AL-03 — Storage local y retención (**reescrito**: "hasta que se suban" + techo de 7 días + cola serial de appends)
   - REQ-AL-04 — Salidas manuales desde profile (**ampliado**: "Descargar logs" gateado por `!production`, "Soporte" gateado por `role() === 'student'`, y la regla de no reportar éxito sin mirar el resultado)
   - REQ-AL-05 — Formato del payload y diccionarios (lista de eventos actualizada; regla de extender sin reindexar)
   - REQ-AL-06 — **Subida al back (Fase 1)**, en reemplazo del "puente diseñado a Fase 1"

## Verificación

Corrida el 2026-09-08 sobre `fix/audit-log-upload-always-on`:

- `npm test` — **1410/1417**. Los 7 rojos son `cloudflare-turnstile-provider.spec.ts`, preexistentes y locales: el spec no stubea `devTools`, así que con `DEV_TOOLS=true` en el `.env` el `isEnabled()` corta en su primera línea. Con `devTools:false` da 11/11, y en CI el `.env` semilla no define la variable. No es una regresión de este change.
- `npm run lint` — limpio.
- `npm run format:check` — sin diferencias reales (los ~70 archivos que warnea Prettier en Windows son `core.autocrlf`, confirmado con `git diff --shortstat`).
- `npm run build` — verde.

Verificación en vivo contra learnex (registrada en el `tasks.md`, Sub-bloque H): POST 202, job encolado, fila escrita con gzip válido, contenido descomprimido idéntico al del cliente y sin PII, idempotencia confirmada mandando el mismo batch dos veces (una sola fila), `enc:'none'` aceptado, rate limit activo, y partido por tamaño (141 eventos → 9 paquetes, suma exacta sin perder ni duplicar).

## Lo que queda afuera

Este change se archiva a pedido explícito, con estos puntos abiertos:

- **`hexagonal-guard` NO se corrió en este cierre.** `CONTRIBUTING.md` lo define como gate bloqueante antes de archivar. La última corrida verde es la del 2026-09-07 registrada en el `tasks.md`; el diff posterior (PR #84) no mueve imports entre capas, pero el gate formal no se ejecutó.
- **H.35 — el envío automático nunca se observó en vivo.** La cañería está probada (Soporte usa el mismo `uploadPending`) y el gatillo tiene 13 tests, pero el ciclo real de 5h con jitter, re-sorteo y supresión en examen no se vio contra el back. Recién es observable con PR #84 mergeado y desplegado.
- **H.36 — falta el load test acotado del endpoint** antes de promover a `main`.
- **Orden de despliegue**: learnex#1089 tiene que estar en `main` antes de que este código llegue a `main`. Al momento de archivar está en `testing`.
- **Nit de comentarios**: el store menciona un `clearRange` que ya no existe (quedó `sealPackage`/`deletePackage`), en `audit-log-store.service.ts:18` y `:94`.

## Archive Metadata

- **Original**: `openspec/changes/add-audit-log-local-capture/`
- **Archivado**: `openspec/changes/archive/2026-09-08-add-audit-log-local-capture/`
- **Contiene**: `proposal.md`, `design.md`, `tasks.md`, `specs/audit-log-capture/spec.md` (delta original, conservado tal cual quedó), `archive-report.md`
- **Specs principales actualizados**: `openspec/specs/audit-log-capture/spec.md` (capacidad nueva)
