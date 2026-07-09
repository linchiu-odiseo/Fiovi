# Delta for tutor-exam-management

## MODIFIED Requirements

### Requirement: Back button en la pantalla de detalle (iOS standalone PWA)

`TutorExamDetailPage` SHALL mostrar un botón visible "Volver" (data-testid="btn-volver") en la parte superior de la pantalla, SIEMPRE presente (no condicional a la carga ni al estado de error).

El botón SHALL renderizar `<span class="material-symbols-outlined">chevron_left</span>` seguido del texto literal `Volver`, tinted con `var(--color-primary)`, sin borde ni background sólido (transparent), con tap-target mínimo de 44px de altura.

Al presionar el botón, la página SHALL navegar a `/tutor/home` usando `Router.navigate(['/tutor/home'])`. NOT SHALL usar `history.back()`. El método `onVolver()` de `TutorExamDetailPage` SHALL seguir existiendo con la misma signatura que antes del restyle.

(Previously: el botón Volver no tenía icono chevron_left ni estilo tinted; usaba estilo con borde o background sólido.)

#### Scenario: btn-volver contiene el texto Volver

- **GIVEN** el botón (data-testid="btn-volver") es visible
- **WHEN** se lee su `textContent.trim()`
- **THEN** contiene el string `"Volver"`

#### Scenario: btn-volver no tiene border ni background sólido

- **GIVEN** el botón (data-testid="btn-volver") renderiza
- **WHEN** se inspeccionan sus estilos computados
- **THEN** `border` es `none` o equivalente transparent
- **AND** `background` es `transparent` o equivalente sin color sólido

---

## ADDED Requirements

### Requirement: Chip de estado localizado en español

`TutorExamDetailPage` SHALL renderizar el estado del examen dentro de un elemento con data-testid="status-chip". El chip SHALL mostrar ÚNICAMENTE el label en español correspondiente a `detail.status.value`:
- `'scheduled'` → `"Programado"` con clase modificadora BEM `--scheduled`.
- `'in_progress'` → `"En curso"` con clase modificadora BEM `--in-progress`.
- `'finalized'` → `"Finalizado"` con clase modificadora BEM `--finalized`.

El elemento con data-testid="status-chip" SHALL NOT contener elementos `<span class="material-symbols-outlined">` como hijos directos o descendientes — los íconos quedan fuera del contenedor assertable.

El helper `statusChip(status): { label: string; modifier: string }` SHALL vivir en `tutor-exam-detail.page.ts` (no en el view-model).

#### Scenario: Chip scheduled renderiza label Programado

- **GIVEN** `detail.status.value === 'scheduled'`
- **WHEN** `TutorExamDetailPage` renderiza
- **THEN** el elemento (data-testid="status-chip") tiene `textContent.trim() === "Programado"`
- **AND** el elemento tiene la clase modificadora `--scheduled`

#### Scenario: Chip in_progress renderiza label En curso

- **GIVEN** `detail.status.value === 'in_progress'`
- **WHEN** `TutorExamDetailPage` renderiza
- **THEN** el elemento (data-testid="status-chip") tiene `textContent.trim() === "En curso"`
- **AND** el elemento tiene la clase modificadora `--in-progress`

#### Scenario: Chip finalized renderiza label Finalizado

- **GIVEN** `detail.status.value === 'finalized'`
- **WHEN** `TutorExamDetailPage` renderiza
- **THEN** el elemento (data-testid="status-chip") tiene `textContent.trim() === "Finalizado"`
- **AND** el elemento tiene la clase modificadora `--finalized`

#### Scenario: Chip no contiene Material Symbols como hijos

- **GIVEN** cualquier valor de `detail.status.value`
- **WHEN** `TutorExamDetailPage` renderiza
- **THEN** el elemento (data-testid="status-chip") NO tiene descendientes con clase `material-symbols-outlined`

---

### Requirement: Tests de tutor-exam-management son inmutables

Los archivos `tests/feature/LR_render/pages/tutor-exam-detail/**/*.spec.ts` MUST NOT ser modificados por este change. Todos los asserts existentes en esos archivos MUST seguir pasando sin alteración de su código fuente.

#### Scenario: npm test pasa sin modificar specs del detail

- **GIVEN** el restyle es aplicado al HTML, SCSS y TS del detail
- **WHEN** se ejecuta `npm test` con los archivos de spec intactos
- **THEN** todos los tests de `tutor-exam-detail` pasan en verde
- **AND** no se modificó ninguna línea en `tests/feature/LR_render/pages/tutor-exam-detail/`
