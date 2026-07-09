# add-admission-area — Proposal

- **Status:** proposed
- **Depends on:** `draft-auto-save` (archived 2026-06-19), `fase-3-exam-submit-learnex` (archived 2026-06-17)
- **Unlocks:** Corrección y ranking segmentado por área de postulación en back; futuras vistas del tutor por área.
- **Coordinación con back:** merge del PWA es **posterior** al deploy del back con el contrato del campo aceptado. Sin feature flag.

## Terminología (crítica)

En Fiovi la palabra "área" cubre **dos conceptos distintos** que se confunden fácil:

| Concepto | De dónde sale | Ejemplos |
|---|---|---|
| **Área del curso** (existente) | `Exam.area` en `GET /student/exam-sessions` | Letras, Ciencias, Números |
| **Área de postulación** (este change) | `admission_area` en body de `/draft` y `/submit` | A, A1, B, C, D, E, I, II, III, IV, V, APT, CIE, MAT, G, GENERAL |

El campo nuevo NO puede llamarse `area` a secas — colisiona con `Exam.area`. Naming pactado con producto: **`admissionArea`** en camelCase (L1/L2/LR), **`admission_area`** en snake_case (body). En docs y comentarios se aclara la distinción con `Exam.area`.

## Why

La cartilla física OMR de Vonex tiene, arriba de la grilla A–E, un bloque de burbujas para que el alumno marque su **área de postulación** (la carrera a la que aplica: Ingeniería → A, Medicina → B, etc.). Ese dato viaja al scanner y permite al back segmentar la corrección y el ranking por área.

En la PWA digital, hoy **ese campo no existe**. El alumno solo marca A–E por pregunta; el back guarda respuestas sin saber a qué área compite el alumno. Consecuencia: no se puede emitir ranking por área ni scoring diferenciado, funciones que producto necesita para paridad con la cartilla física.

Este change agrega la selección de área de postulación:
- En la UI de la cartilla, con un patrón que **no roba pantalla al bloque de preguntas** (una fila colapsada `Área: [X]` que solo se expande a bloque grande via long-press, mismo gesto que las burbujas lockeadas).
- En el body de `POST /draft` y `POST /submit`, con set enumerado cerrado (16 valores fijos, hardcoded en L1). Default `GENERAL` para no bloquear al alumno que no eligió expresamente.
- En IDB local, misma clave por `examId` que las marcaciones — write-only al back (misma limitación aceptada del `draft-auto-save`: si el alumno pierde caché, se pierde la elección; volverá a `GENERAL`).

## What Changes

**L1 dominio**
- Nuevo VO/type `AdmissionArea` en `src/L1_domain/value-objects/admission-area.ts`: union type cerrado de 16 strings (`'A' | 'A1' | 'B' | 'C' | 'D' | 'E' | 'I' | 'II' | 'III' | 'IV' | 'V' | 'APT' | 'CIE' | 'MAT' | 'G' | 'GENERAL'`), con guard function `isAdmissionArea(v: unknown): v is AdmissionArea` y constante `ADMISSION_AREAS: readonly AdmissionArea[]` para iteración en LR.
- Nueva constante `DEFAULT_ADMISSION_AREA = 'GENERAL'` en el mismo módulo.
- Extender `EnvioRequest` (submit): agregar `admissionArea: AdmissionArea`.
- Extender `DraftRequest` (draft): agregar `admissionArea: AdmissionArea`.
- Nuevo error `InvalidAdmissionAreaError` (para el guard del VO y para clasificar 400 `INVALID_ADMISSION_AREA` si back lo emite).
- Actualizar el bloque de comentarios de mapeo de errores en el port `ExamsApi`.

**L2 use cases**
- `EnviarSimulacroUseCase`: lee `admissionArea` de `MarkingsStorage.getAdmissionArea(examId)` (fallback `GENERAL` si no está); la pasa al port.
- `GuardarDraftUseCase`: idem; siempre incluye `admissionArea` en el `DraftRequest`.
- Nuevo `SeleccionarAdmissionAreaUseCase` puro: valida el input con el guard, delega a `MarkingsStorage.setAdmissionArea(examId, area)`. NO dispara draft — el dispatcher del draft-auto-save ya escucha cambios via `notificarCambio(sessionId)`, que el view-model llama post-selección.

**L3 adapter / storage**
- `HttpExamsApi.enviar`: agrega `admission_area` al body (orden: `code, admission_area, responses, client_finished_at`).
- `HttpExamsApi.guardarDraft`: agrega `admission_area` al body (orden: `code, admission_area, responses`).
- `classifySubmitError` y `classifyDraftError`: agregar `INVALID_ADMISSION_AREA` al set enumerado del clasificador y mapear a `InvalidAdmissionAreaError`.
- `IndexedDbMarkingsStorage`: nuevos métodos `getAdmissionArea(examId): Promise<AdmissionArea | null>` y `setAdmissionArea(examId, area)`. Guarda en el mismo IDB store, key derivada del `examId`. Se limpia junto con las marcaciones tras `clearMarcaciones(examId)`.

**LR render**
- Nuevo componente `AdmissionAreaPickerComponent` en `src/LR_render/components/`:
  - Estado colapsado (steady): fila blanca con label "Área:" + pill primary con el valor actual + hint "Mantén presionado para cambiar".
  - Estado expandido (editing): bloque 3×6 con chip flotante "Toca para cambiar"; `GENERAL` ocupa 3 columnas para cerrar la fila 3 prolija (APT · CIE · MAT · GENERAL×3).
  - Reutiliza el servicio de long-press existente que usan las `.row--locked` de marcaciones (una sola pieza en LR).
  - Emite `(seleccion)` con la `AdmissionArea` elegida.
- `simulacro.view-model.ts`:
  - Signal `admissionArea: Signal<AdmissionArea>` inicializado a `GENERAL`, hidratado post-mount con `MarkingsStorage.getAdmissionArea(examId) ?? GENERAL`.
  - Método `seleccionarArea(area: AdmissionArea)`: delega al use case + actualiza signal + llama `dispatcher.notificarCambio(sessionId)` (mismo hook que `marcarRespuesta`) para que el draft-auto-save persista el cambio.
  - Mockup de referencia visual: `.authentic/lugia_restyle/index.html`, tab "Cartilla 3 · área". (El folder mantiene el nombre `lugia_restyle/` — es un path físico legacy.)

**Sin cambio en:** `credentials.interceptor`, `EnvioRetryDispatcher`, `DraftAutoSaveDispatcher` (el dispatcher es agnóstico al contenido del snapshot; solo escucha `notificarCambio` y envía lo que el use case arme), `Exam.area` (curso — sigue viniendo del back tal cual), infra de retomar envíos pendientes.

## Capabilities

### New Capabilities

- `admission-area`: selección del área de postulación del alumno en la cartilla. Cubre el set enumerado cerrado (16 valores), el default `GENERAL`, la persistencia en IDB (write-only al back, mismo trade-off del draft-auto-save), el patrón UX (pill colapsado ↔ bloque 3×6 con long-press), y la emisión en el body de `/draft` y `/submit`.

### Modified Capabilities

- `exam-submission` (MINOR, no-breaking): el body del `POST /submit` incluye `admission_area` como campo requerido. `EnvioRequest` extiende con `admissionArea`. `SubmissionAck` y la UI post-envío no cambian.
- `submit-progress-snapshot` (MINOR, no-breaking): el body del `POST /draft` incluye `admission_area` como campo requerido. `DraftRequest` extiende con `admissionArea`. El dispatcher no cambia (agnóstico al contenido).
- `exam-marking` (MINOR): la UI de la cartilla renderiza el `AdmissionAreaPickerComponent` arriba de la grilla de preguntas. La persistencia local del área se agrega al mismo IDB store que las marcaciones. El gesto de long-press del picker reutiliza el servicio existente de las `.row--locked`.
- `http-client` (MINOR): agrega `INVALID_ADMISSION_AREA` al set enumerado del clasificador de errores para `/draft` y `/submit`.

## Impact

- **Contrato con back:** learnex acepta `admission_area` en el body de `POST /t/{slug}/student/exam-sessions/{sessionId}/draft` y `.../submit`. Validación server-side con enum cerrado (mismo set de 16). `submission_hash` del 201 cubre el nuevo campo. **El deploy del back del contrato precede al merge del PWA.**
- **Archivos frontend estimados:** ~10–12 archivos, ~350–450 líneas. Budget candidato para split en 2 PRs si excede: (a) L1+L2+L3 wire + storage; (b) LR picker + view-model + tests. Decisión final en `tasks.md`.
- **Sin migración de datos:** IDB agrega un campo nuevo por `examId`; ausencia = `GENERAL`. Cero backfill necesario.
- **Rollback:** revert quirúrgico del PR. El change es estrictamente aditivo (no toca `EnvioRetryDispatcher`, `credentials.interceptor`, `Exam.area`, `SubmissionAck`, ni el submit-hash existente).
- **Sub-agentes obligatorios (regla CLAUDE.md #3):**
  - `frontend-builder` para el `AdmissionAreaPickerComponent` y su integración en `simulacro.view-model`.
  - `test-engineer` para tests L1 (guard del VO), L2 (use case), L3 (storage + adapter body shape), LR (picker component + view-model wiring).
  - `hexagonal-guard` bloqueante antes de archivar (audita que el picker no importe L3, que el VO no tenga dependencias, que el use case sea puro).
