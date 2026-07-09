# Design: Restyle Tutor Pages (Native Excellence alignment)

## Context

Restyle 100% confinado a `src/LR_render/pages/tutor-exams-list/` y `src/LR_render/pages/tutor-exam-detail/`. Ver `proposal.md` para el intent y `specs/{tutor-exam-list,tutor-exam-management,design-tokens}/spec.md` para el contrato exacto. Este documento resuelve las decisiones técnicas concretas que quedan para poder generar tasks accionables — no reexplica el porqué del change, sólo el cómo.

## Technical Approach

Sustitución de 15 hex por tokens (`var(--color-*)`), un helper `statusChip()` en el `.page.ts` del detail, y ajuste de HTML/SCSS para replicar la mecánica visual ya probada del home del alumno (`card__strip`, `user-info`, kicker + saludo `--font-display`). Cero cambios en dominio, VMs, stores, contratos, ni tests. Todas las clases nuevas son BEM locales encapsuladas por Angular (Emulated).

## Architecture Decisions

### 1. Token map (15 hex → tokens del design system)

**`tutor-exams-list.page.scss` — 7 fallbacks incorrectos → tokens directos (sin fallback):**

| Línea | Actual | Target |
|-------|--------|--------|
| 111 | `var(--color-error, #dc2626)` | `var(--color-error)` (real `#ba1a1a`, fallback era Tailwind red-600) |
| 278 | `var(--color-card-bg, #fff)` | `var(--color-surface-container-lowest)` |
| 279 | `var(--color-border, #e5e7eb)` | `var(--color-outline-variant)` |
| 286 | `var(--color-primary, #1e3a5f)` | `var(--color-primary)` (real `#002453`) |
| 287 | `var(--color-primary, #1e3a5f)` | `var(--color-primary)` |
| 309 | `var(--color-status-bg, #f3f4f6)` | `var(--color-surface-container-high)` |
| 310 | `var(--color-status-text, #374151)` | `var(--color-on-surface-variant)` |
| 317 | `var(--color-text-secondary, #6b7280)` | `var(--color-on-surface-variant)` |

**`tutor-exam-detail.page.scss` — 8 hex crudos → tokens:**

| Línea | Actual | Target |
|-------|--------|--------|
| 25 | `background: #e5e7eb` | `var(--color-surface-container-high)` |
| 30 | `background: #fee2e2` | `var(--color-error-container)` |
| 31 | `border: #fca5a5` | `var(--color-error)` |
| 39 | `color: #6b7280` | `var(--color-on-surface-variant)` |
| 62 | `background: #2563eb` | `var(--color-primary)` |
| 63 | `color: #fff` (btn-iniciar) | `var(--color-on-primary)` |
| 67 | `background: #dc2626` | `var(--color-error)` |
| 68 | `color: #fff` (btn-finalizar) | `var(--color-on-error)` |
| 89 | `border: #e5e7eb` | `var(--color-outline-variant)` |
| 105 | `background: #f3f4f6` | `var(--color-surface-container-high)` |
| 106 | `color: #6b7280` | `var(--color-on-surface-variant)` |
| 111 | `color: #6b7280` | `var(--color-on-surface-variant)` |

**Decisión sub-abierta L310 (`color-status-text`)** → `var(--color-on-surface-variant)`.
**Why**: consistencia con el resto de labels secundarios del design system (kicker, meta, submitted-badge, no-students). El extra contraste de `--color-on-surface` no aporta en un chip que ya vive sobre `--color-surface-container-high`; sí rompería la jerarquía tipográfica del sistema.

### 2. Ubicación del helper `statusChip()` → `tutor-exam-detail.page.ts`

**Choice**: método `protected` en el page component, siguiendo el precedente exacto de `statusLabel(exam)` en `tutor-exams-list.page.ts:28-36`.

```ts
protected statusChip(status: ExamServerStatusValue): { label: string; modifier: string } {
  switch (status) {
    case 'scheduled':   return { label: 'Programado', modifier: 'scheduled' };
    case 'in_progress': return { label: 'En curso',    modifier: 'in-progress' };
    case 'finalized':   return { label: 'Finalizado',  modifier: 'finalized' };
  }
}
```

**Alternatives**: (a) archivo utilitario compartido `LR_render/utils/`, (b) mover al view-model como DTO de presentación.
**Rationale**: (a) sólo tendría un consumidor real, prematuro. (b) violaría la regla del CLAUDE.md — la traducción status → label es-PE + clase CSS es presentación, no dominio ni orquestación, no debe vivir en L2 ni en un VM que sí es LR pero tiene forma de contrato hacia L2. Además el spec `tutor-exam-management` fija explícitamente "el helper `statusChip(status)` SHALL vivir en `tutor-exam-detail.page.ts`".

### 3. Chip pill: template + BEM + testid

**Render en template** (dentro del hero del detail, no del contenedor `status`):

```html
@let sc = statusChip(detail.status.value);
<span
  class="tutor-exam-detail__status-chip tutor-exam-detail__status-chip--{{ sc.modifier }}"
  data-testid="status-chip"
>{{ sc.label }}</span>
```

**Decisión de testid**: `status-chip` es un testid NUEVO agregado por este change (spec `tutor-exam-management` lo marca como ADDED). El `status-badge` del listado se mantiene idéntico — es un contrato distinto y con feature-tests históricos; sólo cambia su estilo, no su nombre.
**Modificadores CSS**: `--scheduled`, `--in-progress`, `--finalized`.
**Rationale**: separar testids permite asserts independientes por página (`.textContent.trim()` puede validar `"Programado"` en el chip del detail sin colisionar con el badge del listado, que puede tener icon/decoración distinta a futuro).

### 4. Estilo del chip pill (SCSS local, encapsulado)

```scss
&__status-chip {
  display: inline-flex;
  padding: 0.25rem 0.6rem;
  border-radius: var(--radius-pill);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  background: var(--color-surface-container-high);
  color: var(--color-on-surface-variant);

  &--scheduled  { background: var(--color-surface-container-high);
                  color:      var(--color-on-surface-variant); }
  &--in-progress{ background: var(--color-success-container);
                  color:      var(--color-on-success-container); }
  &--finalized  { background: var(--color-surface-container-high);
                  color:      var(--color-on-surface-variant); }
}
```

**Why**: `in-progress` es el único estado accionable — debe destacar. `scheduled` (aún no arrancó) y `finalized` (histórico) son visualmente calmos y usan la misma paleta neutra. Coincide con la semántica del strip del listado (scheduled → outline neutro, in-progress → success, finalized → neutro).

### 5. Patrón `.exam-card__strip` en el listado

**Choice**: replicar la mecánica del home (`home.page.scss:263-282`) usando BEM local del tutor. `<span class="exam-card__strip">` posicionado `absolute` a la izquierda, ancho 4px, alto completo. La `.exam-card` receptora obtiene `position: relative` y `padding-left` para dejar hueco.

Modificadores en el `<li>` bindados desde el template:

```html
<li
  class="exam-card"
  [class.exam-card--scheduled]="exam.serverStatus.value === 'scheduled'"
  [class.exam-card--in-progress]="exam.serverStatus.value === 'in_progress'"
  [class.exam-card--finalized]="exam.serverStatus.value === 'finalized'"
  data-testid="exam-card"
>
  <span class="exam-card__strip" aria-hidden="true"></span>
  ...
</li>
```

Strips por estado:
- `--scheduled`: `background: var(--color-outline)`, `.exam-card` con `opacity: 0.7`.
- `--in-progress`: `background: var(--color-success)`.
- `--finalized`: `background: var(--color-outline-variant)`.

**Alternatives**: (a) `border-left: 4px solid` directo en `.exam-card`. (b) SVG absoluto.
**Rationale**: `<span>` absolute matchea 1:1 el patrón del home, mantiene el border-radius de la card sin cortes, y permite modificar altura/estilo del strip sin tocar el layout de la card. `border-left` conflictúa con el `border` general de `--color-outline-variant` que ya lleva la card.

### 6. Encapsulación: cero clases globales

**Choice**: todo estilo vive en el `.page.scss` correspondiente. Angular ViewEncapsulation por defecto (Emulated) genera atributos `[_ngcontent-…]` que aíslan del `home.page.scss`.
**Alternatives**: (a) mover `.user-info`, `.card__strip`, `.kicker` a `src/styles.scss` global. (b) crear componente compartido `<visual-strip-card>`.
**Rationale**: (a) contamina el global scope con clases usadas en 2 páginas — riesgo de colisión y regresión no observable. (b) prematuro para 2 consumidores con diseño idéntico; el costo de abstracción supera al DRY. Replicar CSS acotado es la opción baja-riesgo.

### 7. `max-width: 28rem` en el detail (era 42rem)

**Choice**: alinear a `28rem` (match list + home).
**Trade-off**: en pantallas anchas (>640px) la lista de alumnos queda más comprimida.
**Rationale**: la app es mobile-first PWA para uso en aula. Consistencia visual con el resto de páginas > densidad de información en tablet/desktop (uso residual). Además el spec `tutor-exam-list` ya usa `28rem` y el usuario tutor navega list↔detail — un salto de ancho generaría reflow molesto.

### 8. `:host { display: block; min-height: 100dvh }` en detail

El detail es la única página del proyecto que omite esta regla. Agregarla al top del SCSS elimina el overscroll blanco en iOS PWA standalone (Risk R5 del proposal).

### 9. Botón Volver — estilo tinted, sin caja

```scss
&__btn-volver {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  min-height: 44px;
  padding: 0.5rem 0.5rem 0.5rem 0;
  border: none;
  background: transparent;
  color: var(--color-primary);
  font-family: var(--font-body);
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  letter-spacing: -0.01em;

  .material-symbols-outlined { font-size: 1.25rem; margin-left: -4px; }
}
```

Cumple los asserts del spec: `border: none`, `background: transparent`, tap-target 44pt, `textContent` contiene `"Volver"`. El `onVolver()` del `.ts` queda intacto.

### 10. `<dl>` → `.user-info` (listado profile-card)

**Choice**: reemplazar el `<dl>` actual por `<ul class="tutor-exams-list__user-info">` con Material Symbols `mail` + `badge`, siguiendo la estructura BEM del home pero encapsulada (clase con prefijo de página, no la clase global `.user-info`).
**Rationale**: el spec `tutor-exam-list` exige explícitamente `<ul class="user-info">` con `mail` y `badge`. El nombre exacto de la clase pública en el DOM es `user-info` (para que el spec assertion `<ul class="user-info">` pase), pero Angular Emulated encapsulation garantiza que los estilos no colisionen con otras páginas.

**Nota implementación**: usar `class="user-info"` a secas en el `<ul>` (sin prefijo BEM de página) para cumplir literal la aserción del spec. Los estilos SCSS quedan bajo `.tutor-exams-list__profile-card .user-info { ... }` para mantener el scoping.

### 11. Aulas: mantener patrón actual con tokens

**Choice**: mantener `classroom-item` con `border-bottom` refinado con tokens (`var(--color-outline-variant)`).
**Alternatives**: convertir en mini-cards con `card__strip`.
**Rationale**: multiplicar cards explota la altura del listado en 320w y compite visualmente con las exam-cards que son la acción principal. Refactor sólo de tokens.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/LR_render/pages/tutor-exams-list/tutor-exams-list.page.html` | Modify | Remover `<span class="exam-card__course">`, `<dl>` → `<ul class="user-info">`, kicker+saludo, `<span class="exam-card__strip">` en cada card, class bindings de estado |
| `src/LR_render/pages/tutor-exams-list/tutor-exams-list.page.scss` | Modify | 7 tokens (map §1), `.exam-card__strip` + modificadores, jerarquía kicker+saludo, estilos `.user-info` scopeados |
| `src/LR_render/pages/tutor-exam-detail/tutor-exam-detail.page.html` | Modify | `{{ statusChip(...).label }}` + clase modificadora en chip con `data-testid="status-chip"`, botón Volver con `chevron_left`, `class` binding de estado en hero |
| `src/LR_render/pages/tutor-exam-detail/tutor-exam-detail.page.scss` | Modify | 8 tokens (map §1), `:host { display: block; min-height: 100dvh }`, `max-width: 28rem`, `&__status-chip` con modificadores, `&__btn-volver` tinted |
| `src/LR_render/pages/tutor-exam-detail/tutor-exam-detail.page.ts` | Modify | Añadir `protected statusChip(status: ExamServerStatusValue): { label: string; modifier: string }` |

Cero cambios fuera de estas 5 rutas.

## Alternatives Considered (resumen consolidado)

| Área | Alternativa rechazada | Motivo |
|------|-----------------------|--------|
| Helper mapping | Vivir en el view-model | Rompe separación de capas — VM es orquestación, no presentación textual |
| Chip icon | Icono dentro del `data-testid` | Material Symbols pintan el nombre del glifo en jsdom → rompe `.textContent.trim().toBe('Programado')` |
| Testid | Reutilizar `status-badge` para el chip del detail | Contratos distintos, tests históricos del listado usan `status-badge` con otro shape |
| Global CSS | Extraer `.user-info` / `.card__strip` a `styles.scss` | Contamina global scope; Emulated encapsulation suficiente para 2 consumidores |
| max-width | Mantener 42rem en detail | Genera reflow en la navegación list→detail; app es mobile-first |
| Aulas | Rediseñar como mini-cards | Altura desbordada en 320w y compite con exam-cards |

## Testing Strategy

**No se agregan tests nuevos.** El change confía enteramente en los feature-tests existentes (spec `tutor-exam-list` § "Tests inmutables" y `tutor-exam-management` § "Tests inmutables"):

| Layer | Cobertura existente | Enforcement |
|-------|---------------------|-------------|
| Feature (jsdom + TestBed) | `tests/feature/LR_render/pages/tutor-exams-list/**/*.spec.ts` (perfil, aulas, cards, testids, order DOM) | MUST NOT modificarse — spec lo declara inmutable |
| Feature (jsdom + TestBed) | `tests/feature/LR_render/pages/tutor-exam-detail/**/*.spec.ts` (btn-volver, chip label, `onVolver()`) | MUST NOT modificarse — spec lo declara inmutable |
| Unit (L1/L2) | N/A | Cambio 100% LR, no toca dominio |
| Static audit | `grep -rE '#[0-9a-fA-F]{3,8}' src/LR_render --include='*.scss'` → 0 | Success criterion del proposal |
| Static audit | `hexagonal-guard` sobre `src/` → 0 violations | Gate de archive (regla del CLAUDE.md) |

**Riesgo**: si algún test histórico asertaba en inglés (`"scheduled"`), el spec `tutor-exam-management` (ADDED "Chip label es-PE") lo declara bug preexistente; sin embargo el spec también declara los tests inmutables. Resolución: si aparece contradicción durante `sdd-apply`, escalar y crear un mini-change de ajuste de test — NO tocar tests desde este change.

## Migration / Rollout

No aplica migración. Cambio puramente cosmético en LR_render, sin estado persistido ni contrato HTTP afectado. El deploy es atómico con el bundle de Angular; no hay feature flag ni ramp-up necesario.

## Rollback

`git revert` del commit único (o del range de 2-3 commits agrupados por área: SCSS del listado, SCSS del detail, HTML+TS). El revert no rompe datos, no requiere migración inversa, no toca IndexedDB ni cookies. Post-revert, los feature-tests siguen verdes contra el HTML/SCSS original (que es lo que había en `develop`).

## Open Questions

Ninguna bloqueante. Las decisiones abiertas del contexto (L310 token, ubicación helper, chip modifier semantic) están resueltas explícitamente arriba con justificación.
