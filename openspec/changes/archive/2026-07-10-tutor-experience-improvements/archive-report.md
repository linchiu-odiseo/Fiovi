# Archive Report — Tutor Experience Improvements

**Fecha de archive:** 2026-07-10
**Change:** `2026-07-10-tutor-experience-improvements`
**Rama origen:** `feat/tutor-experience-improvements`

## Contexto de retro-archive

Este change fue implementado **antes** de escribir su documentación SDD. El usuario solicitó subsanar el workflow escribiendo proposal, design, tasks, delta specs, verify y archive reports retrospectivamente sobre el código ya aplicado en la rama.

Todo el trabajo estaba en tree sin commitear al momento de escribir estos docs. Verificación:
- `tsc --noEmit` exit 0
- `npm run lint` exit 0
- `npm test` 1002/1002 tests (69 files) verdes

## Capabilities afectadas

### Modified
- **`tutor-exams-api`** — schema de `TutorExam` y `TutorExamDetail` migrado a `course`/`area`/`scheduled`; puerto `iniciar(recordId, duration?)`.
- **`tutor-exam-list`** — home tutor filtrado a `in_progress`, aulas clickeables, integración con `pwa-shell-update`.
- **`tutor-exam-management`** — modal iniciar con edición de duración (mm+ss), modal finalizar con confirmación, metadata rica en header, contador de habilitados.

### Added
- **`tutor-aula-navigation`** (nueva) — jerarquía Aula → Curso → Examen con dos rutas y VMs con warm-path del store.

## Merge de delta specs

Los delta specs de `openspec/changes/2026-07-10-tutor-experience-improvements/specs/` se mergean en `openspec/specs/` como sigue:
- `tutor-exams-api/spec.md` — reemplazo de los 4 requirements MODIFIED (read-models, GET lista, GET detail, iniciar, use case iniciar).
- `tutor-exam-list/spec.md` — reemplazo de "Tarjetas con 3 estados" y "Ruta /tutor/home".
- `tutor-exam-management/spec.md` — append de 4 ADDED requirements (metadata rica, modal iniciar, modal finalizar, contador).
- `tutor-aula-navigation/spec.md` — nuevo capability file.

## Gate abierto para deploy

Coordinar con **learnex (backend)** que `TutorVirtualExamListItemDto` incluya `course` (string|null), `area` (string|null), `scheduled` (ISO string), y NO `entryId`, `courseId`, `createdAt`. El `VirtualExamDetailDto` debe incluir `course` y `area`. El endpoint `POST /virtual-exams/:recordId/start` debe aceptar body opcional `{ duration: number }` en segundos (60..7200) y persistirlo atómicamente con la transición `scheduled → in_progress`.

## Notas de proceso

Este archive establece un **precedente** para la política del proyecto: los changes deben pasar por SDD **antes** de la implementación, no después. La subsanación retrospectiva se permite excepcionalmente pero implica riesgo — los tests y el código ya estaban hechos, por lo que las specs se ajustan al comportamiento observado en lugar de guiarlo.
