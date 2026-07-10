# Delta for tutor-exams-api

## MODIFIED Requirements

### Requirement: Read-models TutorExam, TutorExamDetail, ClassroomStudent y FinalizeResult en L1

**`TutorExam`** (`src/L1_domain/entities/tutor-exam.ts`) SHALL ser una clase con:
- Campos: `detailId: string`, `recordId: string`, `classroomId: string`, `serverStatus: ExamServerStatus`, `name: string`, `course: string | null`, `area: string | null`, `count: number | null`, `duration: number` (segundos), `scheduled: Date`, `startedAt: Date | null`, `finishedAt: Date | null`.
- Getter derivado: `durationInMinutes: number` — retorna `Math.round(duration / 60)`.
- Helpers: `puedeIniciar(): boolean`, `puedeFinalizar(): boolean`, `estaFinalizado(): boolean` (sin cambios respecto al comportamiento previo).
- Reusar `ExamServerStatus` sin modificarlo.

**`TutorExamDetail`** (`src/L1_domain/value-objects/tutor-exam-detail.ts`) SHALL ser un tipo/clase con:
- Campos: `id: string`, `recordId: string`, `status: ExamServerStatus`, `name: string`, `course: string | null`, `area: string | null`, `count: number | null`, `duration: number`, `enabledStudentIds: readonly string[]`, `startedAt: Date | null`, `finishedAt: Date | null`, `createdAt: Date`.
- NOT incluye `classroomId` (solo la lista lo lleva).

**`ClassroomStudent`** y **`FinalizeResult`** — sin cambios respecto al contrato previo.

(Previously: `TutorExam` incluía `entryId: string`, `courseId: string | null`, `createdAt: Date`; NO tenía `area`, `scheduled` ni `durationInMinutes`. `TutorExamDetail` incluía `courseId` y NO `course`/`area`.)

#### Scenario: TutorExam.durationInMinutes redondea desde segundos

- **GIVEN** un `TutorExam` con `duration: 3600`
- **WHEN** se lee `tutorExam.durationInMinutes`
- **THEN** retorna `60`

- **GIVEN** un `TutorExam` con `duration: 90`
- **WHEN** se lee `tutorExam.durationInMinutes`
- **THEN** retorna `2` (`Math.round(90 / 60) === 2`)

#### Scenario: TutorExam.course y area aceptan null

- **GIVEN** un `TutorExam` construido con `course: null` y `area: null`
- **WHEN** se inspecciona el tipo
- **THEN** TypeScript compila sin error — ambos son `string | null` por contrato

#### Scenario: TutorExam NO expone entryId ni createdAt

- **WHEN** se inspecciona la clase `TutorExam`
- **THEN** no existe la propiedad `entryId`
- **AND** no existe la propiedad `createdAt`
- **AND** sí existe `scheduled: Date`

#### Scenario: TutorExamDetail NO incluye classroomId ni courseId

- **WHEN** se inspecciona la interfaz `TutorExamDetail`
- **THEN** no existe `classroomId`
- **AND** no existe `courseId`
- **AND** sí existen `course: string | null` y `area: string | null`

---

### Requirement: Contrato HTTP — GET /tutor/virtual-exams (lista)

`HttpTutorExamsApi.getTutorExams()` SHALL emitir `GET` a `apiPath.tutorVirtualExams()`. La respuesta HTTP 200 tiene body `{ items: TutorVirtualExamListItemDto[] }`. El método SHALL mapear cada item al read-model `TutorExam` con las siguientes correspondencias:
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

El DTO NO trae `entryId`, `courseId` ni `createdAt` (obsoletos post-migración).

(Previously: el mapper leía `dto.entryId`, `dto.courseId`, `dto.createdAt`.)

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
  - `course === "Aritmética"`, `area === "Matemáticas"`
  - `scheduled` es instancia de `Date`
  - NO existe `entryId`, `courseId`, ni `createdAt`

#### Scenario: course y area null se preservan

- **GIVEN** el backend devuelve `course: null` y `area: null` en un item
- **WHEN** se mapea al `TutorExam`
- **THEN** `tutorExam.course === null` y `tutorExam.area === null`

---

### Requirement: Contrato HTTP — GET /virtual-exams/:recordId (detalle)

`HttpTutorExamsApi.getExamDetail(recordId)` SHALL emitir `GET` a `apiPath.virtualExam(recordId)`. La respuesta HTTP 200 es un `VirtualExamDetailDto` con `course`, `area`, `enabledStudentIds`. Mapper: mismos escalares que la lista + `enabledStudentIds`. El DTO NO trae `courseId` ni `classroomId`.

(Previously: el DTO traía `courseId`; el mapper lo mapeaba a `TutorExamDetail.courseId`.)

#### Scenario: Detail mapping con course y area

- **GIVEN** el backend responde HTTP 200 con
  `{ "id":"det-1", "recordId":"rec-1", "status":"scheduled", "name":"Ex",
    "course":"Álgebra", "area":"Matemáticas", "count":null, "duration":1800,
    "enabledStudentIds":["s-1"], "startedAt":null, "finishedAt":null }`
- **WHEN** `getExamDetail("rec-1")` resuelve
- **THEN** `tutorExamDetail.course === "Álgebra"` y `tutorExamDetail.area === "Matemáticas"`

---

### Requirement: Contrato HTTP — POST /virtual-exams/:recordId/start

`HttpTutorExamsApi.iniciar(recordId, duration?)` SHALL emitir `POST` a `apiPath.virtualExamStart(recordId)`. Cuando `duration` viene definido, el body es `{ duration: <número en segundos> }`; cuando es `undefined`, el body es `null` (el back mantiene la duración con la que se creó el examen). La respuesta esperada es HTTP 204 sin body. El método SHALL resolver con `void`.

Rango válido del back: `60 ≤ duration ≤ 7200` segundos. El cliente valida antes de invocar (defensa en profundidad); el back rechaza con 400 (`InvalidPayloadError`) si viene fuera de rango.

(Previously: `iniciar(recordId)` sin parámetro extra, body siempre `null`.)

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

#### Scenario: 400 en iniciar → InvalidPayloadError (duration fuera de rango)

- **WHEN** el backend responde HTTP 400 (duración < 60 o > 7200)
- **THEN** `iniciar()` rechaza con `InvalidPayloadError`

#### Scenario: 409 en iniciar → ExamConflictError (ya iniciado)

- **WHEN** el backend responde HTTP 409
- **THEN** `iniciar()` rechaza con `ExamConflictError`

#### Scenario: 422 en iniciar → ExamPreconditionError (0 alumnos habilitados)

- **WHEN** el backend responde HTTP 422
- **THEN** `iniciar()` rechaza con `ExamPreconditionError`

---

### Requirement: 6 use-cases L2 — puros, online-only, sin outbox

`IniciarExamenUseCase.execute` SHALL aceptar el shape `{ recordId: string; duration?: number }` y propagar `duration` al puerto sin transformación. El resto de use-cases (`GetTutorExamsUseCase`, `GetTutorExamDetailUseCase`, `ListClassroomStudentsUseCase`, `FinalizarExamenUseCase`, `ActualizarAlumnosHabilitadosUseCase`) SHALL mantener sus firmas y semántica previas.

(Previously: `IniciarExamenUseCase.execute({ recordId })` sin `duration`.)

#### Scenario: IniciarExamenUseCase pasa duration al port

- **GIVEN** un stub de `TutorExamsApi` que espía `iniciar`
- **WHEN** `IniciarExamenUseCase.execute({ recordId: "rec-1", duration: 1800 })` es invocado
- **THEN** `TutorExamsApi.iniciar` es llamado con `("rec-1", 1800)`

#### Scenario: IniciarExamenUseCase sin duration pasa undefined

- **WHEN** `IniciarExamenUseCase.execute({ recordId: "rec-1" })` es invocado sin `duration`
- **THEN** `TutorExamsApi.iniciar` es llamado con `("rec-1", undefined)`
