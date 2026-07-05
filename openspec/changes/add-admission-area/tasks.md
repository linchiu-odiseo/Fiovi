## 1. L1 dominio — VO, error, port extension

- [ ] 1.1 Crear `src/L1_domain/value-objects/admission-area.ts` con union type `AdmissionArea`, constante `ADMISSION_AREAS` (16 valores en orden de picker), `DEFAULT_ADMISSION_AREA = 'GENERAL'`, y guard `isAdmissionArea`. Comentario inline referenciando D1 (distinción con `Exam.area`).
- [ ] 1.2 Crear `src/L1_domain/errors/invalid-admission-area.error.ts` con clase `InvalidAdmissionAreaError extends Error` y `name` correcto.
- [ ] 1.3 Extender `EnvioRequest` y `DraftRequest` en `src/L1_domain/ports/exams-api.ts` con campo `admissionArea: AdmissionArea`. Actualizar el bloque de comentarios del port para: (a) documentar el nuevo campo en ambos requests; (b) mapear `400 INVALID_ADMISSION_AREA → InvalidAdmissionAreaError` para ambos endpoints; (c) aclarar la distinción con `Exam.area` (curso).
- [ ] 1.4 Extender el puerto `MarkingsStorage` en `src/L1_domain/ports/markings-storage.ts` con `getAdmissionArea(examId): Promise<AdmissionArea | null>` y `setAdmissionArea(examId, area): Promise<void>`. Actualizar el JSDoc del método existente `clearMarcaciones` para reflejar que también borra `admissionArea`.

## 2. Tests L1 (Vitest puro)

- [ ] 2.1 `tests/unit/L1_domain/value-objects/admission-area.spec.ts`: guard acepta los 16 válidos; rechaza `"VI"`, `"a"`, `"general"`, `""`, `null`, `undefined`, `42`; `ADMISSION_AREAS.length === 16`; orden exacto de la constante; `DEFAULT_ADMISSION_AREA === 'GENERAL'`.
- [ ] 2.2 `tests/unit/L1_domain/errors/invalid-admission-area.error.spec.ts`: instancia expone `name` correcto e `instanceof Error`.

## 3. L2 use case + integración con Enviar/Guardar

- [ ] 3.1 Crear `src/L2_application/use-cases/seleccionar-admission-area.use-case.ts`. Inyecta `MarkingsStorage`. `execute({ examId, area })` valida con `isAdmissionArea`; si falla, lanza `InvalidAdmissionAreaError` sin tocar storage. OK → `setAdmissionArea(examId, area)`.
- [ ] 3.2 Modificar `src/L2_application/use-cases/enviar-simulacro.use-case.ts` para leer `admissionArea` con fallback `DEFAULT_ADMISSION_AREA` y propagar al `EnvioRequest`. NO persistir el default.
- [ ] 3.3 Modificar `src/L2_application/use-cases/guardar-draft.use-case.ts` para leer `admissionArea` con fallback `DEFAULT_ADMISSION_AREA` y propagar al `DraftRequest`. NO persistir el default.

## 4. Tests L2 (Vitest puro)

- [ ] 4.1 `tests/unit/L2_application/seleccionar-admission-area.use-case.spec.ts`: área válida se persiste; área inválida lanza `InvalidAdmissionAreaError` y NO invoca storage.
- [ ] 4.2 Extender `tests/unit/L2_application/enviar-simulacro.use-case.spec.ts`: `admissionArea` persistida se propaga al port; ausencia cae al default `GENERAL`; storage nunca es escrito por el use case.
- [ ] 4.3 Extender `tests/unit/L2_application/guardar-draft.use-case.spec.ts`: idem para draft.

## 5. L3 storage adapter

- [ ] 5.1 Extender `src/L3_periphery/storage/indexed-db-markings-storage.ts` con `getAdmissionArea` / `setAdmissionArea` sobre el mismo `objectStore` que las marcaciones. `clearMarcaciones` limpia también el área.

## 6. Tests L3 storage (Vitest + jsdom + fake-indexeddb)

- [ ] 6.1 Extender `tests/feature/L3_periphery/indexed-db-markings-storage.spec.ts`: `getAdmissionArea` retorna `null` sin persistencia previa; `setAdmissionArea` seguido de `getAdmissionArea` retorna el valor; idempotencia (última gana); `clearMarcaciones` borra también el área.

## 7. L3 HTTP adapter — body + classifier

- [ ] 7.1 Modificar `src/L3_periphery/http/http-exams-api.ts`:
  - `enviar`: body en orden `{ code, admission_area, responses, client_finished_at }`.
  - `guardarDraft`: body en orden `{ code, admission_area, responses }`.
  - Agregar `'INVALID_ADMISSION_AREA'` a `SUBMIT_ERROR_MESSAGES` y `DRAFT_ERROR_MESSAGES`.
  - `classifySubmitError` y `classifyDraftError`: `400` con `body.message === 'INVALID_ADMISSION_AREA'` → `InvalidAdmissionAreaError`; otros 400 → `InvalidPayloadError` (default existente).
  - Comentarios inline actualizados con la lista de valores del enum y referencia a "Excepción documentada" en http-client spec.

## 8. Tests L3 HTTP (Vitest + jsdom + HttpTestingController)

- [ ] 8.1 Extender `tests/feature/L3_periphery/http-exams-api.spec.ts`:
  - Body match exacto (orden JSON) para submit con `admissionArea`.
  - Body match exacto para draft con `admissionArea`.
  - `400 INVALID_ADMISSION_AREA` en submit → `InvalidAdmissionAreaError`.
  - `400 INVALID_ADMISSION_AREA` en draft → `InvalidAdmissionAreaError`.
  - `400` con `body.message` fuera del enum → `InvalidPayloadError` (regresión).

## 9. LR — componente picker

- [ ] 9.1 Crear `src/LR_render/components/admission-area-picker/admission-area-picker.component.ts` y `.html` y `.scss`.
  - Input `admissionArea: AdmissionArea`.
  - Output `seleccion: EventEmitter<AdmissionArea>`.
  - Estados colapsado (default) y expandido, mutuamente excluyentes, gestionados con un signal interno.
  - Colapsado: fila con label "Área:", pill primary con el valor actual, hint "Mantén presionado para cambiar".
  - Expandido: grid 3×6, chip con `admissionArea` actual con clase `--selected`, chip `GENERAL` con `grid-column: span 3`, chip flotante "Toca para cambiar" con el mismo look que `.row__chip`.
  - Long-press ≥500ms sobre el pill → expande. **Duplicar** el patrón del `simulacro.page.ts:12-123` (constante `LONG_PRESS_DURATION_MS = 500` local + tolerancia 10px + cancel on move + cleanup en `pointerup`/`pointercancel`). Comentario inline `// MANTENER SINCRONIZADO CON simulacro.page.ts:12 — futura extracción a LongPressDirective queda como refactor separado`.
  - Tap sobre chip del grid → emite `seleccion` con el valor y colapsa.
- [ ] 9.2 Usar tokens de `design-tokens` para colores y radios; nada hardcoded.

## 10. Tests LR componente (Vitest + jsdom + TestBed)

- [ ] 10.1 `tests/feature/LR_render/components/admission-area-picker.component.spec.ts`:
  - Estado colapsado renderiza pill con `admissionArea` actual; grid 3×6 NO está en el DOM.
  - Long-press 500ms sobre pill sin movimiento → expande; grid está en el DOM; chip actual tiene `--selected`; chip "Toca para cambiar" visible.
  - Movimiento >10px durante long-press cancela; sigue colapsado.
  - Tap sobre chip del grid emite `seleccion` con el valor correcto; después el componente colapsa.
  - Chip `GENERAL` renderiza con `grid-column: span 3`.

## 11. LR — view-model wiring en `/simulacro/:id`

- [ ] 11.1 Modificar `src/LR_render/view-models/simulacro.view-model.ts`:
  - Inyectar `SeleccionarAdmissionAreaUseCase`. `MarkingsStorage` ya está inyectado vía `MARKINGS_STORAGE` token (ver imports actuales en el archivo).
  - Signal `admissionArea: Signal<AdmissionArea>` con `DEFAULT_ADMISSION_AREA` inicial.
  - En el hook de mount, hidratar con `markingsStorage.getAdmissionArea(examId) ?? DEFAULT_ADMISSION_AREA`.
  - Método `seleccionarArea(area: AdmissionArea)`: invoca use case, actualiza signal, llama `this.draftDispatcher.notificarCambio(this.sessionId, exam.count)` — **dos args**, mismo patrón que `marcarRespuesta` en la línea 380 del archivo actual.
- [ ] 11.2 Modificar `src/LR_render/pages/simulacro/simulacro.page.html` (o `.ts` si es standalone inline): renderizar `<lugia-admission-area-picker>` arriba de la grilla, debajo del sticky header. Bind `[admissionArea]` al signal y `(seleccion)` a `seleccionarArea`.

## 12. Tests LR view-model (Vitest + jsdom + TestBed)

- [ ] 12.1 Extender `tests/feature/LR_render/view-models/simulacro.view-model.spec.ts`:
  - Signal se hidrata desde storage al mount.
  - Signal cae al default si storage retorna `null`.
  - `seleccionarArea` invoca use case con `{ examId, area }`.
  - `seleccionarArea` actualiza signal.
  - `seleccionarArea` llama `draftDispatcher.notificarCambio(sessionId, exam.count)` — verificar los **dos** args.

## 13. Wiring DI

- [ ] 13.1 Registrar factory del `SeleccionarAdmissionAreaUseCase` en `src/app.config.ts` con `MarkingsStorage` inyectado.

## 14. Auditoría y cierre

- [ ] 14.1 Correr `npm run lint` y `npm test` — todo verde.
- [ ] 14.2 Correr el sub-agente `hexagonal-guard` sobre `src/`. Sin violaciones duras (VO puro sin dependencias; use case puro; componente picker no importa L3; view-model no importa L3 salvo puertos L1 vía DI).
- [ ] 14.3 Grep de literales `"vonex"` en `src/` — cero (regla CLAUDE.md #6).
- [ ] 14.4 Verificar que ningún test u código matchea string de error HTTP por texto del `message` — sólo por igualdad estricta contra el enum (regla CLAUDE.md #3).
- [ ] 14.5 Actualizar CLAUDE.md sección "Estado actual" agregando el archivo del change tras archive.

## 15. Delivery (commits sugeridos, ≤8 archivos c/u)

- [ ] 15.1 `feat(L1): AdmissionArea VO + InvalidAdmissionAreaError + port extension` — 1.1, 1.2, 1.3, 1.4 (~4 archivos).
- [ ] 15.2 `test(L1): AdmissionArea VO + error` — 2.1, 2.2 (~2 archivos).
- [ ] 15.3 `feat(L2): SeleccionarAdmissionAreaUseCase + integración enviar/guardar` — 3.1, 3.2, 3.3 (~3 archivos).
- [ ] 15.4 `test(L2): use cases con admissionArea` — 4.1, 4.2, 4.3 (~3 archivos).
- [ ] 15.5 `feat(L3): IDB storage + HttpExamsApi body + classifier` — 5.1, 7.1 (~2 archivos).
- [ ] 15.6 `test(L3): storage + adapter body + classifier` — 6.1, 8.1 (~2 archivos).
- [ ] 15.7 `feat(LR): AdmissionAreaPickerComponent + tests` — 9.1, 9.2, 10.1 (~4 archivos).
- [ ] 15.8 `feat(LR): simulacro.view-model wiring del picker + tests` — 11.1, 11.2, 12.1, 13.1 (~4 archivos).

Budget total estimado: ~10–12 archivos de código + ~8 archivos de test. Si el budget de 400 líneas total explota, split en 2 PRs: (a) 15.1–15.6 (backend wire); (b) 15.7–15.8 (UI + wiring).
