# add-admission-area — Design

## Context

La cartilla física OMR de Vonex tiene, arriba de la grilla A–E, un bloque de burbujas para que el alumno marque su área de postulación (la carrera que aplica). Ese dato viaja al scanner y permite al back segmentar corrección y ranking por área.

En la PWA digital ese campo no existe. Este change lo agrega: nuevo VO en L1, extensión de `EnvioRequest` y `DraftRequest`, extensión del body de `POST /submit` y `POST /draft`, nuevo componente picker en LR con dos estados (colapsado ↔ expandido con long-press), persistencia en el IDB store existente de marcaciones, default `GENERAL`.

El change es **estrictamente aditivo**: no toca `EnvioRetryDispatcher`, `credentials.interceptor`, `Exam.area` (curso), `SubmissionAck`, ni el hash del submit. Reusa el mismo servicio de long-press que las `.row--locked` de marcaciones, el mismo IDB store, y el dispatcher existente de `draft-auto-save` (agnóstico al contenido del snapshot).

Coordinación con back: el deploy del back con el contrato aceptado precede al merge del PWA. Sin feature flag.

## Goals / Non-Goals

**Goals**
- Nuevo VO `AdmissionArea` (union type de 16 strings) + guard + constantes en L1.
- `EnvioRequest` y `DraftRequest` extendidos con `admissionArea: AdmissionArea` (requerido).
- `MarkingsStorage` extendido con `getAdmissionArea` / `setAdmissionArea`; `clearMarcaciones` limpia también el área.
- Nuevo `SeleccionarAdmissionAreaUseCase` puro (valida vía guard, delega al storage).
- Nuevo `AdmissionAreaPickerComponent` con dos estados (colapsado ↔ expandido) y gesto long-press reusando el servicio existente.
- `simulacro.view-model.ts` expone `Signal<AdmissionArea>` y método `seleccionarArea` que persiste + notifica al dispatcher.
- `HttpExamsApi` extendido en ambos métodos (`enviar`, `guardarDraft`) con `admission_area` en el body y `INVALID_ADMISSION_AREA` en el clasificador de errores.

**Non-Goals**
- UI post-envío modificada (el `SubmissionAck` sigue igual; no mostramos el área en el modal de comprobante).
- Hidratación cross-device del área elegida (no expone `admission_area` en el GET; write-only al back).
- Set dinámico de áreas leído del back — hardcoded en L1 (regla del producto: si crece, refactor).
- Feature flag `ADMISSION_AREA_ENABLED` — merge del PWA se coordina con deploy del back.
- Recordar la última área usada entre exámenes distintos del mismo día — cada `examId` arranca en `GENERAL`.

## Decisions

### D1: Naming `admissionArea` distinto de `Exam.area`

**Chosen.** L1/L2/LR: `admissionArea` en camelCase. Body (learnex): `admission_area` en snake_case.

Alternativas: (a) `area` a secas; (b) `postulationArea`; (c) renombrar `Exam.area` a `courseArea` y usar `area` para el nuevo campo.

Rationale: `Exam.area` (curso: Letras/Ciencias/Números) ya existe en L1 y viene del back en `GET /student/exam-sessions`. Reusar `area` para el campo nuevo colisiona semánticamente y confunde a reviewers (humanos y agentes). `postulationArea` es sinónimo válido pero producto pidió `admission_area` — hay que respetar la nomenclatura de negocio. Renombrar `Exam.area` es cambio breaking sobre 3 caps existentes (`exam-list`, `exam-marking`, `exam-submission`) por cero ganancia técnica — descartado.

Guard: un comentario inline en `L1/value-objects/admission-area.ts` referencia esta decisión y la distinción con `Exam.area`. La memoria del proyecto `project_area-vs-postulation-area.md` documenta el conflicto para changes futuros.

### D2: Set fijo hardcoded en L1, no dinámico

**Chosen.** Union type cerrado de 16 strings en `L1/value-objects/admission-area.ts`. Guard function por igualdad estricta. Sin Zod schema, sin factory.

Alternativas: (a) leer el set desde `GET /student/exam-sessions` (`exam.allowedAreas: string[]`); (b) constante en L3 leída de env var.

Rationale: los 16 valores son constantes del sistema académico peruano de Vonex, estables. Un set dinámico obliga a la UI a manejar strings arbitrarios que rompen el layout del picker (grid rígido 6-col con `GENERAL span-3`). Un set en L3/env pierde la validación de tipo en L1/L2 (todos los use cases tendrían que aceptar `string` en vez de `AdmissionArea`). Union type + guard da inferencia estática, chip layout predecible, y test suite trivial. Si Vonex agrega `VI` mañana → change refactor explícito, no diseño dinámico.

### D3: Default `GENERAL` se resuelve en el use case, no se persiste

**Chosen.** `EnviarSimulacroUseCase` y `GuardarDraftUseCase` leen `MarkingsStorage.getAdmissionArea(examId)`; si retorna `null`, sustituyen por `DEFAULT_ADMISSION_AREA` **sin persistir**. El view-model hidrata el signal desde storage con el mismo fallback: `getAdmissionArea(examId) ?? DEFAULT_ADMISSION_AREA`.

Alternativas: (a) al montar la página, si no hay área persistida, hacer `setAdmissionArea(examId, 'GENERAL')` para materializar el default; (b) persistir en el port del storage un valor default global.

Rationale: **no queremos "elegí GENERAL" y "todavía no elegí nada" indistinguibles en storage**. Al no persistir el default:
- Si mañana producto pide "el alumno debe elegir expresamente" (obligatoriedad), basta con cambiar el fallback del view-model — el storage sigue devolviendo `null` para alumnos que nunca tocaron el picker.
- El body al back siempre lleva un valor (`GENERAL` por default), pero el frontend recuerda si fue elección explícita o no.
- Cero llamadas extra a IDB en el mount de la página.

### D4: Persistencia en el mismo IDB store que las marcaciones

**Chosen.** `IndexedDbMarkingsStorage` gana dos métodos (`getAdmissionArea` / `setAdmissionArea`) que operan sobre el mismo `objectStore` que las marcaciones. Key derivada del `examId` con un sufijo distinto (ej. `admission-area::<examId>`), o un campo agregado al value existente — decisión de implementación en Apply.

`clearMarcaciones(examId)` SHALL borrar también el `admission_area` del mismo `examId` para no dejar estado stale post-envío exitoso.

Alternativas: (a) storage separado (`AdmissionAreaStorage` puerto nuevo, otro `objectStore`); (b) mezclar en el mismo value con las marcaciones.

Rationale: alcance mínimo. Un puerto separado obliga a instanciar otro adapter, otro test suite jsdom con `fake-indexeddb`, y otro provider en `app.config.ts`. El área siempre viaja junto con las marcaciones y comparte lifecycle (crear al arrancar, limpiar al enviar). Reusar el port mantiene el hex boundary sin explotar el número de piezas L3. El objectStore separado vs. campo mixto es detalle interno del adapter.

### D5: Duplicación del patrón de long-press del `simulacro.page.ts` (no hay servicio a reusar)

**Chosen.** El `AdmissionAreaPickerComponent` duplica internamente el patrón de long-press que hoy vive **inline** en `src/LR_render/pages/simulacro/simulacro.page.ts:12-123`: constante `LONG_PRESS_DURATION_MS = 500`, tolerancia de 10px sobre movimiento del dedo, cancel on move, cleanup en `pointerup`/`pointercancel`. Mismos parámetros para consistencia UX. Un comentario inline en el picker apunta al archivo fuente para señalizar la deriva potencial.

Alternativas: (a) extraer un `LongPressDirective` reusable en `LR_render/directives/`, aplicarlo a las filas de marcaciones y al picker en el mismo change; (b) mover el long-press del picker al `simulacro.page.ts` y que el picker reciba `isEditing` como input.

Rationale: al momento de escribir este design NO existe un servicio ni directive de long-press — la lógica es inline en `simulacro.page.ts` como propiedades privadas del componente. (a) sería un refactor real que expande el scope del change (+2 archivos + tests + auditoría de que no se rompió la protección anti-accidente en marcaciones); (c) acopla el picker a la page y rompe su encapsulación. Duplicar mantiene el scope acotado y el picker autocontenido. Si en el futuro el equipo decide extraer un directive, ambos lugares migran juntos — cambio separado, fuera del scope de este.

Riesgo aceptado: si un futuro dev cambia `LONG_PRESS_DURATION_MS` en un lado y no en el otro, la sensación diverge. Mitigación: comentario inline "mantener sincronizado con `simulacro.page.ts:12`" en ambos archivos.

### D6: Layout del grid — `GENERAL` con `grid-column: span 3`

**Chosen.** El grid del picker es `grid-template-columns: repeat(6, 1fr)`. En la fila 3, `APT · CIE · MAT · GENERAL(span 3)` cierra 6 columnas exactas.

Alternativas: (a) 4 filas × 4 columnas (con GENERAL span 4 en fila 4 sola); (b) chips con wrap flex y sin grid rígido; (c) GENERAL como opción "special" en botón separado abajo del grid.

Rationale: 3 filas × 6 columnas se ve equilibrado en mobile-lite (400px de ancho). GENERAL con span-3 mantiene el chip suficientemente grande para ser tap target legible (7 chars sin apretar). Wrap flex hace que los chips crezcan y encogan según contenido, produciendo layout impredecible que "malogra la estética" (feedback textual del usuario en la conversación). Un botón separado sería una segunda "cosa" en la UI — más ruido, menos consistencia.

### D7: Draft se dispara vía `DraftAutoSaveDispatcher.notificarCambio`, no directamente

**Chosen.** El view-model, tras invocar `SeleccionarAdmissionAreaUseCase` y actualizar el signal, invoca `dispatcher.notificarCambio(examId)` — misma llamada que hace después de `marcarRespuesta`.

Alternativas: (a) el use case `SeleccionarAdmissionAreaUseCase` invoca el dispatcher; (b) el componente picker invoca el dispatcher.

Rationale: mantener el use case puro (single-responsibility: valida y persiste, no orquesta side effects). El componente picker debe ser dumb — solo emite output. El view-model es el orquestador natural que decide "cambió algo local → notificar draft". Reutilizar `notificarCambio` sin agregar un método nuevo mantiene el dispatcher agnóstico al contenido del snapshot (D3 del diseño original de `draft-auto-save`).

### D8: Orden fijo de las keys del body — `code, admission_area, responses[, client_finished_at]`

**Chosen.** El adapter construye el objeto literal en ese orden. El test de body match usa `JSON.stringify` y compara con string literal para asegurar orden.

Alternativas: no fijar orden y comparar sólo por igualdad estructural en tests.

Rationale: el usuario pidió explícitamente ese orden. En JSON el orden de keys no cambia el parseo del back (JSON.parse es orden-agnóstico), pero afecta legibilidad de logs y del `submission_hash` si el back lo computa sobre `JSON.stringify` sin canonicalización. Mejor fijarlo y testearlo.

## Risks / Trade-offs

| Riesgo | Prob | Mitigación |
|---|---|---|
| Alumno pierde caché o cambia de dispositivo → pierde selección; próximo draft manda `GENERAL` | Med | Aceptado. Mismo trade-off que las marcaciones. Documentado en proposal y design.md. |
| Back no aceptó todavía el nuevo campo cuando merge la PWA → 400 `InvalidPayloadError` en producción | Baja | Regla operativa: **merge del PWA es posterior al deploy del back**. Sin flag. Confirmación humana en el handoff. |
| Reviewer humano/agente confunde `Exam.area` (curso) con `admissionArea` (postulación) | Med | Naming distinto en L1 (D1), sección "Terminología" en proposal.md, memoria del proyecto `project_area-vs-postulation-area`, comentario inline en el VO. |
| El componente picker rompe layout si el ancho de pantalla es <320px | Baja | Grid rígido 6-col con font-size 13px es holgado hasta 320px. Testeable con Chrome DevTools mobile presets. Fuera del scope del test suite. |
| Interacción entre long-press del picker y long-press de las marcaciones (dos filas en la misma vista) | Baja | El servicio de long-press ya coordina "solo una fila en editing a la vez" (`exam-marking` spec, requirement "Solo una fila puede estar en edición"). El picker se trata como una fila más para el servicio. Test unitario del servicio ya cubre esta lógica. |
| El dispatcher despacha un draft cada vez que el alumno cambia de área (podría spamear) | Baja | El dispatcher tiene debounce 3s + throttle 10s por sessionId (D3 del diseño de `draft-auto-save`). Cambiar de área 10 veces en 5s produce 1 solo POST con el snapshot final. No hace falta lógica adicional. |

## Migration Plan

1. Back deploya contrato aceptando `admission_area` en body de `/draft` y `/submit`, con enum cerrado en zod y `INVALID_ADMISSION_AREA` como `message` en 400.
2. Frontend mergea el PR. Cero migración de datos: IDB agrega un campo por `examId`; ausencia = `GENERAL` resuelto en el use case.
3. Rollback: `git revert` del merge commit. El change es aditivo — no hay estado a limpiar en IDB (los alumnos que hayan elegido área verán la fila desaparecer en la próxima carga; sus marcaciones no se afectan).

## Open Questions

Ninguna crítica al momento de escribir este design. Los tres puntos que estaban abiertos (naming del campo, obligatoriedad, ámbito) fueron cerrados en la conversación previa al proposal: `admission_area`, opcional con default `GENERAL`, por examen (no cross-exam ni cross-device).
