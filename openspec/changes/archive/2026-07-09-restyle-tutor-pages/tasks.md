# Tasks: Restyle Tutor Pages (Native Excellence alignment)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 180–240 (5 files, SCSS + HTML + TS only) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | single-pr |
| Chain strategy | size-exception (not needed — within budget) |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | All 5 LR_render files in one atomic PR | PR 1 | Base: `chore/restyle-tutor-pages`; tests/docs not modified |

---

## Phase 1: Verificaciones previas (sin cambios de código)

- [x] T1.1 Confirmar que todos los tokens del design map (design.md §1) existen en `src/styles.scss`: ejecutar `grep` de `--color-success-container`, `--color-on-success-container`, `--color-error-container`, `--color-on-error`, `--color-surface-container-lowest`, `--color-surface-container-high`, `--color-outline-variant`, `--color-outline`, `--color-primary`, `--color-error`, `--color-on-primary`, `--color-on-surface-variant`, `--color-success`, `--radius-pill` → si alguno falta, BLOCKER antes de continuar. (Ref: design.md §1; spec design-tokens "Auditoría grep")
- [x] T1.2 Confirmar que `Material Symbols Outlined` está cargado en `src/index.html` (línea 55, Google Fonts link existente). Grep: `grep "Material+Symbols" src/index.html`. (Ref: proposal.md "Dependencies"; specs tutor-exam-management §btn-volver, tutor-exam-list §user-info íconos)
- [x] T1.3 Ejecutar baseline de tests: `npm test -- --reporter=verbose 2>&1 | Select-String "tutor"` y anotar conteo verde/rojo. Todos deben estar verdes antes de arrancar cambios. (Ref: specs "Tests inmutables" — tutor-exam-list y tutor-exam-management)

## Phase 2: SCSS del listado (`tutor-exams-list.page.scss`)

- [x] T2.1 Reemplazar `var(--color-error, #dc2626)` (línea 111) por `var(--color-error)`. (Ref: design.md §1 tabla listado fila L111)
- [x] T2.2 Reemplazar los 4 fallbacks de `.exam-card`: línea 278 `var(--color-card-bg, #fff)` → `var(--color-surface-container-lowest)`; línea 279 `var(--color-border, #e5e7eb)` → `var(--color-outline-variant)`; líneas 286–287 `var(--color-primary, #1e3a5f)` → `var(--color-primary)` (×2). (Ref: design.md §1 tabla listado filas L278–L287)
- [x] T2.3 Reemplazar los 2 fallbacks de `.exam-card__status-badge` y `.__meta`: línea 309 `var(--color-status-bg, #f3f4f6)` → `var(--color-surface-container-high)`; línea 310 `var(--color-status-text, #374151)` → `var(--color-on-surface-variant)`; línea 317 `var(--color-text-secondary, #6b7280)` → `var(--color-on-surface-variant)`. (Ref: design.md §1 tabla listado filas L309–L317)
- [x] T2.4 Agregar bloque `.exam-card__strip` con `position: absolute; left: 0; top: 0; bottom: 0; width: 4px; border-radius: var(--radius) 0 0 var(--radius)` y añadir `position: relative; overflow: hidden` a `.exam-card` raíz. Agregar modificadores BEM: `.exam-card--scheduled .exam-card__strip { background: var(--color-outline); } .exam-card--scheduled { opacity: 0.7; } .exam-card--in-progress .exam-card__strip { background: var(--color-success); } .exam-card--finalized .exam-card__strip { background: var(--color-outline-variant); }`. (Ref: design.md §5; spec tutor-exam-list "Strip scheduled" y "Strip in_progress")
- [x] T2.5 Reemplazar bloque `.profile-meta` / `.profile-meta__row` / `dt` / `dd` por estilos `.profile-card .user-info` (scopeados al profile-card para cumplir design.md §10): `list-style: none; padding: 0; margin: var(--space-xs) 0 0; display: flex; flex-direction: column; gap: var(--space-xs)` con `li { display: flex; align-items: center; gap: var(--space-xs); font-size: 0.9rem; color: var(--color-on-surface-variant); }` y `.material-symbols-outlined { font-size: 1rem; }`. (Ref: design.md §10; spec tutor-exam-list "profile-card renderiza user-info")
- [x] T2.6 Verificar SCSS listado: `grep -rE '#[0-9a-fA-F]{3,8}' src/LR_render/pages/tutor-exams-list/` → 0 matches. (Ref: spec design-tokens "Cero hex en tutor-exams-list SCSS")

## Phase 3: HTML del listado (`tutor-exams-list.page.html`)

- [x] T3.1 Remover el bloque `@if (exam.courseId) { <span class="exam-card__course">{{ exam.courseId }}</span> }` (líneas 99–101 del template actual). (Ref: spec tutor-exam-list "courseId UUID no aparece en el DOM"; proposal.md "Quitar `<span class='exam-card__course'>`")
- [x] T3.2 Reemplazar `<dl class="profile-meta">...</dl>` (líneas 25–34) dentro del `@else { <section data-testid="profile-card">` por `<ul class="user-info"><li><span class="material-symbols-outlined" aria-hidden="true">mail</span> {{ vm.profileEmail() ?? vm.userEmail() }}</li><li><span class="material-symbols-outlined" aria-hidden="true">badge</span> {{ vm.userCode() }}</li></ul>`. El `data-testid="profile-card"` permanece en el `<section>`. (Ref: spec tutor-exam-list "profile-card renderiza user-info"; design.md §10)
- [x] T3.3 Agregar `<span class="exam-card__strip" aria-hidden="true"></span>` como primer hijo del `<li class="exam-card" data-testid="exam-card">` (línea 84 del template actual). (Ref: design.md §5; spec tutor-exam-list "Strip scheduled" / "Strip in_progress")
- [x] T3.4 Agregar bindings de clase de estado al `<li class="exam-card">`: `[class.exam-card--scheduled]="exam.serverStatus.value === 'scheduled'"`, `[class.exam-card--in-progress]="exam.serverStatus.value === 'in_progress'"`, `[class.exam-card--finalized]="exam.serverStatus.value === 'finalized'"`. (Ref: design.md §5 snippet HTML; spec tutor-exam-list "Tarjetas con 3 estados")
- [x] T3.5 Verificar que los `data-testid` existentes siguen en sus elementos raíz originales: `profile-card`, `profile-card-degraded`, `profile-skeleton`, `classrooms-summary`, `classroom-item`, `classrooms-empty`, `classrooms-section`, `exams-list`, `exam-card`, `status-badge`, `btn-logout`. Grep: `grep -o 'data-testid="[^"]*"' src/LR_render/pages/tutor-exams-list/tutor-exams-list.page.html`. (Ref: spec tutor-exam-list "data-testid existentes conservan elemento raíz")
- [x] T3.6 Ejecutar `npm test -- --reporter=verbose 2>&1 | Select-String "tutor-exams-list"` → todos verdes, sin modificar ningún archivo en `tests/feature/LR_render/pages/tutor-exams-list/`. (Ref: spec tutor-exam-list "Tests inmutables")

## Phase 4: TypeScript del detail (`tutor-exam-detail.page.ts`)

- [x] T4.1 Agregar import en el encabezado del archivo: `import { ExamServerStatusValue } from '../../../L1_domain/value-objects/exam-server-status';`. (Ref: design.md §2; spec tutor-exam-management "helper statusChip SHALL vivir en tutor-exam-detail.page.ts")
- [x] T4.2 Agregar método `protected statusChip(status: ExamServerStatusValue): { label: string; modifier: string }` con switch de 3 casos: `'scheduled' → { label: 'Programado', modifier: 'scheduled' }`, `'in_progress' → { label: 'En curso', modifier: 'in-progress' }`, `'finalized' → { label: 'Finalizado', modifier: 'finalized' }`. Colocar después de `onVolver()` siguiendo el precedente de `statusLabel()` en el page del listado. (Ref: design.md §2 snippet TS; spec tutor-exam-management "Chip scheduled/in_progress/finalized")

## Phase 5: SCSS del detail (`tutor-exam-detail.page.scss`)

- [x] T5.1 Agregar al inicio del archivo (antes de `.tutor-exam-detail`): `:host { display: block; min-height: 100dvh; padding: var(--space-lg) var(--space-md); box-sizing: border-box; }`. (Ref: design.md §8; proposal.md Risk R5)
- [x] T5.2 Cambiar `max-width: 42rem` → `max-width: 28rem` en `.tutor-exam-detail` (línea 6 actual). (Ref: design.md §7; spec tutor-exam-list "max-width 28rem")
- [x] T5.3 Reemplazar los 4 hex crudos de la sección de layout superior: línea 25 `background: #e5e7eb` → `var(--color-surface-container-high)`; línea 30 `background: #fee2e2` → `var(--color-error-container)`; línea 31 `border: #fca5a5` → `var(--color-error)`; línea 39 `color: #6b7280` → `var(--color-on-surface-variant)`. (Ref: design.md §1 tabla detail filas L25–L39)
- [x] T5.4 Reemplazar los 4 hex crudos de botones y lista: línea 62 `background: #2563eb` → `var(--color-primary)`; línea 63 `color: #fff` (btn-iniciar) → `var(--color-on-primary)`; línea 67 `background: #dc2626` → `var(--color-error)`; línea 68 `color: #fff` (btn-finalizar) → `var(--color-on-error)`. (Ref: design.md §1 tabla detail filas L62–L68)
- [x] T5.5 Reemplazar los 4 hex crudos restantes: línea 89 `border: #e5e7eb` → `var(--color-outline-variant)`; línea 105 `background: #f3f4f6` → `var(--color-surface-container-high)`; línea 106 `color: #6b7280` → `var(--color-on-surface-variant)`; línea 111 `color: #6b7280` → `var(--color-on-surface-variant)`. (Ref: design.md §1 tabla detail filas L89–L111)
- [x] T5.6 Agregar bloque `&__status-chip` BEM con base + 3 modificadores según design.md §4: base usa `var(--color-surface-container-high)` / `var(--color-on-surface-variant)`; `--in-progress` usa `var(--color-success-container)` / `var(--color-on-success-container)`; `--scheduled` y `--finalized` mantienen base. Incluir `border-radius: var(--radius-pill)`. (Ref: design.md §4 snippet SCSS)
- [x] T5.7 Agregar bloque `&__btn-volver` tinted: `border: none; background: transparent; color: var(--color-primary); min-height: 44px; display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.5rem 0.5rem 0.5rem 0; cursor: pointer` con `.material-symbols-outlined { font-size: 1.25rem; margin-left: -4px; }`. (Ref: design.md §9 snippet SCSS; spec tutor-exam-management "btn-volver no tiene border ni background")
- [x] T5.8 Verificar SCSS detail: `grep -rE '#[0-9a-fA-F]{3,8}' src/LR_render/pages/tutor-exam-detail/` → 0 matches. (Ref: spec design-tokens "Cero hex en tutor-exam-detail SCSS")

## Phase 6: HTML del detail (`tutor-exam-detail.page.html`)

- [x] T6.1 Reemplazar el contenido del `<button data-testid="btn-volver">` de `← Volver` por `<span class="material-symbols-outlined" aria-hidden="true">chevron_left</span> Volver`. El `data-testid="btn-volver"`, el atributo `type="button"`, la clase `tutor-exam-detail__btn-volver` y el `(click)="onVolver()"` permanecen intactos. (Ref: design.md §9; spec tutor-exam-management "btn-volver contiene el texto Volver")
- [x] T6.2 Reemplazar `<span class="tutor-exam-detail__status">{{ detail.status.value }}</span>` (línea 50) por `@let sc = statusChip(detail.status.value); <span class="tutor-exam-detail__status-chip tutor-exam-detail__status-chip--{{ sc.modifier }}" data-testid="status-chip">{{ sc.label }}</span>`. (Ref: design.md §3 snippet HTML; spec tutor-exam-management "Chip scheduled/in_progress/finalized renderiza label es-PE")
- [x] T6.3 Verificar que los `data-testid` existentes permanecen en sus elementos raíz: `btn-volver`, `error-banner`, `btn-retry`, `btn-iniciar`, `btn-finalizar`, `action-error-banner`, `student-item`, `student-checkbox`. Grep: `grep -o 'data-testid="[^"]*"' src/LR_render/pages/tutor-exam-detail/tutor-exam-detail.page.html`. (Ref: spec tutor-exam-management; spec design-tokens "Restricciones de capa")
- [x] T6.4 Ejecutar `npm test -- --reporter=verbose 2>&1 | Select-String "tutor-exam-detail"` → todos verdes, sin modificar ningún archivo en `tests/feature/LR_render/pages/tutor-exam-detail/`. (Ref: spec tutor-exam-management "Tests inmutables")

## Phase 7: Auditoría global

- [x] T7.1 Ejecutar `npm test` completo → 0 failures. (Ref: proposal.md "Success Criteria")
- [x] T7.2 Ejecutar `npm run lint` → sin warnings nuevos respecto al baseline. (Ref: proposal.md "Success Criteria")
- [x] T7.3 Ejecutar `npm run format:check` → limpio; si falla, ejecutar `npm run format` y commitear. (Ref: agentes/coding-style.md)
- [x] T7.4 Correr subagente `hexagonal-guard` sobre `src/` → 0 violations (el change es 100% LR_render). (Ref: spec design-tokens "hexagonal-guard reporta 0 violaciones"; CLAUDE.md regla #3)
- [x] T7.5 Verificar cero hex globales en tutor pages: `grep -rE '#[0-9a-fA-F]{3,8}' src/LR_render/pages/tutor-exams-list/ src/LR_render/pages/tutor-exam-detail/` → 0 matches. (Ref: spec design-tokens "Auditoría grep")
- [x] T7.6 Verificar que el DOM del listado no contiene courseId: `grep "exam-card__course" src/LR_render/pages/tutor-exams-list/tutor-exams-list.page.html` → 0 matches. (Ref: spec tutor-exam-list "courseId UUID no aparece en el DOM")
- [x] T7.7 Inspección visual manual en dev server (`npm run dev`) — verificar en navegador: kicker+saludo+`user-info` en listado, chip pill es-PE en detail, strip lateral por estado, botón Volver con chevron tinted sin borde. (Ref: proposal.md "Success Criteria" último criterio)
