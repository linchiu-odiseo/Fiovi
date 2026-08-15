# Design: Reconcile enabled students on start — ARCHIVED

**Change:** `reconcile-enabled-on-start-gate` — arquivado 2026-08-15

## Architecture Summary

Extensión mínima front-only sobre dos capacidades ya existentes (`tutor-exams-api` y `tutor-exam-management`). El nuevo endpoint `POST /virtual-exams/:recordId/refresh-enabled` (backend en PR paralelo de learnex) se consume a través del stack hexagonal completo: puerto L1 (`TutorExamsApi.refreshEnabled`) → adapter HTTP L3 (`HttpTutorExamsApi` con clasificación de errores por status) → use case L2 (`RefreshHabilitadosUseCase` como wrapper delgado) → view-model LR (signal aislado `gateState` + computed `showRoster` + método `handleRefresh`). El gate vive como tercer estado de la propia página tutor-detail (no como modal separado), es LOCAL al componente (sin persistencia), y se resetea naturalmente por el ciclo de vida Angular al desmontar/remontar.

## Key Decisions

**D1:** Nuevo método `refreshEnabled` en puerto existente `TutorExamsApi` (no crear port separado) — cohesión alta.

**D2:** Response tipada minimalista `{ addedCount, totalEnabledCount }` — matching exacto del contrato learnex backend.

**D3:** Use case `RefreshHabilitadosUseCase` como wrapper delgado (~12-15 LOC) — patrón simétrico con `IniciarExamenUseCase`.

**D4:** `gateState` como signal LOCAL del VM (no store, no context, no storage) — reset garantizado por ciclo de vida.

**D5:** Computed `showRoster` para evitar duplicar condicional en template — single source of truth.

**D6:** CTA único que se transforma según `gateState` (no dos botones separados) — UX móvil, space efficiency.

**D7:** Aislar `gateState` de computeds/effects existentes (countdown, D1, optimistic) — cero riesgo de regresión.

**D8:** Error classification via try/catch del use case (patrón existente) — por status HTTP, nunca por `body.message`.

**D9:** Sin "guardar overrides antes de iniciar" — checkboxes en Fiovi ya persisten optimista (diferente a learnex web-tenant).

**D10:** Orden de commits (6 commits bottom-up: L1 → L3 paths → L3 adapter → L2 → LR VM → LR template+component) — facilita split si necesario.

**D11:** Testing strategy — unit L2 (3 escenarios) + feature LR (existing tests PASS unchanged) + hexagonal-guard (bloqueante).

**D12:** Deploy order coordinado — learnex first, then Fiovi. Sin feature flags (fallback de error clasificado es suficiente).

## Files Modified/New

| File | Action | LOC | Notes |
|------|--------|-----|-------|
| `src/L1_domain/ports/tutor-exams-api.ts` | Modified | 6 | 7mo método `refreshEnabled` |
| `src/L3_periphery/http/api-paths.ts` | Modified | 4 | helper `virtualExamRefreshEnabled` |
| `src/L3_periphery/http/http-tutor-exams-api.ts` | Modified | 30 | adapter POST + Zod + error classification |
| `src/L2_application/use-cases/refresh-habilitados.use-case.ts` | New | 14-15 | wrapper L2 |
| `src/L2_application/use-cases/refresh-habilitados.use-case.spec.ts` | New | 45 | 3 scenarios (Vitest) |
| `src/LR_render/view-models/tutor-exam-detail.view-model.ts` | Modified | 40 | gateState + showRoster + handleRefresh |
| `src/LR_render/pages/tutor-exam-detail/tutor-exam-detail.page.html` | Modified | 20 | conditional render + CTA transformable |
| `src/LR_render/pages/tutor-exam-detail/tutor-exam-detail.page.ts` | Modified | 6 | onRefresh() handler |

Ver `openspec/changes/reconcile-enabled-on-start-gate/design.md` para el documento completo con component map, decisiones detalladas, contratos, y preguntas abiertas.
