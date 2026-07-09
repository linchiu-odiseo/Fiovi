# admission-area Specification

## Purpose
Allows students to select their admission area (the career they are applying to) in the exam marking interface. The selection is persisted locally and transmitted with draft progress snapshots and exam submissions.

## Requirements

### Requirement: `AdmissionArea` VO cerrado de 16 valores en L1

El módulo `src/L1_domain/value-objects/admission-area.ts` SHALL exponer:
- Un union type `AdmissionArea = 'A' | 'A1' | 'B' | 'C' | 'D' | 'E' | 'I' | 'II' | 'III' | 'IV' | 'V' | 'APT' | 'CIE' | 'MAT' | 'G' | 'GENERAL'`.
- Una constante `ADMISSION_AREAS: readonly AdmissionArea[]` con los 16 valores en el orden de renderizado del picker: fila 1 `A, A1, B, C, D, E`; fila 2 `I, II, III, IV, V, G`; fila 3 `APT, CIE, MAT, GENERAL`.
- Una constante `DEFAULT_ADMISSION_AREA: AdmissionArea = 'GENERAL'`.
- Una guard function `isAdmissionArea(v: unknown): v is AdmissionArea` que retorna `true` sólo si `v` es uno de los 16 strings exactos (comparación por igualdad).

El módulo NO SHALL exponer ninguna clase, factory, ni Zod schema — es un módulo puro de tipos y constantes.

#### Scenario: `isAdmissionArea` acepta los 16 valores válidos

- **WHEN** se invoca `isAdmissionArea(v)` para cualquier `v` en `ADMISSION_AREAS`
- **THEN** retorna `true`

#### Scenario: `isAdmissionArea` rechaza valores fuera del set

- **WHEN** se invoca `isAdmissionArea("VI")`, `isAdmissionArea("a")`, `isAdmissionArea("general")`, `isAdmissionArea("")`, `isAdmissionArea(null)`, `isAdmissionArea(undefined)`, `isAdmissionArea(42)`
- **THEN** retorna `false` en todos los casos

#### Scenario: `ADMISSION_AREAS` tiene los 16 valores en orden de picker

- **WHEN** se lee `ADMISSION_AREAS`
- **THEN** su longitud es exactamente 16
- **AND** el orden es `['A', 'A1', 'B', 'C', 'D', 'E', 'I', 'II', 'III', 'IV', 'V', 'G', 'APT', 'CIE', 'MAT', 'GENERAL']`

#### Scenario: `DEFAULT_ADMISSION_AREA` es `GENERAL`

- **WHEN** se lee `DEFAULT_ADMISSION_AREA`
- **THEN** su valor es exactamente `'GENERAL'`

### Requirement: `InvalidAdmissionAreaError` de dominio en L1

`src/L1_domain/errors/invalid-admission-area.error.ts` SHALL exponer una clase `InvalidAdmissionAreaError extends Error` con `name = 'InvalidAdmissionAreaError'`. Se lanza cuando un input externo (payload del back con `INVALID_ADMISSION_AREA`, o un input inválido del UI que no pasó el guard) llega al dominio.

#### Scenario: Instancia expone name correcto

- **WHEN** se crea `new InvalidAdmissionAreaError()`
- **THEN** `instance.name === 'InvalidAdmissionAreaError'`
- **AND** `instance instanceof Error === true`

### Requirement: `MarkingsStorage` extendido con `getAdmissionArea` / `setAdmissionArea`

El puerto `MarkingsStorage` (L1) SHALL exponer dos métodos nuevos:
- `getAdmissionArea(examId: string): Promise<AdmissionArea | null>` — retorna el `AdmissionArea` persistido para ese `examId`, o `null` si nunca se persistió.
- `setAdmissionArea(examId: string, area: AdmissionArea): Promise<void>` — persiste el `area` en el mismo IDB store que las marcaciones, key derivada del `examId`. Idempotente (última llamada gana).

El método existente `clearMarcaciones(examId)` SHALL también borrar el `admissionArea` guardado para ese `examId`. Esto garantiza que tras un envío exitoso no queda estado stale de un examen anterior.

#### Scenario: `getAdmissionArea` retorna `null` si no hay persistencia previa

- **GIVEN** el store IDB no tiene entrada de `admissionArea` para `examId="X"`
- **WHEN** se invoca `getAdmissionArea("X")`
- **THEN** resuelve con `null`

#### Scenario: `setAdmissionArea` seguido de `getAdmissionArea` retorna el valor

- **WHEN** se invoca `setAdmissionArea("X", "MAT")` y luego `getAdmissionArea("X")`
- **THEN** el segundo resuelve con `"MAT"`

#### Scenario: `setAdmissionArea` es idempotente (última gana)

- **WHEN** se invoca `setAdmissionArea("X", "A")` y luego `setAdmissionArea("X", "B")` y luego `getAdmissionArea("X")`
- **THEN** el último resuelve con `"B"`

#### Scenario: `clearMarcaciones` borra también el admissionArea

- **GIVEN** `setAdmissionArea("X", "MAT")` fue invocado
- **WHEN** se invoca `clearMarcaciones("X")` y luego `getAdmissionArea("X")`
- **THEN** el segundo resuelve con `null`

### Requirement: `SeleccionarAdmissionAreaUseCase` puro en L2

El use case `SeleccionarAdmissionAreaUseCase` en `src/L2_application/use-cases/seleccionar-admission-area.use-case.ts` SHALL:
1. Inyectar `MarkingsStorage` como único puerto.
2. Aceptar `execute({ examId, area }: { examId: string; area: unknown })`.
3. Validar `area` con `isAdmissionArea`. Si retorna `false`, lanzar `InvalidAdmissionAreaError` sin tocar `markingsStorage`.
4. Delegar a `markingsStorage.setAdmissionArea(examId, area)`.
5. NO despachar drafts, NO tocar identity, NO leer marcaciones.

#### Scenario: Area válida se persiste

- **GIVEN** `MarkingsStorage.setAdmissionArea` es un spy
- **WHEN** se invoca `execute({ examId: "X", area: "MAT" })`
- **THEN** `setAdmissionArea` fue invocado con `("X", "MAT")`
- **AND** el use case resuelve sin error

#### Scenario: Area inválida lanza `InvalidAdmissionAreaError` sin tocar storage

- **GIVEN** `MarkingsStorage.setAdmissionArea` es un spy
- **WHEN** se invoca `execute({ examId: "X", area: "VI" })` (no está en el set)
- **THEN** rechaza con `InvalidAdmissionAreaError`
- **AND** `setAdmissionArea` NUNCA fue invocado

### Requirement: `AdmissionAreaPickerComponent` en LR con dos estados

El componente `AdmissionAreaPickerComponent` en `src/LR_render/components/admission-area-picker/` SHALL:
- Recibir input `admissionArea: AdmissionArea` (valor actual).
- Emitir output `seleccion: EventEmitter<AdmissionArea>` cuando el alumno elige una opción del grid expandido.
- Tener dos estados de UI mutuamente excluyentes:
  - **Colapsado** (default): fila que muestra la label "Área:" + un pill con el valor actual + hint "Mantén presionado para cambiar". El pill es el único elemento interactivo.
  - **Expandido**: bloque con grid 3×6 de chips (16 opciones), donde `GENERAL` ocupa 3 columnas (`grid-column: span 3`) en la fila 3 para cerrar la retícula. El chip con el valor actual está resaltado (variante `--selected`). Un chip flotante "Toca para cambiar" en la esquina superior derecha (mismo estilo que `.row__chip` de las marcaciones).
- Transitar de **colapsado** a **expandido** mediante long-press ≥500ms sobre el pill. El componente SHALL implementar internamente el patrón de long-press (constante `LONG_PRESS_DURATION_MS = 500` local al archivo, tolerancia 10px, cancel on move, cleanup en `pointerup`/`pointercancel`) idéntico al del `simulacro.page.ts:12-123`. Un comentario inline en el picker SHALL apuntar al archivo fuente y señalar que ambos deben mantenerse sincronizados. El movimiento >10px del dedo antes de los 500ms cancela el gesto.
- Transitar de **expandido** a **colapsado** cuando el alumno toca un chip. En ese momento SHALL emitir `seleccion` con el `AdmissionArea` elegido.
- NO tener estado interno para el `admissionArea` — sólo refleja el input. La persistencia y actualización del signal viven en el view-model.

#### Scenario: Estado colapsado renderiza pill con valor actual

- **GIVEN** `admissionArea = "MAT"`
- **WHEN** el componente monta y no hubo long-press
- **THEN** se renderiza la fila "Área: [MAT]" con el pill como único elemento interactivo
- **AND** el grid 3×6 NO está presente en el DOM

#### Scenario: Long-press sobre pill expande a grid

- **GIVEN** el componente está en estado colapsado
- **WHEN** el alumno mantiene presionado el pill 500ms sin mover más de 10px
- **THEN** el estado cambia a expandido
- **AND** el grid 3×6 se renderiza
- **AND** el chip con `admissionArea` actual tiene la clase `--selected`
- **AND** el chip "Toca para cambiar" aparece flotante en la esquina superior derecha

#### Scenario: Movimiento >10px durante long-press cancela

- **GIVEN** el componente está en estado colapsado
- **WHEN** el alumno mantiene presionado el pill pero mueve el dedo >10px antes de 500ms
- **THEN** el estado NO cambia a expandido
- **AND** el grid 3×6 NO se renderiza

#### Scenario: Tap sobre chip emite `seleccion` y colapsa

- **GIVEN** el componente está en estado expandido con `admissionArea = "GENERAL"`
- **WHEN** el alumno toca el chip `"A"`
- **THEN** el componente emite `seleccion.next("A")`
- **AND** el estado vuelve a colapsado inmediatamente después de emitir
- **AND** el grid 3×6 se desmonta del DOM

#### Scenario: `GENERAL` ocupa 3 columnas en el grid

- **WHEN** el grid expandido se renderiza
- **THEN** el chip `"GENERAL"` tiene la clase (o estilo) que produce `grid-column: span 3`
- **AND** la fila 3 del grid contiene exactamente 4 chips visibles (`APT`, `CIE`, `MAT`, `GENERAL`) que llenan las 6 columnas
