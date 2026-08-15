# tutor-exams-api — Specification

## Purpose

Defines the tutor-side API boundary for virtual exam management in Fiovi. Exposes a hexagonal port `TutorExamsApi` (L1), 6 pure use-cases (L2), the HTTP adapter `HttpTutorExamsApi` with status-based error classification (L3), and the read-models / domain errors introduced by the `tutor-exam-management` change. The student `ExamsApi` port is untouched. All tutor actions are online-only (no outbox, no IndexedDB).

## Requirements

### Requirement: TutorExamsApi port en L1

El puerto `TutorExamsApi` (`src/L1_domain/ports/tutor-exams-api.ts`) SHALL declarar exactamente 7 métodos:

```
getTutorExams(): Promise<readonly TutorExam[]>
getExamDetail(recordId: string): Promise<TutorExamDetail>
listClassroomStudents(req: { classroomId: string; virtualExamDetailId: string }): Promise<readonly ClassroomStudent[]>
updateEnabledStudents(req: { recordId: string; enabledStudentIds: readonly string[] }): Promise<void>
iniciar(recordId: string, duration?: number): Promise<void>
finalizar(recordId: string): Promise<FinalizeResult>
refreshEnabled(recordId: string): Promise<{ addedCount: number; totalEnabledCount: number }>
```

El puerto `ExamsApi` (alumno) SHALL NOT ser extendido ni modificado. Un comentario inline SHALL documentar el mapeo de errores HTTP por STATUS para cada método (ver Requirement: Clasificación de errores del tutor por status).

#### Scenario: Port expone los 7 métodos exactos

- **WHEN** se inspecciona la interfaz `TutorExamsApi`
- **THEN** existen exactamente los 7 métodos con las firmas declaradas arriba
- **AND** `ExamsApi` (alumno) no ha sido modificado

#### Scenario: Port NOT depende de implementaciones concretas

- **WHEN** se inspecciona `src/L1_domain/ports/tutor-exams-api.ts`
- **THEN** no importa `HttpClient`, `Injectable`, ni ningún símbolo de Angular
- **AND** solo importa tipos de dominio (`TutorExam`, `TutorExamDetail`, `ClassroomStudent`, `FinalizeResult`)

---

### Requirement: Read-models TutorExam, TutorExamDetail, ClassroomStudent y FinalizeResult en L1

**`TutorExam`** (`src/L1_domain/entities/tutor-exam.ts`) SHALL ser una clase con:
- Campos: `detailId: string`, `recordId: string`, `classroomId: string`, `serverStatus: ExamServerStatus`, `name: string`, `course: string | null`, `area: string | null`, `count: number | null`, `duration: number` (segundos), `scheduled: Date`, `startedAt: Date | null`, `finishedAt: Date | null`.
- Getter derivado: `durationInMinutes: number` — retorna `Math.round(duration / 60)`.
- Helpers: `puedeIniciar(): boolean` (retorna `serverStatus.is('scheduled')`), `puedeFinalizar(): boolean` (retorna `serverStatus.is('in_progress')`), `estaFinalizado(): boolean` (retorna `serverStatus.is('finalized')` o `esTerminal()`).
- Reusar `ExamServerStatus` (`src/L1_domain/value-objects/exam-server-status.ts`) sin modificarlo.

**`TutorExamDetail`** (`src/L1_domain/value-objects/tutor-exam-detail.ts`) SHALL ser un tipo/clase con:
- Campos: `id: string` (detailId), `recordId: string`, `status: ExamServerStatus`, `name: string`, `course: string | null`, `area: string | null`, `count: number | null`, `duration: number`, `enabledStudentIds: readonly string[]`, `startedAt: Date | null`, `finishedAt: Date | null`, `createdAt: Date`.
- NOT incluye `classroomId` (el backend no lo devuelve en el detalle).

**`ClassroomStudent`** (`src/L1_domain/value-objects/classroom-student.ts`) SHALL ser un tipo/clase con:
- Campos: `studentId: string`, `studentCode: string`, `firstName: string`, `lastName: string`, `enabled: boolean`, `hasSubmitted: boolean`.

**`FinalizeResult`** SHALL ser el tipo: `{ transitioned: boolean; jobId?: string }`.

**Errores de dominio nuevos** (cada uno en su archivo bajo `src/L1_domain/errors/`):
- `VirtualExamNotFoundError` — status 404
- `ExamConflictError` — status 409
- `ExamPreconditionError` — status 422
- `TutorExamForbiddenError` — status 403

Reusar (sin modificar): `NetworkError`, `InvalidPayloadError`.

#### Scenario: TutorExam.puedeIniciar retorna true solo para scheduled

- **GIVEN** un `TutorExam` construido con `status: 'scheduled'`
- **WHEN** se invoca `puedeIniciar()`
- **THEN** retorna `true`

- **GIVEN** un `TutorExam` construido con `status: 'in_progress'`
- **WHEN** se invoca `puedeIniciar()`
- **THEN** retorna `false`

- **GIVEN** un `TutorExam` construido con `status: 'finalized'`
- **WHEN** se invoca `puedeIniciar()`
- **THEN** retorna `false`

#### Scenario: TutorExam.puedeFinalizar retorna true solo para in_progress

- **GIVEN** un `TutorExam` construido con `status: 'in_progress'`
- **WHEN** se invoca `puedeFinalizar()`
- **THEN** retorna `true`

- **GIVEN** un `TutorExam` construido con `status: 'scheduled'` o `'finalized'`
- **WHEN** se invoca `puedeFinalizar()`
- **THEN** retorna `false`

#### Scenario: TutorExam.estaFinalizado retorna true solo para finalized

- **GIVEN** un `TutorExam` construido con `status: 'finalized'`
- **WHEN** se invoca `estaFinalizado()`
- **THEN** retorna `true`

#### Scenario: count null y course/area null son tipos válidos

- **GIVEN** un `TutorExam` construido con `count: null`, `course: null` y `area: null`
- **WHEN** se inspecciona el tipo
- **THEN** TypeScript compila sin error — `number | null` y `string | null` son parte del contrato

#### Scenario: TutorExam.durationInMinutes redondea desde segundos

- **GIVEN** un `TutorExam` con `duration: 3600`
- **WHEN** se lee `tutorExam.durationInMinutes`
- **THEN** retorna `60`

- **GIVEN** un `TutorExam` con `duration: 90`
- **WHEN** se lee `tutorExam.durationInMinutes`
- **THEN** retorna `2` (`Math.round(90 / 60) === 2`)

#### Scenario: TutorExam NO expone entryId ni createdAt (schema post-migración)

- **WHEN** se inspecciona la clase `TutorExam`
- **THEN** no existe la propiedad `entryId`
- **AND** no existe la propiedad `createdAt`
- **AND** sí existe `scheduled: Date`

#### Scenario: TutorExamDetail NOT incluye classroomId ni courseId

- **WHEN** se inspecciona la interfaz/clase `TutorExamDetail`
- **THEN** no existe el campo `classroomId`
- **AND** no existe el campo `courseId`
- **AND** sí existen `course: string | null` y `area: string | null`
- **AND** sí existe `enabledStudentIds: readonly string[]`

#### Scenario: ExamServerStatus se reutiliza sin modificar

- **WHEN** se inspecciona `src/L1_domain/value-objects/exam-server-status.ts` después del change
- **THEN** su contenido es idéntico al previo al change (sin modificaciones)

---

### Requirement: Contrato HTTP — GET /tutor/virtual-exams (lista)

`HttpTutorExamsApi.getTutorExams()` SHALL emitir `GET` a `apiPath.tutorVirtualExams()`. La URL resultante SHALL ser `<base>/tutor/virtual-exams`. La respuesta esperada es HTTP 200 con body `{ items: TutorVirtualExamListItemDto[] }`. El método SHALL mapear cada item del DTO al read-model `TutorExam`:
- `dto.id` → `detailId`
- `dto.recordId` → `recordId`
- `dto.classroomId` → `classroomId`
- `dto.status` → `new ExamServerStatus(dto.status)`
- `dto.name` → `name`
- `dto.course` → `course` (null si ausente)
- `dto.area` → `area` (null si ausente)
- `dto.count` → `count` (null si ausente)
- `dto.duration` → `duration`
- `dto.scheduled` → `new Date(dto.scheduled)`
- `dto.startedAt` → `new Date(dto.startedAt)` si no null, else null
- `dto.finishedAt` → `new Date(dto.finishedAt)` si no null, else null

El DTO NO trae `entryId`, `courseId` ni `createdAt` (obsoletos post-migración a snapshots plain-text).

`withCredentials` lo agrega el `credentials.interceptor` global — el adapter NOT SHALL setearlo manualmente. Timeout: 10 s.

#### Scenario: URL armada con apiPath.tutorVirtualExams

- **GIVEN** `environment.tenantSlug = "vonex"`, `environment.apiBaseUrl = "http://api.example.com"`
- **WHEN** se invoca `getTutorExams()`
- **THEN** la URL del request es `"http://api.example.com/t/vonex/tutor/virtual-exams"`

#### Scenario: Mapping camelCase → TutorExam con snapshots plain-text

- **GIVEN** el backend responde HTTP 200 con:
  ```json
  { "items": [{ "id": "det-1", "recordId": "rec-1", "classroomId": "cls-1",
    "status": "scheduled", "name": "Examen Aritmética", "course": "Aritmética",
    "area": "Matemáticas", "count": 20, "duration": 3600,
    "scheduled": "2026-06-01T10:00:00Z", "startedAt": null, "finishedAt": null }] }
  ```
- **WHEN** `getTutorExams()` resuelve
- **THEN** retorna un array con 1 `TutorExam` donde:
  - `detailId === "det-1"`, `recordId === "rec-1"`, `classroomId === "cls-1"`
  - `course === "Aritmética"`, `area === "Matemáticas"`, `count === 20`
  - `serverStatus.value === "scheduled"`
  - `scheduled` es instancia de `Date`
  - NO existe `entryId`, `courseId`, ni `createdAt`

#### Scenario: count null en la lista → campo null (no undefined)

- **GIVEN** el backend devuelve `count: null` en un item
- **WHEN** se mapea al `TutorExam`
- **THEN** `tutorExam.count === null` (no `undefined`)

#### Scenario: course y area null se preservan

- **GIVEN** el backend devuelve `course: null` y `area: null` en un item
- **WHEN** se mapea al `TutorExam`
- **THEN** `tutorExam.course === null` y `tutorExam.area === null`

#### Scenario: startedAt como string ISO → Date

- **GIVEN** el backend devuelve `startedAt: "2026-06-10T08:00:00Z"` en un item
- **WHEN** se mapea al `TutorExam`
- **THEN** `tutorExam.startedAt` es una instancia de `Date` con el valor correcto

#### Scenario: Error en getTutorExams → clasifica por status

- **WHEN** el backend responde 403
- **THEN** `getTutorExams()` rechaza con `TutorExamForbiddenError`

---

### Requirement: Contrato HTTP — GET /virtual-exams/:recordId (detalle)

`HttpTutorExamsApi.getExamDetail(recordId)` SHALL emitir `GET` a `apiPath.virtualExam(recordId)`. La URL SHALL ser `<base>/virtual-exams/<encodedRecordId>`. La respuesta esperada es HTTP 200 con `VirtualExamDetailDto` que incluye `enabledStudentIds: string[]`. El método SHALL mapear el DTO a `TutorExamDetail`:
- `dto.id` → `id` (detailId)
- `dto.recordId` → `recordId`
- `dto.status` → `new ExamServerStatus(dto.status)` (puede incluir `'archived'` — ExamServerStatus SOLO valida `scheduled|in_progress|finalized`; si llega `archived` deberá ser ignorado o guardado como raw; este edge case es fuera de scope por filtro server-side)
- `dto.course` → `course` (null si ausente)
- `dto.area` → `area` (null si ausente)
- Los campos escalares restantes se mapean igual que en la lista (mismos nullables, mismo `string → Date`)
- `dto.enabledStudentIds` → `enabledStudentIds`

El DTO NO trae `courseId` (obsoleto post-migración a snapshots plain-text).

#### Scenario: URL usa encodeURIComponent sobre recordId

- **GIVEN** `recordId = "rec-123"`
- **WHEN** se invoca `getExamDetail("rec-123")`
- **THEN** la URL del request es `"<base>/virtual-exams/rec-123"`

#### Scenario: Mapping incluye enabledStudentIds

- **GIVEN** el backend responde HTTP 200 con `{ ..., "enabledStudentIds": ["s-1","s-2"] }`
- **WHEN** `getExamDetail()` resuelve
- **THEN** `tutorExamDetail.enabledStudentIds` es `["s-1","s-2"]`

#### Scenario: enabledStudentIds vacío → array vacío

- **GIVEN** el backend devuelve `"enabledStudentIds": []`
- **WHEN** `getExamDetail()` resuelve
- **THEN** `tutorExamDetail.enabledStudentIds.length === 0`

#### Scenario: 404 en getExamDetail → VirtualExamNotFoundError

- **WHEN** el backend responde HTTP 404
- **THEN** `getExamDetail()` rechaza con `VirtualExamNotFoundError`

---

### Requirement: Contrato HTTP — GET /classrooms/:classroomId/students?virtualExamDetailId= (alumnos del aula)

`HttpTutorExamsApi.listClassroomStudents({ classroomId, virtualExamDetailId })` SHALL emitir `GET` a `apiPath.classroomStudents(classroomId, virtualExamDetailId)`. La URL SHALL ser `<base>/classrooms/<encodedClassroomId>/students?virtualExamDetailId=<encodedDetailId>`. La respuesta esperada es HTTP 200 con body `{ students: ClassroomStudentDto[] }`. El método SHALL mapear cada item a `ClassroomStudent` (1:1, todos los campos primitivos).

#### Scenario: URL incluye classroomId en path y virtualExamDetailId en query

- **GIVEN** `classroomId = "cls-1"`, `virtualExamDetailId = "det-1"`
- **WHEN** se invoca `listClassroomStudents({ classroomId: "cls-1", virtualExamDetailId: "det-1" })`
- **THEN** la URL del request es `"<base>/classrooms/cls-1/students?virtualExamDetailId=det-1"`

#### Scenario: virtualExamDetailId toma el detailId (dto.id), no el recordId

- **GIVEN** un `TutorExam` con `detailId = "det-abc"` y `recordId = "rec-xyz"`
- **WHEN** la VM invoca `listClassroomStudents({ classroomId, virtualExamDetailId: "det-abc" })`
- **THEN** la URL tiene `virtualExamDetailId=det-abc` (no `rec-xyz`)

#### Scenario: Mapping ClassroomStudentDto → ClassroomStudent

- **GIVEN** el backend responde con `{ students: [{ studentId:"s1", studentCode:"0001", firstName:"Ana", lastName:"García", enabled:true, hasSubmitted:false }] }`
- **WHEN** `listClassroomStudents()` resuelve
- **THEN** retorna `[{ studentId:"s1", studentCode:"0001", firstName:"Ana", lastName:"García", enabled:true, hasSubmitted:false }]`

#### Scenario: hasSubmitted:true se preserva en el read-model

- **GIVEN** el backend devuelve `hasSubmitted: true` para un alumno
- **WHEN** `listClassroomStudents()` resuelve
- **THEN** `classroomStudent.hasSubmitted === true`

#### Scenario: 403 en listClassroomStudents → TutorExamForbiddenError

- **WHEN** el backend responde HTTP 403
- **THEN** `listClassroomStudents()` rechaza con `TutorExamForbiddenError`

---

### Requirement: Contrato HTTP — PATCH /virtual-exams/:recordId/enabled-students

`HttpTutorExamsApi.updateEnabledStudents({ recordId, enabledStudentIds })` SHALL emitir `PATCH` a `apiPath.virtualExamEnabledStudents(recordId)` con body JSON `{ enabledStudentIds: string[] }`. La respuesta esperada es HTTP 200 con body vacío. El método SHALL resolver con `void`.

#### Scenario: URL y body del PATCH

- **GIVEN** `recordId = "rec-1"`, `enabledStudentIds = ["s-1","s-2"]`
- **WHEN** se invoca `updateEnabledStudents({ recordId: "rec-1", enabledStudentIds: ["s-1","s-2"] })`
- **THEN** la request es `PATCH <base>/virtual-exams/rec-1/enabled-students`
- **AND** el body es `{ "enabledStudentIds": ["s-1","s-2"] }`

#### Scenario: 200 vacío resuelve void

- **WHEN** el backend responde HTTP 200 con body vacío
- **THEN** `updateEnabledStudents()` resuelve con `undefined`

#### Scenario: 409 en updateEnabledStudents → ExamConflictError

- **WHEN** el backend responde HTTP 409 (alumno con hasSubmitted intentado remover)
- **THEN** `updateEnabledStudents()` rechaza con `ExamConflictError`

#### Scenario: 422 en updateEnabledStudents → ExamPreconditionError

- **WHEN** el backend responde HTTP 422 (examen ya finalizado, set congelado)
- **THEN** `updateEnabledStudents()` rechaza con `ExamPreconditionError`

---

### Requirement: Contrato HTTP — POST /virtual-exams/:recordId/start

`HttpTutorExamsApi.iniciar(recordId, duration?)` SHALL emitir `POST` a `apiPath.virtualExamStart(recordId)`. Cuando `duration` viene definido (segundos), el body es `{ duration: <número> }`; cuando es `undefined`, el body es `null` — el back mantiene la duración con la que se creó el examen. La respuesta esperada es HTTP 204 sin body. El método SHALL resolver con `void`.

Rango válido del back: `60 ≤ duration ≤ 7200` segundos. El cliente valida antes de invocar (defensa en profundidad); el back rechaza con 400 (`InvalidPayloadError`) si viene fuera de rango.

#### Scenario: iniciar sin duration — body null

- **GIVEN** `recordId = "rec-1"`
- **WHEN** se invoca `iniciar("rec-1")` sin segundo argumento
- **THEN** la request es `POST <base>/virtual-exams/rec-1/start`
- **AND** el body del request es `null` (no `{ duration: ... }`)

#### Scenario: iniciar con duration override — body { duration }

- **GIVEN** `recordId = "rec-1"`
- **WHEN** se invoca `iniciar("rec-1", 1800)`
- **THEN** la request es `POST <base>/virtual-exams/rec-1/start`
- **AND** el body del request es `{ "duration": 1800 }`

#### Scenario: 204 resuelve void

- **WHEN** el backend responde HTTP 204 sin body
- **THEN** `iniciar()` resuelve con `undefined`

#### Scenario: 400 en iniciar → InvalidPayloadError (duration fuera de rango)

- **WHEN** el backend responde HTTP 400 (duración < 60 o > 7200)
- **THEN** `iniciar()` rechaza con `InvalidPayloadError`

#### Scenario: 409 en iniciar → ExamConflictError

- **WHEN** el backend responde HTTP 409 (examen ya iniciado)
- **THEN** `iniciar()` rechaza con `ExamConflictError`

#### Scenario: 422 en iniciar → ExamPreconditionError

- **WHEN** el backend responde HTTP 422 (0 alumnos habilitados, o claves no configuradas)
- **THEN** `iniciar()` rechaza con `ExamPreconditionError`

---

### Requirement: Contrato HTTP — POST /virtual-exams/:recordId/finalize

`HttpTutorExamsApi.finalizar(recordId)` SHALL emitir `POST` a `apiPath.virtualExamFinalize(recordId)` SIN body. La respuesta esperada es HTTP 200 (NO 202 ni 204) con body `{ transitioned: boolean; jobId?: string }`. El método SHALL retornar `FinalizeResult` mapeado del DTO (1:1).

**Nota crítica**: el controller del backend tiene un comentario con 202, pero la implementación devuelve 200. El adapter SHALL esperar 200. Un comentario inline SHALL documentar esta discrepancia referenciando el PR #276.

#### Scenario: URL del POST finalize, sin body

- **GIVEN** `recordId = "rec-1"`
- **WHEN** se invoca `finalizar("rec-1")`
- **THEN** la request es `POST <base>/virtual-exams/rec-1/finalize`
- **AND** el body de la request está vacío o ausente

#### Scenario: 200 con transitioned:true — primera finalización

- **WHEN** el backend responde HTTP 200 con `{ "transitioned": true, "jobId": "job-xyz" }`
- **THEN** `finalizar()` resuelve con `{ transitioned: true, jobId: "job-xyz" }`

#### Scenario: 200 con transitioned:false — ya estaba finalizado (idempotente)

- **WHEN** el backend responde HTTP 200 con `{ "transitioned": false }`
- **THEN** `finalizar()` resuelve con `{ transitioned: false, jobId: undefined }`
- **AND** NO se rechaza con error — `transitioned:false` es respuesta válida exitosa

#### Scenario: jobId es opcional — ausente en 200 → undefined en FinalizeResult

- **WHEN** el backend responde HTTP 200 con `{ "transitioned": true }` sin `jobId`
- **THEN** `finalizar()` resuelve con `{ transitioned: true, jobId: undefined }`

#### Scenario: 409 en finalizar → ExamConflictError

- **WHEN** el backend responde HTTP 409
- **THEN** `finalizar()` rechaza con `ExamConflictError`

#### Scenario: 422 en finalizar → ExamPreconditionError

- **WHEN** el backend responde HTTP 422 (examen aún en scheduled, no iniciado)
- **THEN** `finalizar()` rechaza con `ExamPreconditionError`

---

### Requirement: Clasificación de errores del tutor por status (classifyTutorError)

`HttpTutorExamsApi` SHALL exponer un método privado `classifyTutorError(err: unknown): Error` que clasifica errores HTTP exclusivamente por **HTTP status** según la tabla siguiente. El clasificador SHALL NOT leer `body.message` ni `body.code` para ninguna de las categorías de la tabla — la clasificación es por status puro.

| HTTP Status | Error de dominio |
|---|---|
| 400 | `InvalidPayloadError` |
| 401 | manejado por `credentials.interceptor` (refresh + retry) — no llega al clasificador |
| 403 | `TutorExamForbiddenError` |
| 404 | `VirtualExamNotFoundError` |
| 409 | `ExamConflictError` |
| 422 | `ExamPreconditionError` |
| 0 / 429 / 5xx | `NetworkError` |
| timeout / transporte | `NetworkError` |

Justificación (SHALL estar en comentario inline): el backend del tutor emite `code` genéricos (`forbidden`, `not_found`, `conflict`, `unprocessable_entity`) y `message` en prosa variable (inglés + español). No son contrato de control en mayúsculas snake_case como el flujo del alumno. Clasificar por status es suficiente para routing de error en la VM y es robusto a cambios de copy del back.

#### Scenario: 400 → InvalidPayloadError

- **WHEN** cualquier endpoint del tutor responde HTTP 400
- **THEN** el método del port rechaza con `InvalidPayloadError`

#### Scenario: 403 → TutorExamForbiddenError

- **WHEN** cualquier endpoint del tutor responde HTTP 403
- **THEN** el método del port rechaza con `TutorExamForbiddenError`

#### Scenario: 404 → VirtualExamNotFoundError

- **WHEN** cualquier endpoint del tutor responde HTTP 404
- **THEN** el método del port rechaza con `VirtualExamNotFoundError`

#### Scenario: 409 → ExamConflictError

- **WHEN** cualquier endpoint del tutor responde HTTP 409
- **THEN** el método del port rechaza con `ExamConflictError`

#### Scenario: 422 → ExamPreconditionError

- **WHEN** cualquier endpoint del tutor responde HTTP 422
- **THEN** el método del port rechaza con `ExamPreconditionError`

#### Scenario: 0 / 429 / 5xx → NetworkError

- **WHEN** cualquier endpoint del tutor responde HTTP 0, 429, 500, 502, 503 o 504
- **THEN** el método del port rechaza con `NetworkError`

#### Scenario: Timeout → NetworkError

- **WHEN** la request supera el timeout de 10 s (`timeout(10_000)`)
- **THEN** el método del port rechaza con `NetworkError`

#### Scenario: Clasificador NO lee body.message ni body.code

- **WHEN** se inspecciona `HttpTutorExamsApi.classifyTutorError`
- **THEN** no aparecen comparaciones de `body.message` ni de `body.code` para determinar el tipo de error
- **AND** la clasificación usa exclusivamente `err.status`

---

### Requirement: REQ-API-1 — Método `refreshEnabled` en el puerto `TutorExamsApi` (L1)

El puerto `TutorExamsApi` (`src/L1_domain/ports/tutor-exams-api.ts`) SHALL declarar un 7mo método:

```
refreshEnabled(recordId: string): Promise<{ addedCount: number; totalEnabledCount: number }>
```

El método es L1 puro — solo declara la firma como parte de la interfaz, sin implementación. La interfaz pasa de tener 6 a tener exactamente 7 métodos. Un comentario inline SHALL documentar el mapeo de errores HTTP por status para este método (ver REQ-API-2).

El puerto SHALL NOT importar `HttpClient`, `Injectable`, ni ningún símbolo de Angular.

#### Scenario: Puerto expone exactamente 7 métodos después del delta

- **WHEN** se inspecciona la interfaz `TutorExamsApi` post-change
- **THEN** existen exactamente 7 métodos, siendo el 7mo `refreshEnabled(recordId: string): Promise<{ addedCount: number; totalEnabledCount: number }>`
- **AND** `ExamsApi` (alumno) no ha sido modificado

#### Scenario: `refreshEnabled` retorna la forma `{ addedCount, totalEnabledCount }`

- **WHEN** se inspecciona la firma del método `refreshEnabled`
- **THEN** el tipo de retorno es `Promise<{ addedCount: number; totalEnabledCount: number }>`
- **AND** ambos campos son `number` no opcional

#### Scenario: L1 no importa dependencias no-puras

- **WHEN** se inspecciona `src/L1_domain/ports/tutor-exams-api.ts` después del change
- **THEN** no importa `HttpClient`, `Injectable`, ni ningún símbolo de `@angular/*`

---

### Requirement: REQ-API-3 — Helper de URL `virtualExamRefreshEnabled` en `api-paths.ts`

`api-paths.ts` (`src/L3_periphery/http/api-paths.ts`) SHALL exponer un nuevo helper:

```
virtualExamRefreshEnabled(slug: string, recordId: string): string
```

La URL retornada SHALL ser `/t/{slug}/virtual-exams/{recordId}/refresh-enabled` (prefijada por `apiBaseUrl` si el helper sigue el patrón existente de prefijo en todos los helpers del archivo).

#### Scenario: URL construida correctamente

- **GIVEN** `slug = "vonex"` y `recordId = "rec-123"`
- **WHEN** se invoca `apiPaths.virtualExamRefreshEnabled("vonex", "rec-123")`
- **THEN** retorna una URL que termina en `/t/vonex/virtual-exams/rec-123/refresh-enabled`

#### Scenario: Slug y recordId son parámetros, no hardcoded

- **WHEN** se inspecciona la implementación de `virtualExamRefreshEnabled`
- **THEN** no aparece ningún slug hardcoded (ej: `"vonex"`, `"pitagoras"`) en la URL
- **AND** ambos parámetros `slug` y `recordId` son interpolados dinámicamente

---

### Requirement: REQ-API-2 — Adapter HTTP `HttpTutorExamsApi.refreshEnabled`

`HttpTutorExamsApi` (`src/L3_periphery/http/http-tutor-exams-api.ts`) SHALL implementar el método `refreshEnabled(recordId: string)`:

- Emite `POST` a la URL construida por `apiPaths.virtualExamRefreshEnabled(slug, recordId)`.
- Sin body en el request (body `null` o ausente).
- Timeout 10 s — mismo patrón que los otros métodos del adapter.
- `withCredentials: true` es agregado por el interceptor global `credentials.interceptor` — el adapter NOT SHALL setearlo manualmente.
- Slug se lee del `SlugStore` cache de forma síncrona (sin `await`), consistente con el resto de métodos del adapter.
- Response se valida con un schema Zod: `{ addedCount: z.number(), totalEnabledCount: z.number() }`.
- Errores se clasifican por status HTTP exclusivamente usando el clasificador `classifyTutorError` existente:

| HTTP Status | Error de dominio |
|---|---|
| 403 | `TutorExamForbiddenError` |
| 404 | `VirtualExamNotFoundError` (examen no existe o slug incorrecto) |
| 409 | `ExamConflictError` (status no es `scheduled`) |
| 422 | `ExamPreconditionError` (validación de UUID u otros) |
| 0 / 429 / 5xx | `NetworkError` |
| timeout / transporte | `NetworkError` |

El clasificador SHALL NOT leer `body.message` ni `body.code` — clasificación por status puro, igual que el resto del adapter.

#### Scenario: POST sin body a la URL correcta

- **GIVEN** `slug = "vonex"`, `recordId = "rec-1"`, `apiBaseUrl = "http://api.example.com"`
- **WHEN** se invoca `refreshEnabled("rec-1")`
- **THEN** la request es `POST http://api.example.com/t/vonex/virtual-exams/rec-1/refresh-enabled`
- **AND** el body de la request está vacío o es `null`

#### Scenario: Respuesta exitosa — retorna `{ addedCount, totalEnabledCount }`

- **GIVEN** el backend responde HTTP 200 con `{ "addedCount": 3, "totalEnabledCount": 12 }`
- **WHEN** `refreshEnabled("rec-1")` resuelve
- **THEN** retorna `{ addedCount: 3, totalEnabledCount: 12 }`

#### Scenario: 409 → `ExamConflictError` (status no scheduled)

- **WHEN** el backend responde HTTP 409
- **THEN** `refreshEnabled()` rechaza con `ExamConflictError`

#### Scenario: 404 → `VirtualExamNotFoundError`

- **WHEN** el backend responde HTTP 404
- **THEN** `refreshEnabled()` rechaza con `VirtualExamNotFoundError`

#### Scenario: 403 → `TutorExamForbiddenError`

- **WHEN** el backend responde HTTP 403
- **THEN** `refreshEnabled()` rechaza con `TutorExamForbiddenError`

#### Scenario: 422 → `ExamPreconditionError`

- **WHEN** el backend responde HTTP 422 (ej: recordId inválido como UUID)
- **THEN** `refreshEnabled()` rechaza con `ExamPreconditionError`

#### Scenario: 0 / 429 / 5xx → `NetworkError`

- **WHEN** el backend responde HTTP 0, 429, 500, 502, 503 o 504
- **THEN** `refreshEnabled()` rechaza con `NetworkError`

#### Scenario: Timeout → `NetworkError`

- **WHEN** la request supera 10 s
- **THEN** `refreshEnabled()` rechaza con `NetworkError`

#### Scenario: Slug leído del SlugStore de forma síncrona

- **WHEN** se inspecciona la implementación de `refreshEnabled`
- **THEN** el slug se obtiene del `SlugStore` sin `await` — llamada síncrona
- **AND** no hay slug hardcoded en la URL

#### Scenario: `withCredentials` NO seteado manualmente en el adapter

- **WHEN** se inspecciona el método `refreshEnabled` en `HttpTutorExamsApi`
- **THEN** no aparece `withCredentials: true` seteado directamente en la request
- **AND** el interceptor `credentials.interceptor` es el único responsable de agregarlo

---

### Requirement: REQ-API-4 — Use case `RefreshHabilitadosUseCase` (L2)

SHALL existir un nuevo use case `RefreshHabilitadosUseCase` en `src/L2_application/use-cases/refresh-habilitados.use-case.ts`. El use case SHALL:

- Ser una clase pura sin decorador Angular (`@Injectable`, etc.) — DI por constructor.
- Inyectar `TutorExamsApi` port por token (`TUTOR_EXAMS_API`).
- Exponer el método `execute(recordId: string): Promise<{ addedCount: number; totalEnabledCount: number }>`.
- Delegar completamente al port — sin lógica de negocio adicional más allá de la delegación.
- Propagar todos los errores del port sin transformación ni envoltura (`ExamConflictError`, `NetworkError`, etc. llegan tal cual al llamador).
- NOT enqueue nada en outbox, NOT escribir en IndexedDB, NOT setear acks — online-only igual que `IniciarExamenUseCase`.

Un archivo de unit tests `refresh-habilitados.use-case.spec.ts` SHALL existir en la misma carpeta con al menos 3 scenarios: happy path, 409, y NetworkError.

| Use case | Método | Retorna |
|---|---|---|
| `RefreshHabilitadosUseCase` | `execute(recordId: string): Promise<{ addedCount: number; totalEnabledCount: number }>` | conteo de alumnos agregados y total habilitados |

#### Scenario: `execute` delega al port y retorna el resultado sin transformación

- **GIVEN** `TutorExamsApi.refreshEnabled("rec-1")` resuelve con `{ addedCount: 5, totalEnabledCount: 20 }`
- **WHEN** `RefreshHabilitadosUseCase.execute("rec-1")` es invocado
- **THEN** retorna `{ addedCount: 5, totalEnabledCount: 20 }` sin transformación

#### Scenario: `execute` propaga `ExamConflictError` sin envoltura (status no scheduled)

- **GIVEN** `TutorExamsApi.refreshEnabled("rec-1")` rechaza con `ExamConflictError`
- **WHEN** `RefreshHabilitadosUseCase.execute("rec-1")` es invocado
- **THEN** rechaza con `ExamConflictError` directamente (sin wrapping)

#### Scenario: `execute` propaga `NetworkError` sin envoltura

- **GIVEN** `TutorExamsApi.refreshEnabled("rec-1")` rechaza con `NetworkError`
- **WHEN** `RefreshHabilitadosUseCase.execute("rec-1")` es invocado
- **THEN** rechaza con `NetworkError` directamente

#### Scenario: Use case NO toca outbox ni IndexedDB

- **GIVEN** `RefreshHabilitadosUseCase.execute()` completa (éxito o fallo)
- **WHEN** se inspecciona la implementación
- **THEN** no existen llamadas a `MarkingsStorage`, `enqueueEnvio`, `setSubmissionAck`, ni a ninguna API de IndexedDB

#### Scenario: Use case es L2 puro — sin `@angular/*`

- **WHEN** se inspecciona `refresh-habilitados.use-case.ts`
- **THEN** no importa ningún símbolo de `@angular/*`
- **AND** no importa `rxjs`
- **AND** no importa browser APIs

---

### Requirement: Token de inyección y wiring para el 7mo use case

El token `TUTOR_EXAMS_API` existente en L3 SHALL seguir siendo el mismo. En `app.config.ts` SHALL registrarse un factory provider adicional para `RefreshHabilitadosUseCase` con `deps: [TUTOR_EXAMS_API]`. `FakeTutorExamsApi` SHALL actualizarse para implementar el nuevo método `refreshEnabled` (stub con retorno fijo), de modo que TypeScript no emita error de tipo.

#### Scenario: `FakeTutorExamsApi` implementa `refreshEnabled`

- **WHEN** se inspecciona `FakeTutorExamsApi`
- **THEN** implementa los 7 métodos de `TutorExamsApi` incluyendo `refreshEnabled`
- **AND** TypeScript no emite error de tipo

#### Scenario: `app.config.ts` registra factory provider para `RefreshHabilitadosUseCase`

- **WHEN** se inspecciona `app.config.ts`
- **THEN** existe un factory provider para `RefreshHabilitadosUseCase` con `deps: [TUTOR_EXAMS_API]`

---

### Requirement: 6 use-cases L2 — puros, online-only, sin outbox

Los 6 use-cases de L2 (`src/L2_application/`) SHALL:
- Ser clases puras sin decorador Angular (`@Injectable`, etc.) — DI por constructor.
- Inyectar `TutorExamsApi` por token (`TUTOR_EXAMS_API`).
- Exponer un método `execute(...)` que delega al port y retorna el resultado tal cual.
- NOT enqueue nada en outbox, NOT escribir en IndexedDB, NOT setear acks.
- Propagar todos los errores del port sin transformación (sin envoltorio).

| Use case | Método | Retorna |
|---|---|---|
| `GetTutorExamsUseCase` | `execute(): Promise<readonly TutorExam[]>` | lista |
| `GetTutorExamDetailUseCase` | `execute({ recordId: string }): Promise<TutorExamDetail>` | detalle |
| `ListClassroomStudentsUseCase` | `execute({ classroomId: string; virtualExamDetailId: string }): Promise<readonly ClassroomStudent[]>` | alumnos |
| `IniciarExamenUseCase` | `execute({ recordId: string; duration?: number }): Promise<void>` | void — propaga `duration` (segundos) al puerto |
| `FinalizarExamenUseCase` | `execute({ recordId: string }): Promise<FinalizeResult>` | resultado |
| `ActualizarAlumnosHabilitadosUseCase` | `execute({ recordId: string; enabledStudentIds: readonly string[] }): Promise<void>` | void |

#### Scenario: GetTutorExamsUseCase delega al port y retorna lista

- **GIVEN** `TutorExamsApi.getTutorExams()` resuelve con `[exam1, exam2]`
- **WHEN** `GetTutorExamsUseCase.execute()` es invocado
- **THEN** retorna `[exam1, exam2]` sin transformación

#### Scenario: FinalizarExamenUseCase propaga FinalizeResult

- **GIVEN** `TutorExamsApi.finalizar("rec-1")` resuelve con `{ transitioned: true, jobId: "j1" }`
- **WHEN** `FinalizarExamenUseCase.execute({ recordId: "rec-1" })` es invocado
- **THEN** retorna `{ transitioned: true, jobId: "j1" }` sin transformación

#### Scenario: Use-cases propagan errores del port sin envoltorio

- **GIVEN** `TutorExamsApi.iniciar("rec-1")` rechaza con `ExamPreconditionError`
- **WHEN** `IniciarExamenUseCase.execute({ recordId: "rec-1" })` es invocado
- **THEN** rechaza con `ExamPreconditionError` directamente (sin wrapping)

#### Scenario: IniciarExamenUseCase pasa duration al port

- **GIVEN** un stub de `TutorExamsApi` que espía `iniciar`
- **WHEN** `IniciarExamenUseCase.execute({ recordId: "rec-1", duration: 1800 })` es invocado
- **THEN** `TutorExamsApi.iniciar` es llamado con `("rec-1", 1800)`

#### Scenario: IniciarExamenUseCase sin duration pasa undefined

- **WHEN** `IniciarExamenUseCase.execute({ recordId: "rec-1" })` es invocado sin `duration`
- **THEN** `TutorExamsApi.iniciar` es llamado con `("rec-1", undefined)`

#### Scenario: Use-cases NO tocan outbox ni IndexedDB

- **GIVEN** cualquier use-case tutor ejecuta exitosamente
- **WHEN** se inspecciona la implementación
- **THEN** no existen llamadas a `MarkingsStorage`, `enqueueEnvio`, `setSubmissionAck`, `clearMarcaciones`, ni a ninguna API de IndexedDB

---

### Requirement: Token de inyección TUTOR_EXAMS_API y wiring en app.config.ts

SHALL existir un token `TUTOR_EXAMS_API: InjectionToken<TutorExamsApi>` en L3. En `app.config.ts` SHALL registrarse:
- `{ provide: TUTOR_EXAMS_API, useExisting: HttpTutorExamsApi }` (el adapter real).
- Un factory provider por cada use-case, con `deps: [TUTOR_EXAMS_API]`.
- `FakeTutorExamsApi` (en `src/L3_periphery/fakes/`) que implementa `TutorExamsApi` con métodos stub retornando datos fijos — usable en tests sin HTTP.

#### Scenario: Token y provider existen en app.config.ts

- **WHEN** se inspecciona `app.config.ts`
- **THEN** existe `{ provide: TUTOR_EXAMS_API, useExisting: HttpTutorExamsApi }`
- **AND** existen 7 factory providers para los use-cases (incluyendo `RefreshHabilitadosUseCase`)

#### Scenario: FakeTutorExamsApi implementa el port completo

- **WHEN** se inspecciona `FakeTutorExamsApi`
- **THEN** implementa los 7 métodos de `TutorExamsApi` (incluyendo `refreshEnabled`)
- **AND** TypeScript no emite error de tipo
