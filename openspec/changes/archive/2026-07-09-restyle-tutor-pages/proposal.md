# Proposal: Restyle Tutor Pages (Native Excellence alignment)

## Intent

Las páginas del tutor (`tutor-exams-list`, `tutor-exam-detail`) están estéticamente fuera del sistema Native Excellence que ya adoptaron `home` del alumno y `login`: usan azul Tailwind genérico en vez de Fiovi Blue, muestran UUIDs crudos al tutor, dejan `"scheduled" / "in_progress" / "finalized"` en inglés en la UI, y traen 15 hex literales hardcoded en SCSS (violación de `design-tokens`). Restyle acotado a LR_render, sin tocar dominio ni contratos.

## Scope

### In Scope

- Reemplazo de 15 hex literales por tokens en:
  - `src/LR_render/pages/tutor-exams-list/tutor-exams-list.page.scss` (7 fallbacks)
  - `src/LR_render/pages/tutor-exam-detail/tutor-exam-detail.page.scss` (8 crudos)
- Quitar `<span class="exam-card__course">{{ exam.courseId }}</span>` del template del listado (UUID fuera del DOM).
- Nuevo helper `statusChip(status)` en `tutor-exam-detail.page.ts` que mapea `scheduled→"Programado"`, `in_progress→"En curso"`, `finalized→"Finalizado"` + clase modificadora BEM. Chip render solo texto label (sin íconos dentro del `[data-testid]`).
- Jerarquía visual del listado alineada al home del alumno: kicker uppercase + saludo `--font-display` 1.625rem + `user-info` fila ícono+texto (reemplaza `<dl>` del profile-card) + exam-cards con `card__strip` lateral coloreado por estado.
- Botón Volver del detail: `chevron_left` + "Volver", tinted `--color-primary`, sin caja bordeada, tap-target 44pt.
- Alinear `max-width` del detail a `28rem` (match list/home).
- Agregar `:host { display: block; min-height: 100dvh }` al detail SCSS.

### Out of Scope

- `src/LR_render/pages/simulacro/` (cartilla — explícito user).
- `src/LR_render/pages/home/` y `src/LR_render/pages/login/`.
- View-models `tutor-*.view-model.ts` (chip mapping vive en el page, no en el VM).
- Cualquier archivo de L1/L2/L3, stores, contratos HTTP.
- Cambiar/mover `data-testid` existentes.
- Alterar el método `onVolver()` (test lo verifica reflectivamente).
- Nuevos data-testid, nuevos endpoints, i18n framework.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `tutor-exam-list`: refina "Tarjetas con 3 estados via Signals" agregando requisito de que el DOM del listado NO exponga `courseId` (UUID) al tutor. Refina "Ruta /tutor/home — header completo" para especificar la jerarquía visual (kicker + saludo grande + `user-info` fila ícono+texto) sin cambiar los data-testid ni la data expuesta.
- `tutor-exam-management`: agrega requisito de "Chip de estado localizado al español" — el chip que refleja `detail().serverStatus.value` renderiza SOLO el label es-PE (`Programado / En curso / Finalizado`) dentro del `[data-testid]` asertable con `.textContent.trim()`. NO cambia los requisitos de acciones, back-button, ni copys de error.
- `design-tokens`: refuerzo — los dos SCSS del tutor pasan a cumplir "cero hex literales" (ya obligatorio a nivel proyecto, aquí se cierra un gap concreto).

## Approach

Restyle quirúrgico HTML+SCSS+una función de mapping. Los cambios se limitan a:

1. **SCSS** — sed-replace de 15 hex por `var(--color-*)` usando el mapeo del explore artifact (todos los tokens ya existen en `src/styles.scss`).
2. **HTML del listado** — remover el `<span class="exam-card__course">`, reestructurar el profile-card de `<dl>` a `.user-info` fila, agregar `.card__strip` a las exam-cards, actualizar el `kicker` + saludo.
3. **HTML+TS del detail** — reemplazar el texto crudo del status por `{{ statusChip(detail().serverStatus.value).label }}` + clase modificadora, refactor del botón Volver a estilo tinted con ícono chevron, agregar wrapper `.card__strip` a la sección hero, ajustar `max-width` a `28rem`.
4. **Verify** — grep de `#[0-9a-fA-F]{3,8}` en los dos SCSS = 0, `npm test` con specs actuales pasa, `npm run lint` sin warnings nuevos, `hexagonal-guard` reporta 0 (no debería tocar boundaries — todo LR).

No se agregan tests nuevos: los feature-tests existentes de `tutor-*` ya asertan textContent en el chip; deben seguir pasando sin modificar (si algún test rompe por el label es-PE, el test estaba mal antes — se ajusta a texto en español manteniendo el mismo pattern del `statusLabel()` del list).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/LR_render/pages/tutor-exams-list/tutor-exams-list.page.html` | Modified | Quitar UUID, reestructurar profile-card, kicker+saludo, card__strip |
| `src/LR_render/pages/tutor-exams-list/tutor-exams-list.page.scss` | Modified | 7 hex → tokens, jerarquía visual, exam-card strip |
| `src/LR_render/pages/tutor-exam-detail/tutor-exam-detail.page.html` | Modified | Chip localizado, botón Volver tinted, card__strip, class binding |
| `src/LR_render/pages/tutor-exam-detail/tutor-exam-detail.page.scss` | Modified | 8 hex → tokens, `:host { display: block; min-height: 100dvh }`, `max-width: 28rem`, chip pill BEM |
| `src/LR_render/pages/tutor-exam-detail/tutor-exam-detail.page.ts` | Modified | Añadir helper `statusChip(status): { label, modifier }` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| R1 — Header más alto en detail genera scroll molesto en 320w | Med | Densidad compacta: `padding-block` reducido en header, kicker en 0.6875rem, saludo 1.375rem en mobile |
| R2 — Desalineación de `max-width` detail (42rem) vs list/home (28rem) | Low | Alinear detail a 28rem (decisión explícita) |
| R3 — Chip con ícono rompe aserción `toBe('Programado')` en jsdom (Material Symbols pintan el nombre del ícono) | High | Chip render SOLO texto label dentro del `[data-testid]`; cualquier ícono queda fuera del contenedor asertable |
| R4 — Fallback `#dc2626` del list scss era incorrecto (real `--color-error` = `#ba1a1a`) | N/A (bug fix) | Quitar fallback y usar `var(--color-error)` directo |
| R5 — Detail scss sin `:host { display: block; min-height: 100dvh }` deja fondo blanco en overscroll iOS | Med | Añadir la regla al `:host` |
| R7 — Tests feature usan `.textContent.trim().toBe(...)` con inglés | Med | Ajustar el spec test para asertar es-PE (una línea por status). Si el test fuera intocable, sería R3 recurrente — asumimos ajuste puntual del assert |

## Rollback Plan

`git revert` del commit único (o de la PR de 2-3 commits). El change no toca dominio, contratos, ni schema — el rollback es puramente cosmético y no rompe datos. Si el revert ocurre después del merge a `develop`, no hay migración ni state a limpiar.

## Dependencies

- Ninguna externa. Todos los tokens ya existen en `src/styles.scss`. `chevron_left` y demás símbolos ya cargan por `Material Symbols Outlined` en `index.html`.

## Success Criteria

- [ ] `grep -rE '#[0-9a-fA-F]{3,8}' src/LR_render/pages/tutor-*` devuelve 0 matches.
- [ ] `npm test` pasa (todos los specs `tutor-*` verdes; ajustes son solo de texto asertado es-PE si aplica).
- [ ] `npm run lint` sin warnings nuevos.
- [ ] `hexagonal-guard` reporta 0 violaciones (no debería aplicar — cambio 100% LR_render).
- [ ] DOM del listado NO contiene el `courseId` (grep del rendered template).
- [ ] Chip del detail renderiza `Programado / En curso / Finalizado`, nunca `scheduled / in_progress / finalized`.
- [ ] Kicker + saludo del tutor list matchea visualmente el look del home del alumno (screenshot side-by-side o inspección manual del diseñador).
- [ ] Botón Volver: chevron + "Volver", tinted `--color-primary`, sin borde, tap-target ≥ 44pt.
