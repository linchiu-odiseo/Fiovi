# Delta for tutor-exams-api

> Este delta extiende la capability existente `tutor-exams-api`.
> Al archivar este change, los requirements ADDED debajo se mergean en `openspec/specs/tutor-exams-api/spec.md`.
> Change: `reconcile-enabled-on-start-gate` — iniciado 2026-08-15.

## Context

La capability `tutor-exams-api` ya define 6 métodos en el puerto `TutorExamsApi` (ver `openspec/specs/tutor-exams-api/spec.md`). Este delta agrega el 7mo método `refreshEnabled(recordId)`, su helper de URL, su implementación HTTP y el use case L2 correspondiente. El puerto `ExamsApi` (alumno) sigue sin tocarse.

## ADDED Requirements

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
