# Delta for design-tokens

## MODIFIED Requirements

### Requirement: Ningún `.scss` de `src/LR_render/**` contiene hex literales de color

Todos los `.scss` de `src/LR_render/**` SHALL consumir colores exclusivamente vía `var(--color-*)`. La presencia de un hex literal de color (formato `#rgb`, `#rrggbb`, `#rrggbbaa`) en cualquier `.scss` de esa carpeta SHALL considerarse violación del contrato.

Este requisito cierra el gap concreto existente en los dos SCSS del tutor: `tutor-exams-list.page.scss` (7 hex hardcoded) y `tutor-exam-detail.page.scss` (8 hex hardcoded). Ambos archivos deben pasar a cero hex literales mediante sustitución por tokens `var(--color-*)` ya declarados en `src/styles.scss`.

(Previously: la regla ya existía a nivel proyecto pero los SCSS del tutor incumplían con 15 hex hardcoded en total sin enforcement específico sobre esas rutas.)

#### Scenario: Auditoría grep no encuentra hex literales

- **WHEN** se ejecuta `grep -rE '#[0-9a-fA-F]{3,8}' src/LR_render --include='*.scss'`
- **THEN** el comando devuelve cero matches

#### Scenario: Cero hex en tutor-exams-list SCSS

- **WHEN** se ejecuta `grep -rE '#[0-9a-fA-F]{3,8}' src/LR_render/pages/tutor-exams-list/`
- **THEN** el comando devuelve cero matches

#### Scenario: Cero hex en tutor-exam-detail SCSS

- **WHEN** se ejecuta `grep -rE '#[0-9a-fA-F]{3,8}' src/LR_render/pages/tutor-exam-detail/`
- **THEN** el comando devuelve cero matches

#### Scenario: Cualquier componente LR consume tokens

- **WHEN** se inspecciona cualquier `.scss` en `src/LR_render/pages/**` o `src/LR_render/components/**`
- **THEN** todas las propiedades `background`, `color`, `border-color`, `box-shadow` que aplican color usan `var(--color-*)`
- **AND** no usan literal `#…`, `rgb(…)` ni `hsl(…)` con valores hardcoded

---

## ADDED Requirements

### Requirement: Tokens de espaciado, radius y font en los SCSS del tutor

Los archivos `tutor-exams-list.page.scss` y `tutor-exam-detail.page.scss` SHALL consumir espaciado, radio de borde y familia tipográfica exclusivamente vía tokens `var(--space-*)`, `var(--radius-*)` y `var(--font-*)` cuando aplique la escala. Excepción documentada: valores de layout absoluto (p. ej. posicionamiento de strip) pueden usar valores arbitrarios con comentario inline explicativo.

#### Scenario: Spacing en SCSS del tutor vía var(--space-*)

- **WHEN** se inspeccionan los SCSS de tutor-exams-list y tutor-exam-detail
- **THEN** las propiedades `padding`, `margin`, `gap` que calzan con la escala (4/8/12/16/24/32) usan `var(--space-*)`

#### Scenario: Border-radius en SCSS del tutor vía var(--radius-*)

- **WHEN** se inspeccionan los SCSS de tutor-exams-list y tutor-exam-detail
- **THEN** las propiedades `border-radius` usan `var(--radius-*)`
- **AND** no aparecen valores `0.5rem`, `8px` ni `9999px` como literales fuera de `:root`

### Requirement: Restricciones de capa — solo LR_render es modificado

El scope del restyle MUST estar confinado exclusivamente a archivos bajo `src/LR_render/pages/tutor-exams-list/` y `src/LR_render/pages/tutor-exam-detail/`. Ningún archivo fuera de ese scope SHALL ser modificado por este change.

Las siguientes restricciones son absolutas:
- Ningún cambio en `src/LR_render/view-models/tutor-*.view-model.ts`.
- Ningún cambio en `src/LR_render/state/tutor-exams.store.ts`.
- Ningún cambio en `src/L1_domain/`, `src/L2_application/`, `src/L3_periphery/`.
- Ningún cambio en `tests/feature/LR_render/pages/tutor-*/*.spec.ts`.
- Ningún `data-testid` existente puede renombrarse ni moverse a otro elemento.

#### Scenario: grep de archivos modificados es solo LR_render/pages/tutor-*

- **WHEN** se inspecciona el diff del change
- **THEN** todos los archivos modificados están bajo `src/LR_render/pages/tutor-exams-list/` o `src/LR_render/pages/tutor-exam-detail/`
- **AND** ningún archivo bajo `src/L1_domain/`, `src/L2_application/`, `src/L3_periphery/`, o `tests/` aparece en el diff

#### Scenario: hexagonal-guard reporta 0 violaciones

- **WHEN** el subagente `hexagonal-guard` audita `src/` tras el restyle
- **THEN** reporta cero violaciones de boundaries (el change es 100% LR_render)
