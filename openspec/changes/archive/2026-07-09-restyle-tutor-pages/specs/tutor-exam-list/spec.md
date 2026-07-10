# Delta for tutor-exam-list

## MODIFIED Requirements

### Requirement: Tarjetas con 3 estados via Signals

`TutorExamsListPage` SHALL renderizar una tarjeta por cada `TutorExam` en `exams()`. Cada tarjeta SHALL reflejar el estado del examen según `serverStatus.value`:
- `'scheduled'` → visual "Programado" (badge + strip con `var(--color-outline)` + card opacity 0.7).
- `'in_progress'` → visual "En curso" (badge + strip con `var(--color-success)`).
- `'finalized'` → visual "Finalizado" (badge + strip distinto según token).
- `count === null` → renderizar `"—"` en lugar del número.
- `courseId` SHALL NOT ser expuesto en el DOM — el elemento `<span class="exam-card__course">` está prohibido.

(Previously: courseId podía renderizarse en `<span class="exam-card__course">{{ exam.courseId }}</span>`; no había strip lateral de color.)

#### Scenario: courseId UUID no aparece en el DOM

- **GIVEN** el backend devuelve un exam con `courseId = "0b1e8c0c-041a-4893-b7b9-593592fa6a70"`
- **WHEN** la exam-card se renderiza
- **THEN** el `textContent` de la tarjeta NO contiene el string `"0b1e8c0c"`
- **AND** no existe ningún elemento hijo con clase `exam-card__course`

#### Scenario: Strip scheduled — color outline y card semitransparente

- **GIVEN** un `TutorExam` con `serverStatus.value === 'scheduled'`
- **WHEN** la exam-card se renderiza
- **THEN** el elemento `.card__strip` tiene `background` con `var(--color-outline)`
- **AND** la tarjeta aplica `opacity: 0.7` al contenedor de la card

#### Scenario: Strip in_progress — color success

- **GIVEN** un `TutorExam` con `serverStatus.value === 'in_progress'`
- **WHEN** la exam-card se renderiza
- **THEN** el elemento `.card__strip` tiene `background` con `var(--color-success)`

---

### Requirement: Ruta /tutor/home — header completo con perfil, aulas y logout

La configuración de rutas SHALL mantener `/tutor/home` cargando `TutorExamsListPage` (lazy `loadComponent`). La página SHALL renderizar el perfil COMPLETO del tutor con jerarquía visual alineada al home del alumno:
- Kicker uppercase 0.75rem/700/letter-spacing 0.05em usando `var(--color-on-surface-variant)`.
- Saludo principal renderizado con `var(--font-display)` 1.625rem/700/letter-spacing -0.01em.
- Fila `.user-info` con ícono+texto para email y código — implementado como `<ul class="user-info">` con Material Symbols (`mail`, `badge`).
- La estructura anterior basada en `<dl>` SHALL ser reemplazada por `.user-info`.

La sección de aulas, la lista de exámenes y el botón de logout siguen presentes con los mismos `data-testid`.

(Previously: la jerarquía visual usaba `<dl>` para el profile-card sin kicker ni jerarquía tipográfica del sistema Native Excellence.)

#### Scenario: profile-card renderiza user-info con íconos mail y badge

- **GIVEN** `GetProfileUseCase('tutor')` resuelve con un `TutorProfile` completo
- **WHEN** `TutorExamsListPage` renderiza el profile-card normal (data-testid="profile-card")
- **THEN** existe un elemento `<ul class="user-info">` dentro del profile-card
- **AND** contiene un `<span class="material-symbols-outlined">` con texto `mail`
- **AND** contiene un `<span class="material-symbols-outlined">` con texto `badge`
- **AND** NO existe ningún elemento `<dl>` dentro del profile-card

#### Scenario: data-testid existentes conservan elemento raíz y semántica

- **WHEN** se inspecciona el template después del restyle
- **THEN** los data-testid `profile-card`, `profile-card-degraded`, `profile-skeleton`, `classrooms-summary`, `classroom-item`, `classrooms-empty`, `classrooms-section`, `exams-list`, `exam-card`, `status-badge`, `btn-logout` existen en los mismos elementos raíz con la misma semántica assertable que antes del restyle

## ADDED Requirements

### Requirement: Tests de tutor-exam-list son inmutables

Los archivos `tests/feature/LR_render/pages/tutor-exams-list/**/*.spec.ts` MUST NOT ser modificados por este change. Todos los asserts existentes en esos archivos MUST seguir pasando sin alteración de su código fuente.

#### Scenario: npm test pasa sin modificar specs del listado

- **GIVEN** el restyle es aplicado al HTML y SCSS del listado
- **WHEN** se ejecuta `npm test` con los archivos de spec intactos
- **THEN** todos los tests de `tutor-exams-list` pasan en verde
- **AND** no se modificó ninguna línea en `tests/feature/LR_render/pages/tutor-exams-list/`
