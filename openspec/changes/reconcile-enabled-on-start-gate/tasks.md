# Tasks: reconcile-enabled-on-start-gate

> Change: `reconcile-enabled-on-start-gate` — generado 2026-08-15.
> Rama: `feat/reconcile-enabled-on-start-gate`.
> Todos los commits son secuenciales (bottom-up). No hay paralelismo.
> LOC estimadas totales: ~220 LOC de prod + ~90 LOC de tests = ~310 LOC.

---

## Commit 1 — L1 port: `refreshEnabled` en `TutorExamsApi`

Archivo afectado: `src/L1_domain/ports/tutor-exams-api.ts`
Referencia spec: REQ-API-1 | ADR: D1, D2

- [x] **1.1** Leer el archivo `src/L1_domain/ports/tutor-exams-api.ts` para identificar los 6 métodos existentes y la ubicación de cierre de la interfaz.
  _Estimación: 0 LOC (lectura)._
  _Done when: el dev conoce el patrón de firma de los métodos existentes (ej. `iniciar`, `finalizar`)._

- [x] **1.2** Agregar el 7mo método a la interfaz `TutorExamsApi`:
  ```ts
  /**
   * POST /t/{slug}/virtual-exams/{recordId}/refresh-enabled
   * Errores: 403→TutorExamForbiddenError, 404→VirtualExamNotFoundError,
   *          409→ExamConflictError, 422→ExamPreconditionError, 0/429/5xx→NetworkError
   */
  refreshEnabled(recordId: string): Promise<{ addedCount: number; totalEnabledCount: number }>;
  ```
  _Estimación: ~6 LOC (firma + comentario inline)._
  _Done when: la interfaz tiene exactamente 7 métodos, TypeScript no emite error, `ExamsApi` (alumno) sin tocar._

- [x] **1.3** Verificar que el archivo NO importa `HttpClient`, `Injectable` ni ningún símbolo de `@angular/*` (invariante L1).
  _Estimación: 0 LOC (verificación)._
  _Done when: `grep '@angular' src/L1_domain/ports/tutor-exams-api.ts` no devuelve resultados._

- [x] **1.4** Actualizar `FakeTutorExamsApi` (ubicarla por `grep FakeTutorExamsApi src/`) para implementar el 7mo método con un stub:
  ```ts
  refreshEnabled(_recordId: string): Promise<{ addedCount: number; totalEnabledCount: number }> {
    return Promise.resolve({ addedCount: 0, totalEnabledCount: 0 });
  }
  ```
  _Estimación: ~5 LOC._
  _Done when: TypeScript compila sin error de tipo en la clase fake; la interface tiene exactamente 7 métodos implementados._

---

## Commit 2 — L3 paths: helper `virtualExamRefreshEnabled` en `api-paths.ts`

Archivo afectado: `src/L3_periphery/http/api-paths.ts`
Referencia spec: REQ-API-3 | ADR: D1

- [x] **2.1** Leer `src/L3_periphery/http/api-paths.ts` (líneas 64–92 según design) para identificar el patrón exacto de los helpers existentes (prefijo `apiBaseUrl`, interpolación de slug y parámetros).
  _Estimación: 0 LOC (lectura)._
  _Done when: el dev conoce si los helpers reciben `apiBaseUrl` o lo leen de un closure, y cómo arman la URL._

- [x] **2.2** Agregar el helper `virtualExamRefreshEnabled` siguiendo el patrón existente:
  ```ts
  virtualExamRefreshEnabled(slug: string, recordId: string): string {
    return `${this.apiBaseUrl}/t/${slug}/virtual-exams/${recordId}/refresh-enabled`;
  }
  ```
  _(Adaptar la forma exacta — propiedad de clase, función exportada, etc. — al patrón vigente del archivo.)_
  _Estimación: ~4 LOC._
  _Done when: dado `slug="vonex"`, `recordId="rec-123"`, la función retorna una URL terminada en `/t/vonex/virtual-exams/rec-123/refresh-enabled`; no hay slug hardcoded; ambos parámetros son interpolados._

---

## Commit 3 — L3 adapter: `refreshEnabled` en `HttpTutorExamsApi`

Archivo afectado: `src/L3_periphery/http/http-tutor-exams-api.ts`
Referencia spec: REQ-API-2 | ADR: D2, D8

- [x] **3.1** Leer el método `iniciar()` en `http-tutor-exams-api.ts` para extraer el patrón exacto: cómo se lee el slug del `SlugStore` de forma síncrona, cómo se emite el POST sin body, cómo se aplica el timeout de 10s, cómo se valida con Zod y cómo se mapean errores con `classifyTutorError`.
  _Estimación: 0 LOC (lectura)._
  _Done when: el dev tiene el patrón de `iniciar` como plantilla para `refreshEnabled`._

- [x] **3.2** Implementar el método `refreshEnabled(recordId: string)` copiando el patrón de `iniciar()`, con las siguientes variaciones:
  - URL construida por `apiPaths.virtualExamRefreshEnabled(slug, recordId)`.
  - Body: `null` (POST sin body).
  - Timeout: 10 s (misma constante que los otros métodos).
  - Schema Zod inline para validar el response:
    ```ts
    z.object({
      addedCount: z.number().int().nonnegative(),
      totalEnabledCount: z.number().int().nonnegative(),
    })
    ```
  - Error mapping via `classifyTutorError` (clasificador existente):
    - 403 → `TutorExamForbiddenError`
    - 404 → `VirtualExamNotFoundError`
    - 409 → `ExamConflictError`
    - 422 → `ExamPreconditionError`
    - 0 / 429 / 5xx → `NetworkError`
    - timeout / transporte → `NetworkError`
  - Slug leído del `SlugStore` sin `await` (sincrónico).
  - `withCredentials` NO seteado manualmente (lo agrega el interceptor `credentials.interceptor`).
  _Estimación: ~30 LOC._
  _Done when: el método compila sin error de TypeScript; el clasificador usa status puro, no `body.message` ni `body.code`; NO aparece `withCredentials` en el método._

---

## Commit 4 — L2 use case: `RefreshHabilitadosUseCase` + spec

Archivos nuevos:
- `src/L2_application/use-cases/refresh-habilitados.use-case.ts`
- `src/L2_application/use-cases/refresh-habilitados.use-case.spec.ts`

Referencia spec: REQ-API-4 | ADR: D3, D11

- [x] **4.1** Leer `src/L2_application/use-cases/iniciar-examen.use-case.ts` (~28 LOC) para extraer el patrón de clase pura sin `@Injectable`, constructor con inyección por token, y delegación directa al port.
  _Estimación: 0 LOC (lectura)._
  _Done when: el dev tiene el patrón de `IniciarExamenUseCase` como plantilla._

- [x] **4.2** Crear `refresh-habilitados.use-case.ts` siguiendo el patrón de `IniciarExamenUseCase`:
  - Clase pura sin decorador Angular (`@Injectable` prohibido).
  - Constructor recibe `TutorExamsApi` (token `TUTOR_EXAMS_API`).
  - Método `execute(recordId: string): Promise<{ addedCount: number; totalEnabledCount: number }>`.
  - Delegación completa al port: `return this.api.refreshEnabled(recordId)`.
  - Sin lógica de negocio adicional — sin mappers, sin outbox, sin IndexedDB, sin ACKs.
  - Todos los errores del port propagados sin transformación ni envoltura.
  _Estimación: ~14 LOC._
  _Done when: el archivo es TypeScript puro (sin `@angular/*`, sin `rxjs`, sin browser APIs); `execute` delega directamente al port; errores propagados tal cual._

- [x] **4.3** Registrar factory provider en `app.config.ts`:
  ```ts
  { provide: RefreshHabilitadosUseCase, useFactory: (api: TutorExamsApi) => new RefreshHabilitadosUseCase(api), deps: [TUTOR_EXAMS_API] }
  ```
  _Estimación: ~4 LOC._
  _Done when: `app.config.ts` tiene el factory provider; TypeScript compila._

- [x] **4.4** Crear `refresh-habilitados.use-case.spec.ts` con 3 escenarios usando Vitest puro (sin Angular, sin browser APIs). Mock del port como objeto con función que retorna una Promise controlada:
  - **Escenario 1 — happy path**: mock devuelve `{ addedCount: 3, totalEnabledCount: 12 }` → `execute("rec-1")` resuelve con los mismos valores sin transformación.
  - **Escenario 2 — ConflictError**: mock rechaza con `ExamConflictError` → `execute("rec-1")` rechaza con `ExamConflictError` directamente (no envuelto).
  - **Escenario 3 — NetworkError**: mock rechaza con `NetworkError` → `execute("rec-1")` rechaza con `NetworkError` directamente.
  _Estimación: ~45 LOC._
  _Done when: `npm test -- refresh-habilitados` pasa los 3 escenarios en verde; el spec no importa ningún símbolo de Angular ni `rxjs`._

---

## Commit 5 — LR view-model: `gateState`, `showRoster`, `handleRefresh`

Archivo afectado: `src/LR_render/view-models/tutor-exam-detail.view-model.ts`
Referencia spec: REQ-VM-1, REQ-VM-2, REQ-VM-3, REQ-VM-4, REQ-VM-5 + Copy de errores | ADR: D4, D5, D7, D8

- [ ] **5.1** Leer `tutor-exam-detail.view-model.ts` completo para identificar: (a) la ubicación final segura para agregar el bloque sin interferir con countdown/D1/optimistic; (b) el nombre exacto del mecanismo `reloadDetail()` (verificar que existe con ese nombre, o mapear al mecanismo equivalente de refetch); (c) la forma de `actionError` (signal, setter, tipo); (d) el `RefreshHabilitadosUseCase` inyectado (verificar que hay un punto de inyección compatible).
  _Estimación: 0 LOC (lectura)._
  _Done when: el dev conoce la ubicación de inserción, el nombre exacto de reloadDetail/equivalente, la forma de actionError, y cómo inyectar el nuevo use case._

- [ ] **5.2** Agregar `RefreshHabilitadosUseCase` a la inyección del VM (constructor o inject-based, según el patrón existente del archivo).
  _Estimación: ~3 LOC._
  _Done when: el VM compila con la nueva dependencia._

- [ ] **5.3** Agregar el bloque de gate aislado con comentario de sección visible (antes del constructor o al final del cuerpo de la clase, en la ubicación que no interfiera con el resto). El bloque contiene exclusivamente:

  ```
  // ─── Gate de reconciliación de habilitados (reconcile-enabled-on-start-gate) ─────
  ```

  **Signal privado** `_gateState: WritableSignal<'idle' | 'refreshing' | 'ready'>` inicializado en `'idle'`.

  **Signal público readonly** `readonly gateState: Signal<'idle' | 'refreshing' | 'ready'> = this._gateState.asReadonly()`.

  **Regla dura:** `_gateState` no se lee desde ningún computed o effect existente. `gateState` no entra en countdown, D1 resolution ni optimistic paths.
  _Estimación: ~8 LOC._
  _Done when: `vm.gateState()` es `'idle'` al inicializar; TypeScript acepta el tipo; `_gateState` no es accesible públicamente (privado)._

- [ ] **5.4** Agregar el computed `showRoster` en el mismo bloque aislado:
  ```ts
  readonly showRoster = computed(() => {
    const d = this.detail();
    if (!d) return false;
    return d.status.value !== 'scheduled' || this._gateState() === 'ready';
  });
  ```
  _Estimación: ~7 LOC._
  _Done when: los 6 scenarios de REQ-VM-2 son satisfechos; el computed no toca ningún computed existente._

- [ ] **5.5** Agregar el método `handleRefresh()` en el mismo bloque aislado:
  - Setea `_gateState` a `'refreshing'`.
  - Llama `this.refreshHabilitadosUseCase.execute(recordId)` (donde `recordId` se extrae de `this.detail()?.recordId` o la fuente equivalente en el VM).
  - En éxito: setea `_gateState` a `'ready'`; llama `reloadDetail()` (o el mecanismo equivalente identificado en 5.1); limpia `actionError` a `null`.
  - En `ExamConflictError`: setea `_gateState` a `'idle'`; setea `actionError` con: `"El examen ya fue iniciado. Recargá la página para ver el estado actual."`.
  - En `NetworkError`: setea `_gateState` a `'idle'`; setea `actionError` con: `"Sin conexión. Verificá tu red y volvé a intentar."`.
  - En `VirtualExamNotFoundError`: setea `_gateState` a `'idle'`; setea `actionError` con: `"No se encontró el examen. Volvé a la lista."`.
  - En `TutorExamForbiddenError`: setea `_gateState` a `'idle'`; setea `actionError` con: `"No tenés permiso para actualizar la lista de este examen."`.
  - En `ExamPreconditionError`: setea `_gateState` a `'idle'`; setea `actionError` con: `"Hay un problema con los datos del examen. Volvé a la lista."`.
  - Clasificación via `instanceof` — prohibido comparar `body.message` o `body.code`.
  _Estimación: ~30 LOC._
  _Done when: los 3 scenarios de REQ-VM-3 son satisfechos; error mapping usa `instanceof`; no hay lógica tocando countdown, D1 ni optimistic updates._

- [ ] **5.6** Verificar que los tests existentes del VM/page siguen en verde sin modificar sus fuentes:
  `npm test -- tutor-exam-detail`
  _Estimación: 0 LOC._
  _Done when: todos los tests preexistentes pasan; no se modificó ningún `.spec.ts` existente._

---

## Commit 6 — LR template + component: conditional render, CTA transformable, `onRefresh`

Archivos afectados:
- `src/LR_render/pages/tutor-exam-detail/tutor-exam-detail.page.html`
- `src/LR_render/pages/tutor-exam-detail/tutor-exam-detail.page.ts`

Referencia spec: REQ-PAGE-1, REQ-PAGE-2, REQ-PAGE-3 | ADR: D6, D9

> **Aviso de remoción (obligatorio leer antes de implementar):** el botón "Iniciar actividad" que hoy vive DENTRO del bloque del roster (y que abría el modal directamente sin gate) se REMUEVE en este commit. Su función queda absorbida por el CTA transformable cuando `gateState === 'ready'`. Tener dos CTAs en paralelo generaría conflicto de UX. Identificar el elemento antes de hacer el diff y eliminarlo explícitamente.

- [ ] **6.1** Leer `tutor-exam-detail.page.html` completo para identificar: (a) el bloque exacto del roster y los botones "Finalizar"/"Archivar" que se envuelven en `@if (vm.showRoster())`; (b) el botón viejo "Iniciar actividad" (o "Iniciar examen") que vive DENTRO del bloque del roster y que se remueve; (c) dónde insertar el card de gate y el CTA transformable fuera del `@if`.
  _Estimación: 0 LOC (lectura)._
  _Done when: el dev tiene marcado en papel/mente los 3 puntos de cambio del template._

- [ ] **6.2** Envolver en `@if (vm.showRoster())` el bloque completo que contiene:
  - La lista/roster de alumnos.
  - El botón "Finalizar".
  - El botón "Archivar" (si existe en el template).
  _No envolver el CTA transformable — ese vive fuera._
  _Estimación: ~4 LOC (agregar `@if` de apertura y cierre)._
  _Done when: cuando `vm.showRoster()` es `false`, el roster y los botones finalizar/archivar desaparecen del DOM._

- [ ] **6.3** **REMOVER** el botón "Iniciar actividad" (o label equivalente) que actualmente vive DENTRO del bloque del roster. Este botón abría el modal de duración/modo directamente. Su función es absorbida por el CTA transformable.
  _Estimación: ~-6 LOC (remoción)._
  _Done when: no existe en el template ningún botón duplicado dentro del `@if (vm.showRoster())` cuya función sea iniciar el examen; solo queda el CTA transformable fuera del bloque._

- [ ] **6.4** Agregar fuera del `@if (vm.showRoster())` el card de gate con el CTA transformable. El card es visible solo cuando `!vm.showRoster()` (Estado A / refreshing). Estructurarlo con `@switch (vm.gateState())` o ternario equivalente para derivar label y handler:

  ```html
  @if (!vm.showRoster()) {
    <div class="gate-card">
      <h3>Actualizar lista antes de iniciar</h3>
      @switch (vm.gateState()) {
        @case ('idle') {
          <button (click)="onRefresh()">Actualizar lista</button>
        }
        @case ('refreshing') {
          <button disabled>Actualizando...</button>
        }
        @case ('ready') {
          <!-- Este case no debería renderizarse porque showRoster sería true,
               pero se incluye como safety net por si el computed tiene lag. -->
          <button (click)="vm.openIniciarModal()">Iniciar examen</button>
        }
      }
    </div>
  }
  ```

  _(El markup y clases CSS exactas se alinean con el sistema de diseño existente del proyecto; el esqueleto de arriba es la estructura lógica, no la final.)_
  _Estimación: ~20 LOC._
  _Done when: en Estado A el botón muestra "Actualizar lista" habilitado; en refreshing muestra "Actualizando..." disabled; en Estado B (`showRoster` true) el card desaparece y el roster aparece._

- [ ] **6.5** Agregar el método `onRefresh(): void` en `tutor-exam-detail.page.ts`:
  ```ts
  onRefresh(): void {
    this.vm.handleRefresh();
  }
  ```
  _Estimación: ~4 LOC._
  _Done when: el click en el botón "Actualizar lista" del template invoca `onRefresh()` que delega a `vm.handleRefresh()`._

- [ ] **6.6** Verificar que no existe en el template ningún `@if` adicional sobre `showRoster` en secciones distintas a las del paso 6.2 (el computed es single-source-of-truth; el template no debe duplicar la lógica).
  _Estimación: 0 LOC (verificación)._
  _Done when: `grep "showRoster" tutor-exam-detail.page.html` muestra solo las ocurrencias legítimas del paso 6.2 y 6.4._

- [ ] **6.7** Verificar regresión de `in_progress` y `finalized` en el template: navegar a cada status en local y confirmar que el roster aparece sin card de gate, que los botones de acción siguen presentes, y que el template compila sin warnings de Angular.
  _Estimación: 0 LOC (verificación manual)._
  _Done when: los scenarios de REQ-PAGE-3 son satisfechos visualmente._

---

## Verificación pre-PR

### Tests automatizados

- [ ] `npm run lint` limpio — sin errores ESLint en los 7 archivos modificados/creados.
- [ ] `npm test -- refresh-habilitados` verde — los 3 escenarios del use case pasan.
- [ ] `npm test -- tutor-exam-detail` verde — los tests existentes siguen en verde sin modificar sus fuentes.
- [ ] Correr subagente `hexagonal-guard` sobre `src/` — **BLOQUEANTE, sin violaciones duras antes de abrir el PR.** Verificar en particular:
  - `L1_domain/ports/tutor-exams-api.ts` no importa `@angular/*`.
  - `L2_application/use-cases/refresh-habilitados.use-case.ts` no importa `@angular/*` ni `rxjs`.
  - `LR_render/view-models/tutor-exam-detail.view-model.ts` no importa directamente de `L3_periphery`.
  - El use case no tiene lógica de mapping ceremonial ni anémica.
- [ ] `npm run build` compila sin errores — bundle de producción limpio.

### Dev smoke — flujo principal (Estado A → B → iniciar)

- [ ] Login como tutor (`tutor1@vonex.pe` / `tutor123`).
- [ ] Navegar a `/tutor/exams/:recordId` con un examen en status `scheduled`.
- [ ] Verificar **Estado A**: se muestra el card "Actualizar lista antes de iniciar"; NO se ve el roster de alumnos; NO se ven los botones "Finalizar"/"Archivar"; el botón muestra "Actualizar lista" habilitado.
- [ ] Click en "Actualizar lista" → verificar que el botón cambia a "Actualizando..." y queda disabled mientras la request está en vuelo.
- [ ] Verificar **Estado B** (tras respuesta exitosa del backend): el card desaparece; el roster aparece con la lista actualizada de alumnos; el CTA visible es "Iniciar examen".
- [ ] Click en "Iniciar examen" → verificar que abre el modal existente de duración/modo sin cambios en el modal.

### Dev smoke — regresión `in_progress`

- [ ] Navegar a un examen con `status === 'in_progress'`.
- [ ] Verificar que el roster y los botones "Finalizar" aparecen directo, sin gate ni card "Actualizar lista".
- [ ] Verificar que el countdown sigue tickando.
- [ ] Verificar que el toggle de un checkbox dispara el PATCH optimista y hace rollback si el server rechaza.

### Dev smoke — regresión `finalized`

- [ ] Navegar a un examen con `status === 'finalized'`.
- [ ] Verificar que el roster en modo read-only y el botón "Archivar" aparecen directo, sin gate.
- [ ] Verificar que los checkboxes están disabled (read-only).

### Dev smoke — reset del gate

- [ ] Desde **Estado B** (gate superado, `gateState === 'ready'`), navegar a `/tutor/home` y volver a `/tutor/exams/:recordId`.
- [ ] Verificar que vuelve a **Estado A** siempre (nueva instancia del VM, `gateState` es `'idle'`).
- [ ] Verificar que NO persiste el estado `ready` entre navegaciones.

### Coordinación de deploy (D12 — obligatorio antes de mergear)

- [ ] Confirmar con el equipo que el PR de learnex `feat/reconcile-enabled-on-start-gate` está mergeado y deployado a producción antes de mergear este PR.
- [ ] **Orden obligatorio: (1) merge + deploy learnex → (2) merge + deploy Fiovi.** Este aviso debe quedar en el body del PR de Fiovi arriba del todo.
- [ ] Ventana de deploy: fin de semana (bajo tráfico de tutores).
