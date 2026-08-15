# exam-admission-areas-picker — Proposal

- **Status:** proposed
- **Depends on:** `add-admission-area` (archivado 2026-07-08). Rollout back learnex PR #816 (mergeado este fin de semana) que empezó a emitir `admission_areas` en `GET /t/:slug/student/exam-sessions`.
- **Unlocks:** que el alumno solo vea las áreas realmente elegibles para el examen tipo EXAMENES (evita marcar un área que el back luego rechaza al submit). No desbloquea features nuevas del back.
- **Coordinación con back:** el contrato ya está desplegado. Este PR es puro consumo del campo nuevo — sin flag, sin ventana de sync.
- **Contexto de urgencia:** hoy 100% de exámenes activos en prod son FICHAS con `admission_areas: null`. Ningún alumno recibe subset todavía. Este PR queda listo para cuando el equipo cree el primer EXAMEN virtual — que por ahora no existe. Cero blast radius efectivo en Fiovi al deployar.

## Terminología (recordatorio)

Sigue vigente la distinción de `add-admission-area`:

| Concepto | De dónde sale | Ejemplos |
|---|---|---|
| **Área del curso** | `Exam.area` en `GET /student/exam-sessions` | Letras, Ciencias, Números |
| **Área de postulación conocida** | `AdmissionArea` union hardcoded en `L1_domain` | A, A1, B, C, D, E, I, II, III, IV, V, APT, CIE, MAT, G, GENERAL |
| **Área de postulación del back** | `admission_areas: string[] | null` en `GET /student/exam-sessions` (learnex snapshot al CREATE del examen desde `ExamStructureArea.name`) | Cualquier string. Puede o no coincidir con las 16 conocidas. |

Nuevo en este change: **`allowedAdmissionAreas`** — subconjunto (posiblemente `null`) de áreas de postulación que el back declara como válidas para un examen puntual. En wire snake_case (`admission_areas`), en L1/L2/LR camelCase (`allowedAdmissionAreas`) para evitar leerlo como plural genérico.

## Why

Hoy `AdmissionAreaPickerComponent` renderiza los 16 chips del VO siempre (`ADMISSION_AREAS.map(...)`). Con el rollout de learnex PR #816, los exámenes tipo EXAMENES (códigos `exsi`, `exsa`, `exse` — los que tienen `ExamStructure`) llegan con un `admission_areas: string[]` acotado. Si el alumno elige uno fuera del set, el back rechaza el submit con `INVALID_ADMISSION_AREA` — error visible sólo al final, después de rellenar la cartilla completa.

Los exámenes tipo FICHAS (`exfe`, `exf1`, `exf2`, `exf3`) y los exámenes legacy anteriores al rollout siguen emitiendo `admission_areas: null`. Para ellos el picker sigue mostrando los 16 chips (comportamiento actual, sin regresión).

El change es 100% aditivo en frontend: se propaga un campo opcional desde L3 hasta LR y el picker adapta su render.

## Decisión clave — labels desconocidos del back se renderizan como pastilla

El back (learnex) tiene una convención propia de labels (`ExamStructureArea.name`, VARCHAR 80 libre — no está atada al union `AdmissionArea` de Fiovi). Cuando manda un label que **NO** existe en las 16 conocidas de Fiovi:

- El mapper NO lo dropea.
- El picker renderiza una pastilla con ese string tal cual.
- El alumno puede seleccionarlo y ese string viaja en `admission_area` del body de `/submit` / `/draft`.

Consecuencia: el union `AdmissionArea` deja de ser cerrado a nivel de tipo — pasa a `type AdmissionArea = KnownAdmissionArea | (string & {})`. Esto:
- Mantiene autocomplete de las 16 conocidas en el IDE.
- Acepta cualquier string donde antes solo aceptaba las 16.
- Preserva el `isAdmissionArea` guard existente como "es un string no vacío" (validación mínima de boundary).

La razón: el back es la autoridad sobre qué áreas existen. Fiovi no puede rechazar labels válidos del servidor solo porque no los tenía hardcoded — sería fricción arbitraria para el alumno.

## What Changes

**L1 dominio**
- `L1_domain/value-objects/admission-area.ts`:
  - Renombrar el union actual de 16 valores a `type KnownAdmissionArea`.
  - Nuevo `type AdmissionArea = KnownAdmissionArea | (string & {})`. Los llamadores externos ven `AdmissionArea` (abierto); el default y el picker default siguen usando `KnownAdmissionArea`.
  - `ADMISSION_AREAS: readonly KnownAdmissionArea[]` (los 16 hardcoded, sin cambios — sigue siendo el default de render).
  - `isAdmissionArea(v)` guard actualizado: acepta cualquier string non-empty (era: acepta solo si está en el set de 16). Comentario explícito de por qué se relaja.
  - Nuevo helper `isKnownAdmissionArea(v)` para call sites que necesiten distinguir (ej. el picker aplica el layout `span-3` solo si `'GENERAL'` es una `KnownAdmissionArea` en la lista visible).
- `L1_domain/entities/exam.ts`:
  - `Exam` gana campo `allowedAdmissionAreas: readonly string[] | null`.
  - Constructor valida: `null` O array non-empty de strings non-empty. `[]` → normaliza a `null`. Un elemento inválido (no-string, vacío) → drop silencioso; si el array queda vacío tras el drop → `null`.
  - No usa `AdmissionArea` (union) en la firma — el back puede mandar strings arbitrarios y el dominio los preserva tal cual.

**L3 periphery**
- `L3_periphery/http/http-exams-api.ts`:
  - `ExamDto` gana `admission_areas: string[] | null`.
  - Mapper dto→domain: pasa el array tal cual a la entity (con normalización mínima: `Array.isArray` guard + filter de strings no vacíos). No drop por "unknown"; sí drop por "no-string".

**LR render**
- `LR_render/components/admission-area-picker/admission-area-picker.component.ts`:
  - Nuevo `@Input() allowedAreas?: readonly string[] | null`.
  - Computed `visibleAreas: readonly string[]`:
    - Si `allowedAreas` es null/undefined → devuelve `ADMISSION_AREAS` (los 16 default, orden del VO).
    - Si `allowedAreas` es array → devuelve el array **tal cual** (respeta el orden que envió el back — learnex ya ordena por `ExamStructureArea.order asc`).
  - Cambiar el tipo del `@Input() admissionArea` de `AdmissionArea` (union cerrado) al nuevo `AdmissionArea` (abierto).
- `admission-area-picker.component.html`:
  - Iterar `visibleAreas` en vez de `areas`.
  - El class `area-chip--wide-3` (span-3 grid) sigue aplicando cuando el label es exactamente `'GENERAL'`. Con subset del back que no incluya `GENERAL`, ese class nunca activa y todos los chips son igual anchos (layout se adapta natural).
- `LR_render/view-models/simulacro.view-model.ts`:
  - Signal derivado `allowedAdmissionAreas = computed(() => exam().allowedAdmissionAreas)`.
- `LR_render/pages/simulacro/simulacro.page.html`:
  - Pasar `[allowedAreas]="vm.allowedAdmissionAreas()"` al picker.

**Sin cambio en:**
- `ADMISSION_AREAS` constante (mismo orden, mismo contenido — es el default cuando `allowedAreas` es null).
- `DEFAULT_ADMISSION_AREA = 'GENERAL'` (el default no depende del set permitido — si `GENERAL` no está en `allowedAreas` el alumno lo verá filtrado y elegirá otro; ver "Fuera de scope").
- `MarkingsStorage` (persistencia local intacta).
- `EnvioRequest` / `DraftRequest` / body wire (`admission_area` sigue siendo un string — antes eran solo los 16 valores del union; ahora puede ser cualquier string del back).
- `SeleccionarAdmissionAreaUseCase` — ajuste menor: la firma cambia de `AdmissionArea` (union cerrado) al nuevo `AdmissionArea` (abierto). No hay lógica nueva; solo el tipo se relaja.
- Long-press, gesto expandir/colapsar, chip flotante.

## Capabilities

### Modified Capabilities

- `admission-area` (MINOR, no-breaking):
  - El `AdmissionAreaPickerComponent` acepta un input opcional `allowedAreas` que restringe el grid renderizado. Cuando es `null`/`undefined`, comportamiento idéntico al actual (16 chips hardcoded). Cuando es un array de strings, sólo esos chips se renderizan **en el orden que envía el back** (learnex ya ordena por `ExamStructureArea.order asc`).
  - El union `AdmissionArea` se convierte en abierto (`KnownAdmissionArea | (string & {})`) para preservar strings arbitrarios del back. Los 16 valores hardcoded quedan como `KnownAdmissionArea` para autocomplete y para el default.
  - Layout `grid-column: span 3` de `GENERAL` sigue aplicando cuando `GENERAL` está en el set visible.

**Sin capabilities nuevas.** No se toca `exam-submission`, `submit-progress-snapshot`, `exam-marking`, ni `http-client`.

## Fuera de scope (decisiones explícitas)

- **Alumno con área persistida que ya no está en `allowedAreas`**: confirmado con producto — el `allowedAdmissionAreas` se snapshotea al crear el examen en learnex; el alumno elige por examen. En la práctica no ocurre que un alumno tenga un área previa fuera del set. No se agrega lógica de "reset a DEFAULT si el area actual quedó filtrada".
- **Pre-validación de `admission_area` en frontend antes del submit**: no. El submit sigue confiando en el server. El picker filtra la UI para que el alumno no llegue a esa situación.
- **Registrar/warn labels desconocidos del back**: no. Se renderizan como pastilla y punto. El back es la autoridad.
- **Cambiar el contrato de storage/persistencia**: no. `MarkingsStorage.getAdmissionArea` / `setAdmissionArea` intactos (siguen aceptando cualquier string — antes recibían `AdmissionArea` union cerrado, ahora reciben `AdmissionArea` abierto).
- **`allowedAreas === []` desde el back**: se normaliza a `null` en el constructor de `Exam`. No se soporta el estado "examen sin áreas válidas" (semánticamente absurdo).

## Impact

- **Archivos frontend estimados:** 7 archivos de producción (~55 LOC), 4 archivos de test (~110 LOC).
  1. `src/L1_domain/value-objects/admission-area.ts` — union abierto + guard relajado + `isKnownAdmissionArea` helper.
  2. `src/L1_domain/entities/exam.ts` — `Exam` con `allowedAdmissionAreas: readonly string[] | null`.
  3. `src/L3_periphery/http/http-exams-api.ts` — `ExamDto` + mapper pasa strings tal cual.
  4. `src/LR_render/components/admission-area-picker/admission-area-picker.component.ts` — `@Input() allowedAreas` + `visibleAreas` computed.
  5. `src/LR_render/components/admission-area-picker/admission-area-picker.component.html` — bind a `visibleAreas`.
  6. `src/LR_render/view-models/simulacro.view-model.ts` — signal derivado `allowedAdmissionAreas`.
  7. `src/LR_render/pages/simulacro/simulacro.page.html` — prop `[allowedAreas]`.
- **Rollback:** revert quirúrgico del PR. Todo el cambio es aditivo con default backward-compatible.
- **Sin migración de datos, sin flag, sin ventana de deploy.** Prod hoy tiene 100% FICHAS con `admission_areas: null` — el path del cambio no activa hasta que el equipo cree el primer EXAMEN virtual.
- **Sub-agentes obligatorios (regla CLAUDE.md #3):**
  - `frontend-builder` para el input del picker y el wiring en view-model + page.
  - `test-engineer` para tests L3 (mapper: `null`, `[]`, subset con strings arbitrarios), L1 (constructor de `Exam` con array vacío / null / válido / con strings mixed), LR (picker renderiza subset con orden del back preservado; label unknown renderiza pastilla; view-model derivado).
  - `hexagonal-guard` bloqueante antes de archivar (audita que el picker no importe L3; que el signal del view-model sea puro derivado; que el union abierto no filtre a otras capas que necesiten cerrado).

## Riesgos (small — cambio puramente aditivo de UI)

1. **Drift de contrato back con strings arbitrarios**: por diseño se acepta cualquier string. El único límite es "string no vacío". Un caso patológico (back manda `"   "` con solo espacios) sería raro; el mapper filtra `.trim().length === 0` para cerrar ese hueco.
2. **`admission_areas: []` en respuesta**: puede aparecer en edge cases (Postgres NULL malmapeado a array vacío en algún serializer). Mitigación: normalización explícita a `null` en el constructor de `Exam`.
3. **Orden del payload no coincide con el orden esperado del VO**: no hay orden esperado ahora. El array del back se respeta tal cual (learnex ordena por `ExamStructureArea.order asc`). Si el back envía `["GENERAL", "APT", "II"]`, esos son los chips en ese orden.
4. **Perder type safety en llamadores que dependían del union cerrado**: el `KnownAdmissionArea` sigue disponible para call sites que quieran narrow. El default de storage (`DEFAULT_ADMISSION_AREA = 'GENERAL'`) sigue siendo `KnownAdmissionArea`, no `AdmissionArea` abierto — mantiene garantías.
