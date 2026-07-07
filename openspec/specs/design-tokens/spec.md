## ADDED Requirements

### Requirement: Tokens visuales definidos como CSS Variables en `:root`

El proyecto SHALL exponer su sistema de tokens visuales (colores, espaciado, radios, tipografías) como CSS Custom Properties (CSS Variables W3C) declaradas en un único `:root { … }` dentro de `src/styles.scss`. Los tokens SHALL seguir las convenciones de naming `--color-<rol>`, `--space-<size>`, `--radius-<size>`, `--font-<rol>`.

#### Scenario: `src/styles.scss` declara los tokens en `:root`

- **WHEN** se inspecciona `src/styles.scss`
- **THEN** contiene un bloque `:root { … }` con declaraciones de variables CSS para color, spacing, radius y font
- **AND** los nombres siguen las convenciones `--color-*`, `--space-*`, `--radius-*`, `--font-*`

#### Scenario: El frontmatter de `.authentic/lugia_native_systems/DESIGN.md` es fuente de verdad

- **WHEN** se compara la paleta de colores declarada en `:root` con el frontmatter de `.authentic/lugia_native_systems/DESIGN.md`
- **THEN** los hex values del DESIGN.md están todos representados en `--color-*`
- **AND** ningún color introducido fuera del DESIGN.md aparece en `:root`

### Requirement: Ningún `.scss` de `src/LR_render/**` contiene hex literales de color

Todos los `.scss` de `src/LR_render/**` SHALL consumir colores exclusivamente vía `var(--color-*)`. La presencia de un hex literal de color (formato `#rgb`, `#rrggbb`, `#rrggbbaa`) en cualquier `.scss` de esa carpeta SHALL considerarse violación del contrato.

#### Scenario: Auditoría grep no encuentra hex literales

- **WHEN** se ejecuta `grep -rE '#[0-9a-fA-F]{3,8}' src/LR_render --include='*.scss'`
- **THEN** el comando devuelve cero matches

#### Scenario: Cualquier componente LR consume tokens

- **WHEN** se inspecciona cualquier `.scss` en `src/LR_render/pages/**` o `src/LR_render/components/**`
- **THEN** todas las propiedades `background`, `color`, `border-color`, `box-shadow` que aplican color usan `var(--color-*)`
- **AND** no usan literal `#…`, `rgb(…)` ni `hsl(…)` con valores hardcoded

### Requirement: Tokens de spacing, radius y font también centralizados

Spacing, border-radius y font-family SHALL consumirse desde tokens en `:root`. Excepción: layout absoluto puede usar valores arbitrarios de spacing en casos donde un token no aplica (por ejemplo `top: -10px` para posicionar un chip flotante), siempre que se documente con comentario inline el motivo.

#### Scenario: Spacing consumido vía `var(--space-*)`

- **WHEN** se inspecciona cualquier `.scss` de `src/LR_render/**`
- **THEN** las propiedades `padding`, `margin`, `gap` usan `var(--space-*)` cuando el valor calza con la escala (4/8/12/16/24/32)

#### Scenario: Border-radius consumido vía `var(--radius-*)`

- **WHEN** se inspecciona cualquier `.scss` de `src/LR_render/**`
- **THEN** las propiedades `border-radius` usan `var(--radius-*)`
- **AND** no aparecen valores `0.5rem`, `8px`, `9999px` literales fuera de `:root`

#### Scenario: Font-family consumido vía `var(--font-*)`

- **WHEN** se inspecciona cualquier `.scss` de `src/LR_render/**`
- **THEN** las declaraciones de `font-family` usan `var(--font-display)`, `var(--font-body)`, `var(--font-mono)` o `var(--font-pixel)`
- **AND** no aparecen `'Hanken Grotesk'`, `'JetBrains Mono'`, `'Inter'`, ni `system-ui` como literales fuera de `styles.scss`

### Requirement: Las fuentes Google se cargan desde `src/index.html`

`src/index.html` SHALL incluir un `<link rel="stylesheet">` que carga Hanken Grotesk, JetBrains Mono, Press Start 2P y Material Symbols Outlined desde Google Fonts con `display=swap` para no bloquear el first paint.

#### Scenario: Link tag de Google Fonts presente

- **WHEN** se inspecciona `src/index.html`
- **THEN** existe un `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?...">` que pide al menos las familias Hanken Grotesk, JetBrains Mono, Press Start 2P y Material Symbols Outlined
- **AND** el query string incluye `display=swap`

### Requirement: Cero dependencias npm nuevas introducidas por el sistema de tokens

La implementación del sistema de tokens SHALL ser CSS+SCSS puro. NO SHALL agregarse Tailwind, PostCSS plugins extra, ni librerías de design system como Material Components ni ng-zorro como parte de este change.

#### Scenario: `package.json` sin nuevas dependencias de tooling visual

- **WHEN** se compara `package.json` antes y después del change
- **THEN** la sección `dependencies` y `devDependencies` no incluye Tailwind, ng-zorro, @angular/material, ni paquetes de design tokens

#### Scenario: `angular.json` sin cambios en build pipeline

- **WHEN** se compara `angular.json` antes y después del change
- **THEN** la configuración de `styles`, `assets` y build options para el target `build` queda equivalente excepto por la entrada de `public/img/fiovi.png` como asset (que también puede entrar implícito por `public/`)
