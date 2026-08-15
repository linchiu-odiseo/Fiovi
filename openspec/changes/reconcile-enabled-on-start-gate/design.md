# Design: Reconcile enabled students on start — gate en `TutorExamDetailPage`

## Architecture Summary

Extensión mínima front-only sobre dos capacidades ya existentes (`tutor-exams-api` y `tutor-exam-management`). El nuevo endpoint `POST /virtual-exams/:recordId/refresh-enabled` (backend en PR paralelo de learnex) se consume a través del stack hexagonal completo: puerto L1 (`TutorExamsApi.refreshEnabled`) → adapter HTTP L3 (`HttpTutorExamsApi` con clasificación de errores por status) → use case L2 (`RefreshHabilitadosUseCase` como wrapper delgado) → view-model LR (signal aislado `gateState` + computed `showRoster` + método `handleRefresh`). El gate vive como tercer estado de la propia página tutor-detail (no como modal separado), es LOCAL al componente (sin persistencia), y se resetea naturalmente por el ciclo de vida Angular al desmontar/remontar. Aisladamente del countdown ticker, D1 resolution, effect diferido y optimistic checkbox updates que ya están en el VM.

## Component Map

```
                    ┌──────────────────────────────────────────────┐
                    │  LR_render                                   │
                    │                                              │
                    │  TutorExamDetailPage (.page.ts + .html)      │
                    │    ├─ template: @if (showRoster()) roster    │
                    │    ├─ template: CTA transformable            │
                    │    └─ onRefresh() ─► vm.handleRefresh()      │
                    │                                              │
                    │  TutorExamDetailViewModel                    │
                    │    ├─ gateState: Signal<idle|refresh|ready>  │  ◄── D4 (LOCAL, sin store)
                    │    ├─ showRoster: Computed<boolean>          │  ◄── D5
                    │    ├─ handleRefresh(): try/catch clasific.   │  ◄── D8
                    │    │                                         │
                    │    │  (aislado de countdown/D1/optimistic)   │  ◄── D7
                    │    │                                         │
                    │    └─► refreshHabilitadosUseCase.execute(id) │
                    └────────────────────┬─────────────────────────┘
                                         │
                    ┌────────────────────▼─────────────────────────┐
                    │  L2_application                              │
                    │                                              │
                    │  RefreshHabilitadosUseCase (~12-15 LOC)      │  ◄── D3
                    │    constructor(api: TutorExamsApi)           │
                    │    execute(recordId) ─► api.refreshEnabled() │
                    └────────────────────┬─────────────────────────┘
                                         │
                    ┌────────────────────▼─────────────────────────┐
                    │  L1_domain                                   │
                    │                                              │
                    │  TutorExamsApi (port existente)              │
                    │    ├─ getTutorExams / getExamsFinalizadas    │
                    │    ├─ getExamDetail / listClassroomStudents  │
                    │    ├─ updateEnabledStudents                  │
                    │    ├─ iniciar / finalizar / archivar         │
                    │    └─ refreshEnabled(recordId) ← NEW 9º mét. │  ◄── D1
                    │         Promise<{addedCount, totalEnabledC.}>│  ◄── D2
                    └────────────────────▲─────────────────────────┘
                                         │ implements
                    ┌────────────────────┴─────────────────────────┐
                    │  L3_periphery                                │
                    │                                              │
                    │  HttpTutorExamsApi                           │
                    │    └─ refreshEnabled() ← nueva impl.         │
                    │         POST + timeout 10s + Zod inline      │  ◄── D2
                    │         status→error class. (409/403/404/…)  │  ◄── D8
                    │                                              │
                    │  api-paths.ts                                │
                    │    └─ virtualExamRefreshEnabled(slug, id)    │
                    └──────────────────────────────────────────────┘

                    Deploy order:  learnex (backend)  →  Fiovi     ◄── D12
                    Commit order:  L1 → L3paths → L3adapter → L2   ◄── D10
                                   → LR VM → LR template
```

---

## Decisions

### D1 — Nuevo método `refreshEnabled` en el port `TutorExamsApi` (no un port nuevo)

- **Contexto:** el port `TutorExamsApi` ya existe con 8 métodos que cubren todo el ciclo de vida de un examen virtual desde la vista tutor.
- **Decisión:** agregar `refreshEnabled(recordId): Promise<{addedCount, totalEnabledCount}>` como 9º método en la interface existente en `src/L1_domain/ports/tutor-exams-api.ts`.
- **Trade-offs / alternativa descartada:** un port aparte `RefreshEnabledStudentsApi` mantiene single-responsibility a nivel micro pero fragmenta la superficie de la capacidad `tutor-exams-api`. Se descarta: cohesión alta gana sobre granularidad artificial. Todos los adapters HTTP tutor ya viven en `HttpTutorExamsApi`, forzar un port separado obligaría a otro adapter con la misma inyección de `SlugStore` + `HttpClient` sin beneficio.

### D2 — Response tipada minimalista `{ addedCount, totalEnabledCount }`

- **Contexto:** matching exacto del contrato del PR paralelo de learnex. La lista actualizada NO se devuelve en este response — se obtiene por el `reloadDetail()` que ya existe en el VM y hace refetch del detalle + roster.
- **Decisión:** validar el response con schema Zod inline en el adapter HTTP: `z.object({ addedCount: z.number().int().nonnegative(), totalEnabledCount: z.number().int().nonnegative() })`. Superficie pública del port devuelve el tipo estrictamente.
- **Trade-offs / alternativa descartada:** devolver la lista completa de alumnos en el response del refresh evitaría un round-trip. Se descarta porque (a) rompe el contrato ya definido en learnex, (b) duplica la lógica que ya vive en `getExamDetail` / `listClassroomStudents`, (c) el reload es barato y ya está probado en producción.

### D3 — Use case `RefreshHabilitadosUseCase` como wrapper delgado

- **Contexto:** en Fiovi todos los use cases L2 son wrappers delgados sobre ports L1. Ejemplo canónico: `IniciarExamenUseCase` (28 líneas) o `ActualizarAlumnosHabilitadosUseCase` (12 líneas).
- **Decisión:** crear `src/L2_application/use-cases/refresh-habilitados.use-case.ts` (~12-15 LOC): constructor recibe `TutorExamsApi`, método `execute(recordId: string)` delega directo al port. Sin lógica adicional, sin mapping, sin side effects.
- **Trade-offs / alternativa descartada:** llamar el port directo desde el VM ahorraría el wrapper pero rompe hexagonal — el VM (LR) no debe conocer ports L1 directamente, sino consumir use cases L2. El "boilerplate" es intencional: mantiene simetría con `IniciarExamenUseCase` y permite agregar validación de VO / lógica de dominio en el futuro sin refactor cross-cutting.

### D4 — `gateState` como signal LOCAL del `TutorExamDetailViewModel` (no store, no context)

- **Contexto:** REQ-VM-4 exige que el gate se resetee en cada visita fresca a la página (navegación fuera y vuelta, refresh de browser, tab close+reopen → estado A `idle` siempre). Persistir en store, context, localStorage o sessionStorage violaría esa semántica.
- **Decisión:** `WritableSignal<'idle' | 'refreshing' | 'ready'>` privado dentro del VM, expuesto readonly. Vive en la instancia del VM que Angular crea al montar `TutorExamDetailPage`. Reset natural: cuando el componente se destruye, la instancia del VM se destruye, y con ella el signal. Al re-montar (nueva navegación), VM nuevo con estado inicial `'idle'`.
- **Trade-offs / alternativa descartada:**
  - Signal global en un store: rompe la semántica de reset (persistiría entre navegaciones).
  - `useEffect` + localStorage: viola REQ-VM-4 explícitamente.
  - Context de ruta: layer extra sin beneficio; el ciclo de vida del componente ya da el reset gratis.

### D5 — Computed `showRoster` para evitar duplicar condicional en el template

- **Contexto:** el template debe ocultar/mostrar 3 secciones (roster de alumnos, botón "Finalizar", botón "Archivar") según el mismo predicado. Duplicar la expresión `status !== 'scheduled' || gateState === 'ready'` en tres `@if` invita bugs de sincronización futuros.
- **Decisión:** exponer un único `computed<boolean>('showRoster')` en el VM: `computed(() => status() !== 'scheduled' || gateState() === 'ready')`. El template usa `@if (vm.showRoster())` en las tres secciones.
- **Trade-offs / alternativa descartada:** duplicar la expresión en el template es más "explícito" pero pierde el single-source-of-truth. Si mañana la regla del gate cambia (ej: aplicar también a `in_progress`), un solo lugar en el VM vs. tres en el template.

### D6 — CTA único que se transforma según `gateState` (no dos botones separados)

- **Contexto:** UX en móvil pedida explícitamente por el usuario: "un solo botón que se transforma". Fiovi es PWA mobile-lite; el vertical space es premium.
- **Decisión:** un solo `<button>` cuyo `label` + handler `on:click` se derivan de `gateState`:
  - `gateState === 'idle'` → label `"Actualizar lista"`, handler `onRefresh()`.
  - `gateState === 'refreshing'` → label `"Actualizando..."`, `disabled=true`.
  - `gateState === 'ready'` (y `status === 'scheduled'`) → label `"Iniciar examen"`, handler abre el modal existente de duración/modo.
- **Trade-offs / alternativa descartada:** dos botones separados (uno de refresh, uno de iniciar oculto por `@if`) es más explícito y typesafe pero desperdicia espacio en móvil y crea saltos visuales entre estados. Se descarta por decisión de UX. La lógica extra en el template está acotada al derive del label+handler (un ternario o `@switch`).

### D7 — Aislar `gateState` de los computeds/effects existentes del VM

- **Contexto:** `TutorExamDetailViewModel` (930 LOC) contiene lógica sensible: countdown ticker (effect anclado a Clock port), D1 cold/warm store resolution, effect diferido con jitter para thundering herd, optimistic checkbox updates con rollback. Cualquier acoplamiento accidental con `gateState` puede romper esa lógica en formas difíciles de detectar.
- **Decisión:** `gateState`, `showRoster` y `handleRefresh` viven en un bloque aparte del VM (comentario de sección visible al final del archivo o antes del constructor). Reglas duras:
  - `gateState` NO se lee desde ningún computed/effect existente.
  - `showRoster` solo lo consume el template.
  - `handleRefresh` solo dispara `reloadDetail()` que ya existe (invalida cache, refetch detail + roster) — sin tocar countdown ni optimistic paths.
- **Trade-offs / alternativa descartada:** entrelazar `gateState` con computeds existentes (ej: pasar el gate como condición al effect diferido) parece "elegante" pero introduce riesgo enorme sobre lógica en producción. Disciplina en el diff; `hexagonal-guard` audita.

### D8 — Error classification via `try/catch` del use case (patrón existente)

- **Contexto:** el port `TutorExamsApi` propaga errores tipados por status vía reject de la Promise (`ForbiddenError`, `NotFoundError`, `ConflictError`, `PreconditionError`, `NetworkError`). Regla del repo (CLAUDE.md #3): clasificación por `(status, endpoint, code)`, nunca por texto de `message`.
- **Decisión:** `handleRefresh` en el VM usa `try/catch`:
  - `ConflictError` (409, status ya no es `scheduled`): setear `actionError` (mecanismo existente) + volver `gateState` a `'idle'`.
  - `NetworkError`: setear `actionError` + volver a `'idle'`.
  - `ForbiddenError` (403) / `NotFoundError` (404): setear `actionError` + volver a `'idle'`.
  - Cualquier otro: rethrow (no debería pasar; deja que el error handler global lo capture).
- **Trade-offs / alternativa descartada:** el mensaje visible al usuario NO se hardcodea en `handleRefresh`; se delega al mecanismo `actionError` signal que ya existe y renderiza en el toast/banner estándar. Alternativa descartada: switch por error con mensajes literales en el VM — duplicaría strings ya definidos y violaría separation of concerns.

### D9 — Sin "guardar overrides antes de iniciar" (diferencia con learnex web-tenant)

- **Contexto:** en learnex web-tenant, los checkboxes del roster eran LOCAL-ONLY hasta que el tutor confirmaba "Iniciar" — por eso el fix `1936b363` agregó `updateEnabledStudents` como paso intermedio antes de `iniciar`. En Fiovi los checkboxes YA persisten optimista via `toggleStudent()` (PATCH `/enabled-students` + rollback si el server rechaza), y este patrón está probado en producción.
- **Decisión:** cuando el tutor apreta "Iniciar examen" en Estado B (`gateState === 'ready'`), NO se agrega llamada intermedia de `updateEnabledStudents`. Solo se abre el modal existente de duración/modo, y al confirmar se llama `iniciar()` directo — el flujo actual.
- **Trade-offs / alternativa descartada:** duplicar el patrón de learnex web-tenant sumaría ~20 LOC innecesarias y podría causar doble-persistencia (PATCH ya hecho optimista + PATCH redundante en start). Depende de que el patrón optimista existente sea confiable — lo es, está en prod.

### D10 — Orden de commits (dentro del PR único)

- **Contexto:** el change es front-only, 7 archivos, un solo PR (~200 LOC). El orden de commits determina claridad del diff para review y facilita split si eventualmente se necesita.
- **Decisión:** 6 commits en este orden estricto:
  1. **L1 port**: agregar método `refreshEnabled` a la interface `TutorExamsApi`.
  2. **L3 paths**: agregar helper `virtualExamRefreshEnabled(slug, recordId)` a `api-paths.ts`.
  3. **L3 adapter**: implementar `refreshEnabled` en `HttpTutorExamsApi` (POST, timeout 10s, Zod inline, status→error mapping).
  4. **L2 use case**: crear `RefreshHabilitadosUseCase` + `refresh-habilitados.use-case.spec.ts` (Vitest, 3 escenarios).
  5. **LR view-model**: agregar `gateState`, `showRoster`, `handleRefresh` a `TutorExamDetailViewModel` — sin tocar countdown/D1/optimistic.
  6. **LR template + component**: conditional render con `showRoster`, CTA transformable, wire de `onRefresh()` handler en la page.
- **Trade-offs / alternativa descartada:** cada commit compila y typechecka standalone (L1 → L3 → L2 → LR es orden bottom-up). Si el PR se parte por review (poco probable dado tamaño), el split point limpio es entre commit 4 y 5 (backend-facing vs. UI-facing). Un solo commit gigante fue descartado por dificultar review.

### D11 — Testing strategy: unit L2 + feature LR + hexagonal-guard

- **Contexto:** CLAUDE.md #3 exige `hexagonal-guard` como gate bloqueante antes de archivar. Memoria `feedback_avoid_full_test_suite`: nunca correr suite completa (`npm test` lentea la máquina); usar path acotado.
- **Decisión:**
  - **Unit L2** (obligatorio): `refresh-habilitados.use-case.spec.ts` con 3 escenarios (happy path, `ConflictError` cuando status no es scheduled, `NetworkError`). Vitest puro, sin Angular, sin browser APIs. Mock del port `TutorExamsApi`.
  - **Feature LR** (recomendado, aceptable delegar a smoke manual si el tamaño se dispara): test del gate en `TutorExamDetailPage` con TestBed + jsdom validando (a) Estado A al montar con `status === 'scheduled'`, (b) transición A → refreshing → ready al llamar `handleRefresh` con mock exitoso, (c) permanencia en A con `status === 'in_progress'`, (d) reset a A al remontar el componente. Estimado ~40 LOC.
  - **hexagonal-guard** (bloqueante): correr antes del PR. Chequea que L1/L2 no importen `@angular/*` ni `rxjs`, que el VM no importe L3 directamente, que el use case no tenga lógica de mapping ceremonial.
  - **Ejecución acotada**: `npm test -- refresh-habilitados` (unit) y `npm test -- tutor-exam-detail` (feature). NUNCA `npm test` sin filtro.
- **Trade-offs / alternativa descartada:** el feature test agrega LOC pero da confianza sobre el gate (que es el corazón del change) y sobre la aislación (D7). Descartar feature test y confiar solo en smoke manual es aceptable si aparece fricción con TestBed y el resto del stack ya está unit-cubierto — hexagonal-guard sigue siendo no negociable en cualquier caso.

### D12 — Deploy y coordinación

- **Contexto:** el endpoint backend `POST /virtual-exams/:recordId/refresh-enabled` vive en el PR paralelo de learnex. Sin ese endpoint desplegado, el click en Fiovi da 404. Memoria `feedback_no_env_patches_in_prod`: sin feature flags como plan B.
- **Decisión:**
  - Orden obligatorio: **(1) merge + deploy learnex → (2) merge + deploy Fiovi**.
  - Documentar el orden en el body del PR de Fiovi con warning explícito arriba del todo.
  - Ventana de deploy: fin de semana (bajo tráfico de tutores). Confirmar con el equipo antes de mergear Fiovi.
  - Sin feature flag: si por accidente Fiovi deploya solo, el click en "Actualizar lista" produce toast de error (`NotFoundError` clasificado por status 404) y `gateState` vuelve a `'idle'` — no rompe nada más grave, el tutor puede volver a intentar más tarde o llamar a soporte.
- **Trade-offs / alternativa descartada:** feature flag `REFRESH_ENABLED_GATE=true` en `.env` para prender/apagar el gate en runtime → descartado por memoria explícita (`no_env_patches_in_prod`). El orden coordinado + fallback de error clasificado es suficiente.

---

## Contract References

- Puerto: `src/L1_domain/ports/tutor-exams-api.ts` (agregar 9º método).
- Use case existente análogo: `src/L2_application/use-cases/iniciar-examen.use-case.ts` (28 LOC, patrón a copiar).
- Adapter: `src/L3_periphery/http/http-tutor-exams-api.ts` (agregar método siguiendo patrón de `iniciar`/`finalizar`).
- Paths: `src/L3_periphery/http/api-paths.ts` líneas 64-92 (agregar helper tenant-scoped).
- VM: `src/LR_render/view-models/tutor-exam-detail.view-model.ts` (bloque aparte al final o antes del constructor).
- Page: `src/LR_render/pages/tutor-exam-detail/tutor-exam-detail.page.{ts,html}`.
- Ruta: `/tutor/exams/:recordId` (`src/LR_render/app.routes.ts` líneas 117-121) — NO se toca.

## Open Questions / Assumptions

- Se asume que el response del endpoint learnex es exactamente `{ addedCount: number, totalEnabledCount: number }` (D2). Si el contrato final agrega campos, el Zod inline los ignora sin romper (schema no-strict) — pero confirmar antes del PR.
- Se asume que `reloadDetail()` en el VM refetchea también el roster con los alumnos nuevos incluidos. Si no lo hace, agregar llamada explícita a `listClassroomStudents` en `handleRefresh` post-éxito.
- El feature test LR es recomendado; se acepta smoke manual si TestBed genera fricción con las dependencias del VM (D1 store, Clock port).
