# Verify Report — Tutor Experience Improvements

**Fecha:** 2026-07-10
**Change:** `2026-07-10-tutor-experience-improvements`
**Modo:** Retrospectivo (código ya aplicado antes de escribir specs/tasks).

## Checks ejecutados

| Check | Comando | Resultado |
|---|---|---|
| TypeScript | `npx tsc --noEmit -p tsconfig.json` | ✅ exit 0 |
| Lint | `npm run lint` | ✅ exit 0 |
| Vitest | `npm test` | ✅ **1002/1002** tests (69 archivos) |
| Hexagonal boundaries | Grep manual + `hexagonal-guard` heurístico | ✅ Sin violaciones nuevas |

## Detalle de compliance

### Boundaries (L1/L2/L3/LR)

- Nuevos VMs (`TutorAulaCoursesViewModel`, `TutorAulaCourseExamsViewModel`) importan **solo** L1 (`TutorExam`, `NetworkError`, `TutorProfile`, `TutorClassroom`, `ProfileNotAvailableError`) y L2 (`GetTutorExamsUseCase`, `GetProfileUseCase`).
- Nuevos pages solo importan sus VMs, entidades L1 y componentes LR.
- `TutorExamsListPage` importa `PwaUpdateService` desde `L3_periphery/pwa/` — **no es una violación nueva**: es el patrón preexistente ya usado en `src/LR_render/pages/home/home.page.ts` y `src/LR_render/components/update-banner/update-banner.component.ts`.
- L1 y L2 permanecen puros: sin `@angular/*`, sin `rxjs`, sin browser APIs.

### Contrato tutor-exams-api

- `TutorExam` migró a nuevo shape (`course`/`area`/`scheduled`, sin `entryId`/`courseId`/`createdAt`).
- `TutorExamDetail` migró análogamente.
- Puerto `TutorExamsApi.iniciar(recordId, duration?)` — firma extendida compatible con callers previos.
- `HttpTutorExamsApi` mapea el nuevo DTO; `FakeTutorExamsApi` matchea la firma.
- Test `http-tutor-exams-api.spec.ts` ejercita el nuevo DTO y el body opcional del `iniciar`.

### tutor-exam-list

- Home tutor renderiza solo `examsInProgress` — ✅.
- Aulas clickeables con `role="button"`, `tabindex="0"`, `(click)`, `(keydown.enter)` — ✅.
- PWA update banner + version footer integrados — ✅.
- Email fallback cubre `profile.email === null` además de `ProfileNotAvailableError` — ✅.

### tutor-exam-management

- Modal iniciar (mm+ss + validación 60..7200s + override solo si cambió el valor) — ✅.
- Modal finalizar con confirmación explícita — ✅.
- Metadata en header (área, curso, count, duración, timestamps es-PE) — ✅.
- Contador `N habilitados de M` en el header de la lista de alumnos — ✅.

### tutor-aula-navigation (nueva capability)

- 2 rutas protegidas por `authGuard + roleGuard('tutor')` y con `loadComponent` lazy.
- Warm path del store: no request si el store ya tiene data.
- Agrupación por `course ?? 'Sin curso'`; filtrado por `(classroomId, course)`.
- Navegación jerárquica: home → aula → curso → detail examen; back en cada nivel.

## Riesgos conocidos (heredados del proposal)

- **R1 (Alto)** — el back debe devolver `course`/`area`/`scheduled` en `TutorVirtualExamListItemDto` y `course`/`area` en `VirtualExamDetailDto`. Sin esto, la lista rompe en runtime. **Coordinar con learnex ANTES del deploy.**
- **R2 (Bajo-Medio)** — `/curso/:course` con nombres que contengan `/`, `?` o `#` rompe routing. Fix futuro con slug.
- **R3 (Bajo)** — colisión entre `course: null` (mapeado a `"Sin curso"`) y curso literal `"Sin curso"`. Fix futuro con sentinel.

## Verdicto

**PASA.** El change puede archivarse. El único gate open es coordinación de contrato con el backend (R1) — no bloquea el archive del cliente porque el shape ya está reflejado en tests y adapter.
