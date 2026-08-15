# Proposal: Reconcile enabled students on start — gate en `TutorExamDetailPage`

## Intent

En Fiovi el tutor entra a `/tutor/exams/:recordId` y ve directo la lista de alumnos habilitados. Esa lista quedó congelada al programar el examen y NO refleja matrículas creadas después (el batch de matriculación corre de madrugada). Resultado: alumnos nuevos del aula quedan fuera del examen y nadie se entera hasta que un admin agrega manualmente.

Este change agrega un **gate obligatorio** en la vista tutor cuando `status === 'scheduled'`: al entrar, el roster y los botones "Finalizar"/"Archivar" quedan ocultos y aparece un único CTA `[Actualizar lista]`. Al presionarlo se llama al endpoint `POST /virtual-exams/:recordId/refresh-enabled` (definido en el PR paralelo de learnex `feat/reconcile-enabled-on-start-gate`), se muestra la lista con los alumnos nuevos incluidos, y el mismo botón se transforma en `[Iniciar examen]` (que abre el modal existente de duración/modo sin cambios).

Mismo problema que resolvimos en learnex web-tenant, ahora replicado en la PWA del tutor. Front-only, un solo PR (~200 LOC).

## Scope

### In Scope

- Nuevo método `refreshEnabled(recordId)` en el puerto `TutorExamsApi` (L1) — devuelve `{ addedCount, totalEnabledCount }`.
- Nueva ruta en `api-paths.ts`: `virtualExamRefreshEnabled(slug, recordId)`.
- Implementación en `HttpTutorExamsApi` (L3) — POST, timeout 10s, clasificación de errores por status igual a los otros métodos.
- Nuevo use case `RefreshHabilitadosUseCase` (L2) — wrapper delgado (~12-15 LOC) siguiendo el patrón de `IniciarExamenUseCase`.
- Unit tests del use case: happy path, 409 (status no `scheduled`), network error.
- Extensión de `TutorExamDetailViewModel`: signal `gateState: 'idle' | 'refreshing' | 'ready'`, computed `showRoster`, método `handleRefresh()`. Sin modificar el contrato público del VM.
- Conditional render en `tutor-exam-detail.page.html` del roster + CTA transformable + ocultar botones finalizar/archivar cuando el gate está activo (`status === 'scheduled' && gateState !== 'ready'`).
- Wire de la signal + click handler `onRefresh()` en `tutor-exam-detail.page.ts`.
- Reset natural del gate por desmontaje del componente (sin persistencia).

### Out of Scope (Non-goals)

- **Backend cero.** El endpoint ya lo agrega el PR de learnex.
- NO tocar el modal "Iniciar actividad" existente (duración, modo examen/tarea, rueda de días/horas).
- NO tocar countdown ticker, D1 cold/warm store resolution, effect diferido, ni optimistic checkbox updates + rollback.
- NO agregar patrón "guardar overrides antes de iniciar" — los checkboxes en Fiovi ya persisten optimista al toggle (diferente a learnex web-tenant).
- NO tocar rutas, `authGuard`, ni `roleGuard('tutor')`.
- NO persistir el gate en localStorage / sessionStorage / context / effect.
- NO aplicar gate a exámenes `in_progress` ni `finalized` — el flujo actual queda intacto en esos estados.
- NO tocar la vista del alumno.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tutor-exams-api`: agrega un 7mo método `refreshEnabled(recordId)` al puerto L1, su adapter HTTP con clasificación de errores por status, y el use case L2 `RefreshHabilitadosUseCase`.
- `tutor-exam-management`: agrega el gate de reconciliación en `TutorExamDetailViewModel` + `TutorExamDetailPage` (estado A idle, refresh, estado B ready, reset por remount), solo para `status === 'scheduled'`.

## Approach

Extensión mínima de dos capacidades ya existentes, sin nuevas rutas ni nuevos componentes de página. El gate vive como un tercer estado de la propia página (no como un modal aparte), lo que es más natural en móvil y evita layering extra.

- **L1/L2/L3** — patrón calcado de `iniciar` / `finalizar`: port method → HTTP adapter con status-based error classification → use case wrapper. Cero lógica de negocio nueva; sólo transporta el resultado.
- **LR** — `gateState` es un signal aislado que NO participa en los computeds/effects existentes (countdown ticker, D1 resolution, optimistic updates). El template usa un único `@if (status === 'scheduled' && gateState !== 'ready')` para ocultar/mostrar bloques. El CTA es un solo `<button>` cuyo label + handler se derivan de `gateState`.
- **Sin persistencia del gate**: reset garantizado por el ciclo de vida del componente (navegación fuera y vuelta, refresh de browser, tab close+reopen → estado A siempre).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/L1_domain/ports/tutor-exams-api.ts` | Modified | +1 método `refreshEnabled(recordId): Promise<{addedCount, totalEnabledCount}>` |
| `src/L3_periphery/http/api-paths.ts` | Modified | +1 helper `virtualExamRefreshEnabled(slug, recordId)` |
| `src/L3_periphery/http/http-tutor-exams-api.ts` | Modified | +1 método implementando `refreshEnabled` — POST, timeout 10s, status-based error mapping |
| `src/L2_application/use-cases/refresh-habilitados.use-case.ts` | New | Use case wrapper (~12-15 LOC) |
| `src/L2_application/use-cases/refresh-habilitados.use-case.spec.ts` | New | Unit tests: happy path + 409 + network error |
| `src/LR_render/view-models/tutor-exam-detail.view-model.ts` | Modified | +signal `gateState`, +computed `showRoster`, +método `handleRefresh` |
| `src/LR_render/pages/tutor-exam-detail/tutor-exam-detail.page.html` | Modified | Conditional render roster + CTA transformable + ocultar finalizar/archivar en estado A |
| `src/LR_render/pages/tutor-exam-detail/tutor-exam-detail.page.ts` | Modified | Wire de signal + `onRefresh()` click handler |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| El VM rompe countdown ticker o effect diferido | Baja | `gateState` completamente aislado; contrato público del VM no cambia; feature tests cubren los 3 estados |
| CSS layout se ve raro cuando el roster está oculto | Media (cosmético) | Smoke manual con browser antes de PR |
| Fiovi deploya antes que learnex → click "Actualizar lista" da 404 | Media | Orden documentado en el PR: (1) merge+deploy learnex, (2) merge+deploy Fiovi. Coordinar con equipo |
| Regresión en flujo `in_progress` / `finalized` | Baja | Condicional bien tipada: `status === 'scheduled' && gateState !== 'ready'`; tests cubren los 3 statuses |
| Tutor debe hacer 1 click más que hoy | Alta (intencional) | Es feature, no bug — el gate ES el punto |

## Rollback Plan

Revert del PR. Sin migraciones DB (no toca backend), sin persistencia (no toca IDB ni storage), sin cache invalidation. El comportamiento previo (roster visible directo, botón "Iniciar actividad" sin gate) vuelve inmediatamente al redeploy.

## Dependencies

- PR learnex `feat/reconcile-enabled-on-start-gate` DEBE estar mergeado y deployado a producción ANTES del deploy de Fiovi. El endpoint `POST /virtual-exams/:recordId/refresh-enabled` (response `{ addedCount, totalEnabledCount }`, 409 si status no es `scheduled`) es la única API consumida por este change.
- Deploy planificado para fin de semana (bajo tráfico de tutores).

## Success Criteria

- [ ] Tutor entra a `/tutor/exams/:recordId` con status `scheduled` → NO ve lista de alumnos ni botones finalizar/archivar; ve card con CTA `[Actualizar lista]`.
- [ ] Click en `[Actualizar lista]` → llama `POST /virtual-exams/:recordId/refresh-enabled` → aparece lista con matriculados nuevos → CTA se transforma en `[Iniciar examen]`.
- [ ] Click en `[Iniciar examen]` → abre modal existente de duración/modo (sin cambios visibles) → confirmar arranca el examen.
- [ ] Tutor entra a examen con status `in_progress` o `finalized` → ve lista y botones directo (sin gate).
- [ ] Navegar fuera y volver → vuelve a Estado A siempre (sin persistencia).
- [ ] Zero regresión visible en countdown, D1 cold/warm resolution, y optimistic checkbox updates + rollback.
- [ ] Unit tests del use case pasan (happy + 409 + network error).
