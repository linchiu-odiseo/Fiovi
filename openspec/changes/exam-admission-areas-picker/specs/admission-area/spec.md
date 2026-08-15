# admission-area — Delta Spec

> **Tipo de delta:** MINOR no-breaking.
> **Change:** `exam-admission-areas-picker`
> **Base:** `openspec/specs/admission-area/spec.md` (change `add-admission-area`, archivado 2026-07-08).
> **Referencia de propuesta:** `openspec/changes/exam-admission-areas-picker/proposal.md`

Este delta describe los requisitos que se AGREGAN o MODIFICAN respecto a la spec base. Todos los requisitos no mencionados aquí siguen vigentes sin cambios.

---

## MODIFIED Requirements

### Requirement MODIFIED: `AdmissionArea` VO — union abierto en L1

**Requisito base:** `AdmissionArea` VO cerrado de 16 valores en L1

**Modificaciones sobre la spec base:**

El módulo `src/L1_domain/value-objects/admission-area.ts` SHALL:

1. Renombrar el union cerrado actual a `type KnownAdmissionArea = 'A' | 'A1' | 'B' | 'C' | 'D' | 'E' | 'I' | 'II' | 'III' | 'IV' | 'V' | 'APT' | 'CIE' | 'MAT' | 'G' | 'GENERAL'`.
2. Exponer un nuevo type `type AdmissionArea = KnownAdmissionArea | (string & {})`. El truco `& {}` preserva el autocompletado de las 16 conocidas en el IDE, al tiempo que permite cualquier string no vacío donde se use `AdmissionArea`.
3. Mantener `ADMISSION_AREAS: readonly KnownAdmissionArea[]` — mismo contenido, mismo orden. El tipo del array pasa de `readonly AdmissionArea[]` a `readonly KnownAdmissionArea[]`.
4. Mantener `DEFAULT_ADMISSION_AREA: KnownAdmissionArea = 'GENERAL'` — tipo narrowed a `KnownAdmissionArea`, no al nuevo union abierto, para preservar garantías en los call sites que dependen del default.
5. **Relajar** la guard function `isAdmissionArea(v: unknown): v is AdmissionArea`: retorna `true` si y solo si `v` es un string de longitud ≥ 1 (fue: solo si `v` estaba en el conjunto cerrado de 16). El archivo SHALL incluir un comentario inline que explique la relajación: el back (learnex) es la autoridad sobre qué áreas existen; rechazar labels no conocidos sería fricción arbitraria para el alumno.
6. **Agregar** helper `isKnownAdmissionArea(v: unknown): v is KnownAdmissionArea` que retorna `true` si y solo si `v` es uno de los 16 strings exactos del set `KnownAdmissionArea` (comparación por igualdad). Esta función es el equivalente al comportamiento previo de `isAdmissionArea`.

El módulo sigue siendo TypeScript puro — cero `@angular/*`, cero `rxjs`, cero browser APIs.

#### Scenario: `isAdmissionArea` acepta los 16 valores conocidos

- **GIVEN** un string `v` perteneciente a `ADMISSION_AREAS`
- **WHEN** se invoca `isAdmissionArea(v)`
- **THEN** retorna `true`

#### Scenario: `isAdmissionArea` acepta strings arbitrarios no vacíos (back como autoridad)

- **GIVEN** el back envía `"Z"` (no está en los 16 conocidos)
- **WHEN** se invoca `isAdmissionArea("Z")`
- **THEN** retorna `true`

#### Scenario: `isAdmissionArea` rechaza string vacío

- **GIVEN** el back envía `""` (string vacío)
- **WHEN** se invoca `isAdmissionArea("")`
- **THEN** retorna `false`

#### Scenario: `isAdmissionArea` rechaza no-strings

- **WHEN** se invoca `isAdmissionArea(null)`, `isAdmissionArea(undefined)`, `isAdmissionArea(42)`, `isAdmissionArea([])`
- **THEN** retorna `false` en todos los casos

#### Scenario: `isKnownAdmissionArea` acepta los 16 valores conocidos

- **GIVEN** el back envía `"II"` (pertenece al set de 16 conocidos)
- **WHEN** se invoca `isKnownAdmissionArea("II")`
- **THEN** retorna `true`

#### Scenario: `isKnownAdmissionArea` rechaza strings fuera del set conocido

- **GIVEN** el back envía `"Z"` (no está en los 16 conocidos)
- **WHEN** se invoca `isKnownAdmissionArea("Z")`
- **THEN** retorna `false`

#### Scenario: `isKnownAdmissionArea` rechaza non-strings

- **WHEN** se invoca `isKnownAdmissionArea(null)`, `isKnownAdmissionArea(undefined)`, `isKnownAdmissionArea(42)`
- **THEN** retorna `false` en todos los casos

#### Scenario: `ADMISSION_AREAS` — tipo narrowado a `KnownAdmissionArea[]`, contenido sin cambios

- **WHEN** se lee `ADMISSION_AREAS`
- **THEN** su longitud es exactamente 16
- **AND** el orden es `['A', 'A1', 'B', 'C', 'D', 'E', 'I', 'II', 'III', 'IV', 'V', 'G', 'APT', 'CIE', 'MAT', 'GENERAL']`
- **AND** el tipo inferido de cada elemento es `KnownAdmissionArea`, no `AdmissionArea` abierto

---

### Requirement MODIFIED: `SeleccionarAdmissionAreaUseCase` — firma relajada

**Requisito base:** `SeleccionarAdmissionAreaUseCase` puro en L2

**Modificaciones:**

El parámetro `area` en `execute({ examId, area }: { examId: string; area: unknown })` sigue siendo `unknown` en el source — sin cambio estructural. El cambio es que la validación interna llama a `isAdmissionArea` cuyo contrato ya fue relajado: ahora acepta cualquier string no vacío. Por tanto:

- **ADDED** postcondición: un area `"Z"` (desconocida, válida bajo la nueva guard) SHALL ser aceptada y persisted sin lanzar `InvalidAdmissionAreaError`.
- El resto del comportamiento (inyección de `MarkingsStorage`, delegación, ausencia de side effects) permanece sin cambios.

#### Scenario: Area desconocida pero no vacía se persiste

- **GIVEN** `MarkingsStorage.setAdmissionArea` es un spy
- **WHEN** se invoca `execute({ examId: "X", area: "Z" })`
- **THEN** `setAdmissionArea` fue invocado con `("X", "Z")`
- **AND** el use case resuelve sin error

#### Scenario: Area vacía sigue lanzando `InvalidAdmissionAreaError`

- **GIVEN** `MarkingsStorage.setAdmissionArea` es un spy
- **WHEN** se invoca `execute({ examId: "X", area: "" })`
- **THEN** rechaza con `InvalidAdmissionAreaError`
- **AND** `setAdmissionArea` NUNCA fue invocado

---

### Requirement MODIFIED: `AdmissionAreaPickerComponent` — input `allowedAreas` y `visibleAreas`

**Requisito base:** `AdmissionAreaPickerComponent` en LR con dos estados

**Modificaciones:**

El componente `AdmissionAreaPickerComponent` en `src/LR_render/components/admission-area-picker/` SHALL incorporar:

1. Nuevo `@Input() allowedAreas?: readonly string[] | null` — recibe el subconjunto de áreas elegibles para el examen actual. Es opcional: si el caller no lo pasa, el comportamiento es idéntico al actual (16 chips hardcoded).
2. Propiedad computed `visibleAreas: readonly string[]`:
   - Si `allowedAreas` es `null` o `undefined` → `visibleAreas === ADMISSION_AREAS` (los 16 defaults, orden del VO).
   - Si `allowedAreas` es un array → `visibleAreas === allowedAreas` — orden del back respetado uno a uno, sin reordenamiento ni filtrado adicional.
3. El template SHALL iterar `visibleAreas` en lugar del `ADMISSION_AREAS` hardcodeado.
4. El input existente `admissionArea` cambia de tipo de `KnownAdmissionArea` (union cerrado) a `AdmissionArea` (union abierto) para aceptar strings arbitrarios del back.
5. La clase CSS `area-chip--wide-3` (que produce `grid-column: span 3`) SHALL aplicarse al chip cuyo label es exactamente `'GENERAL'`. Si `'GENERAL'` no aparece en `visibleAreas`, ningún chip recibe `area-chip--wide-3` y la grilla se adapta naturalmente.

#### Scenario: `allowedAreas` null → 16 chips en orden VO

- **GIVEN** `allowedAreas` es `null`
- **WHEN** el alumno expande el picker (long-press ≥500ms)
- **THEN** se renderizan 16 chips en el orden `['A', 'A1', 'B', 'C', 'D', 'E', 'I', 'II', 'III', 'IV', 'V', 'G', 'APT', 'CIE', 'MAT', 'GENERAL']`
- **AND** el chip `'GENERAL'` tiene la clase `area-chip--wide-3`

#### Scenario: `allowedAreas` undefined → comportamiento idéntico al null

- **GIVEN** `allowedAreas` no fue pasado (undefined)
- **WHEN** el picker se expande
- **THEN** se renderizan 16 chips (misma condición que `null`)

#### Scenario: `allowedAreas` array acotado → solo esos chips en orden del back

- **GIVEN** `allowedAreas` es `["I", "II", "APT", "GENERAL"]`
- **WHEN** el picker se expande
- **THEN** se renderizan exactamente 4 chips en el orden `["I", "II", "APT", "GENERAL"]`
- **AND** solo el chip `"GENERAL"` tiene la clase `area-chip--wide-3`
- **AND** los chips `"A"`, `"B"`, `"III"` etc. NO están presentes en el DOM

#### Scenario: `allowedAreas` con label desconocido → chip renderizado tal cual

- **GIVEN** `allowedAreas` es `["Z-CUSTOM", "APT"]`
- **WHEN** el picker se expande
- **THEN** se renderizan exactamente 2 chips: primero muestra el texto `"Z-CUSTOM"`, segundo muestra `"APT"`
- **AND** ningún chip tiene la clase `area-chip--wide-3` (ninguno es exactamente `'GENERAL'`)

#### Scenario: Chip seleccionado marcado con `--selected` dentro de subset

- **GIVEN** `allowedAreas` es `["I", "II"]`
- **AND** el `admissionArea` actual del alumno es `"I"`
- **WHEN** el picker se expande
- **THEN** el chip con texto `"I"` tiene la clase `--selected`
- **AND** el chip con texto `"II"` NO tiene `--selected`

---

## ADDED Requirements

### Requirement ADDED: `Exam.allowedAdmissionAreas` — snapshot del servidor

La entidad `Exam` en `src/L1_domain/entities/exam.ts` SHALL exponer el campo:

```
allowedAdmissionAreas: readonly string[] | null
```

Semántica:
- `null` → el examen no restringe áreas (es FICHA, o es un EXAMEN anterior al rollout de learnex PR #816). El picker muestra los 16 defaults.
- Array no vacío → subconjunto elegible declarado por el back al crear el examen. El picker muestra solo esos chips, en ese orden.

El constructor de `Exam` SHALL aplicar las siguientes invariantes al recibir el input del DTO (`admission_areas`):

| Input del DTO | Valor almacenado en `allowedAdmissionAreas` |
|---|---|
| `null` | `null` |
| `[]` (array vacío) | `null` (normalizado — "sin datos" ≡ sin restricción) |
| Array con strings no vacíos | Array con esos strings, trimmed, en el orden recibido |
| Array con strings vacíos o whitespace-only | Esos elementos se dropean. Si el array resultante es vacío → `null`. Si no → array con los restantes |
| Input que no es ni `null` ni array | Lanza `InvalidExamError` |

**Notas:**
- El orden del back es autoritativo — la entidad NO reordena.
- La entidad NO filtra por `KnownAdmissionArea` — preserva strings arbitrarios del servidor.
- `InvalidExamError` referencia la clase de error de dominio ya existente en `L1_domain/errors/`.

#### Scenario: `admission_areas: null` → `allowedAdmissionAreas === null`

- **GIVEN** el DTO tiene `admission_areas: null`
- **WHEN** se construye `Exam`
- **THEN** `exam.allowedAdmissionAreas === null`

#### Scenario: `admission_areas: []` → normalizado a `null`

- **GIVEN** el DTO tiene `admission_areas: []`
- **WHEN** se construye `Exam`
- **THEN** `exam.allowedAdmissionAreas === null`

#### Scenario: `admission_areas` con valores válidos → preservados en orden

- **GIVEN** el DTO tiene `admission_areas: ["I", "II", "APT"]`
- **WHEN** se construye `Exam`
- **THEN** `exam.allowedAdmissionAreas` es igual a `["I", "II", "APT"]` (mismo orden)

#### Scenario: `admission_areas` con label desconocido → preservado (back es autoridad)

- **GIVEN** el DTO tiene `admission_areas: ["Z", "GENERAL"]` donde `"Z"` no es un `KnownAdmissionArea`
- **WHEN** se construye `Exam`
- **THEN** `exam.allowedAdmissionAreas` es igual a `["Z", "GENERAL"]` — `"Z"` se preserva sin drop

#### Scenario: `admission_areas` con strings vacíos o whitespace → elementos droppeados

- **GIVEN** el DTO tiene `admission_areas: ["", "  ", "APT"]`
- **WHEN** se construye `Exam`
- **THEN** `exam.allowedAdmissionAreas` es igual a `["APT"]` (los vacíos/whitespace se dropean)

#### Scenario: `admission_areas` con solo strings vacíos → normalizado a `null`

- **GIVEN** el DTO tiene `admission_areas: ["", "  "]`
- **WHEN** se construye `Exam`
- **THEN** `exam.allowedAdmissionAreas === null` (todos droppeados → array vacío → null)

#### Scenario: Input no-array lanza `InvalidExamError`

- **GIVEN** el DTO tiene un campo `admission_areas` de tipo número, objeto o boolean (e.g. `42`)
- **WHEN** se intenta construir `Exam`
- **THEN** lanza `InvalidExamError`

---

### Requirement ADDED: `ExamDto` — campo `admission_areas` en L3

El mapper HTTP en `src/L3_periphery/http/http-exams-api.ts` SHALL:

1. Extender `ExamDto` con el campo `admission_areas: string[] | null`.
2. En el mapeo DTO→dominio, pasar el valor a la entity `Exam` aplicando una normalización mínima de boundary:
   - Si `Array.isArray(admission_areas)` → filtrar elementos que no sean strings (`typeof el !== 'string'`). Los strings vacíos/whitespace se dejan pasar — la entity los dropea.
   - Si `admission_areas === null` → pasar `null` directamente.
   - Si el campo está ausente en el JSON → tratar como `null`.
3. El mapper NO filtra por `KnownAdmissionArea` — solo filtra no-strings (invariante de boundary mínima). El back es la autoridad sobre qué labels son válidos.

#### Scenario: DTO con `admission_areas: null` mapea a entidad con `null`

- **GIVEN** el servidor responde con `admission_areas: null` en `GET /t/:slug/student/exam-sessions`
- **WHEN** el mapper procesa el DTO
- **THEN** la entidad `Exam` resultante tiene `allowedAdmissionAreas === null`

#### Scenario: DTO con array acotado mapea preservando orden y strings arbitrarios

- **GIVEN** el servidor responde con `admission_areas: ["II", "APT", "CUSTOM-X"]`
- **WHEN** el mapper procesa el DTO
- **THEN** la entidad `Exam` resultante tiene `allowedAdmissionAreas` igual a `["II", "APT", "CUSTOM-X"]` (orden y strings preservados)

#### Scenario: Campo ausente en JSON se trata como `null`

- **GIVEN** el servidor responde sin el campo `admission_areas` (campo no incluido en el JSON)
- **WHEN** el mapper procesa el DTO
- **THEN** la entidad `Exam` resultante tiene `allowedAdmissionAreas === null`

---

### Requirement ADDED: `SimulacroPage` propaga `allowedAdmissionAreas` al picker

`LR_render/view-models/simulacro.view-model.ts` SHALL exponer un signal derivado:

```typescript
allowedAdmissionAreas = computed(() => exam().allowedAdmissionAreas ?? null);
```

`LR_render/pages/simulacro/simulacro.page.html` SHALL pasar el binding al picker:

```html
[allowedAreas]="vm.allowedAdmissionAreas()"
```

El signal es un derivado puro — no tiene efecto secundario, no persiste, no envía requests. La lógica de qué mostrar es responsabilidad del picker (ver MODIFIED `AdmissionAreaPickerComponent`).

#### Scenario: Examen con `allowedAdmissionAreas` acotado → picker recibe subset

- **GIVEN** el examen activo tiene `allowedAdmissionAreas: ["II", "APT"]`
- **WHEN** `simulacro.page` renderiza
- **THEN** el picker recibe `allowedAreas = ["II", "APT"]`
- **AND** el picker muestra exactamente 2 chips en ese orden

#### Scenario: Examen FICHA con `allowedAdmissionAreas: null` → picker recibe null y muestra 16

- **GIVEN** el examen activo es una FICHA con `allowedAdmissionAreas: null`
- **WHEN** `simulacro.page` renderiza
- **THEN** el picker recibe `allowedAreas = null`
- **AND** el picker muestra los 16 chips en orden VO
