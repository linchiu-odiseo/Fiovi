## 1. L1 dominio - VO, error, port extension

- [x] 1.1 Crear src/L1_domain/value-objects/admission-area.ts con union type AdmissionArea, constante ADMISSION_AREAS (16 valores en orden de picker), DEFAULT_ADMISSION_AREA = GENERAL, y guard isAdmissionArea. Comentario inline referenciando D1 (distincion con Exam.area).
- [x] 1.2 Crear src/L1_domain/errors/invalid-admission-area.error.ts con clase InvalidAdmissionAreaError extends Error y name correcto.
- [x] 1.3 Extender EnvioRequest y DraftRequest en src/L1_domain/ports/exams-api.ts con campo admissionArea: AdmissionArea. Actualizar el bloque de comentarios del port para: (a) documentar el nuevo campo en ambos requests; (b) mapear 400 INVALID_ADMISSION_AREA a InvalidAdmissionAreaError para ambos endpoints; (c) aclarar la distincion con Exam.area (curso).
- [x] 1.4 Extender el puerto MarkingsStorage en src/L1_domain/ports/markings-storage.ts con getAdmissionArea(examId): Promise y setAdmissionArea(examId, area): Promise. Actualizar el JSDoc del metodo existente clearMarcaciones para reflejar que tambien borra admissionArea.

## 2. Tests L1 (Vitest puro)

- [x] 2.1 tests/unit/L1_domain/value-objects/admission-area.spec.ts: guard acepta los 16 validos; rechaza VI, a, general, empty, null, undefined, 42; ADMISSION_AREAS.length === 16; orden exacto de la constante; DEFAULT_ADMISSION_AREA === GENERAL.
- [x] 2.2 tests/unit/L1_domain/errors/invalid-admission-area.error.spec.ts: instancia expone name correcto e instanceof Error. (Cubierto en tests/unit/L1_domain/errors/errors.spec.ts - bloque InvalidAdmissionAreaError dentro del file consolidado de errores de dominio.)

## 3. L2 use case + integracion con Enviar/Guardar

- [x] 3.1 Crear src/L2_application/use-cases/seleccionar-admission-area.use-case.ts. Inyecta MarkingsStorage. execute({ examId, area }) valida con isAdmissionArea; si falla, lanza InvalidAdmissionAreaError sin tocar storage. OK -> setAdmissionArea(examId, area).
- [x] 3.2 Modificar src/L2_application/use-cases/enviar-simulacro.use-case.ts para leer admissionArea con fallback DEFAULT_ADMISSION_AREA y propagar al EnvioRequest. NO persistir el default.
- [x] 3.3 Modificar src/L2_application/use-cases/guardar-draft.use-case.ts para leer admissionArea con fallback DEFAULT_ADMISSION_AREA y propagar al DraftRequest. NO persistir el default.

## 4. Tests L2 (Vitest puro)

- [x] 4.1 tests/unit/L2_application/seleccionar-admission-area.use-case.spec.ts: area valida se persiste; area invalida lanza InvalidAdmissionAreaError y NO invoca storage.
- [x] 4.2 Extender tests/unit/L2_application/enviar-simulacro.use-case.spec.ts: admissionArea persistida se propaga al port; ausencia cae al default GENERAL; storage nunca es escrito por el use case.
- [x] 4.3 Extender tests/unit/L2_application/guardar-draft.use-case.spec.ts: idem para draft.

## 5. L3 storage adapter

- [x] 5.1 Extender src/L3_periphery/storage/indexed-db-markings-storage.ts con getAdmissionArea / setAdmissionArea sobre el mismo objectStore que las marcaciones. clearMarcaciones limpia tambien el area.

## 6. Tests L3 storage (Vitest + jsdom + fake-indexeddb)

- [x] 6.1 Extender tests/feature/L3_periphery/storage/markings-storage.spec.ts: getAdmissionArea retorna null sin persistencia previa; setAdmissionArea seguido de getAdmissionArea retorna el valor; idempotencia (ultima gana); clearMarcaciones borra tambien el area.

## 7. L3 HTTP adapter - body + classifier

- [x] 7.1 Modificar src/L3_periphery/http/http-exams-api.ts: enviar body en orden { code, admission_area, responses, client_finished_at }; guardarDraft body en orden { code, admission_area, responses }; agregar INVALID_ADMISSION_AREA a SUBMIT_ERROR_MESSAGES y DRAFT_ERROR_MESSAGES; classifySubmitError y classifyDraftError; comentarios inline actualizados.

## 8. Tests L3 HTTP (Vitest + jsdom + HttpTestingController)

- [x] 8.1 Extender tests/feature/L3_periphery/http/http-exams-api-enviar.spec.ts y http-exams-api-draft.spec.ts: body match exacto (orden JSON) para submit y draft con admissionArea; 400 INVALID_ADMISSION_AREA en submit y draft a InvalidAdmissionAreaError; 400 con body.message fuera del enum a InvalidPayloadError (regresion).

## 9. LR - componente picker

- [x] 9.1 Crear src/LR_render/components/admission-area-picker/admission-area-picker.component.ts y .html y .scss. Input admissionArea. Output seleccion. Estados colapsado y expandido. Long-press 500ms. Comentario inline sincronizacion con simulacro.page.ts.
- [x] 9.2 Usar tokens de design-tokens para colores y radios; nada hardcoded.

## 10. Tests LR componente (Vitest + jsdom + TestBed)

- [x] 10.1 tests/feature/LR_render/components/admission-area-picker.component.spec.ts: todos los scenarios del spec cubiertos.

## 11. LR - view-model wiring en /simulacro/:id

- [x] 11.1 Modificar src/LR_render/view-models/simulacro.view-model.ts: inyectar SeleccionarAdmissionAreaUseCase; signal admissionArea; hidratar en mount; metodo seleccionarArea con dos args a notificarCambio.
- [x] 11.2 Modificar src/LR_render/pages/simulacro/simulacro.page.html: renderizar app-admission-area-picker arriba de la grilla, debajo del sticky header.

## 12. Tests LR view-model (Vitest + jsdom + TestBed)

- [x] 12.1 Extender tests/feature/LR_render/view-models/simulacro.view-model.spec.ts: todos los scenarios del spec cubiertos.

## 13. Wiring DI

- [x] 13.1 Registrar factory del SeleccionarAdmissionAreaUseCase en src/app.config.ts con MarkingsStorage inyectado.

## 14. Auditoria y cierre

- [x] 14.1 Correr npm run lint y npm test - 984/984 tests pasan. Lint tiene 8 errores preexistentes en archivos no relacionados con este change (tutor-exam-detail.view-model.spec.ts y fakes.ts del tutor API, introducidos por PR anterior).
- [x] 14.2 Correr el sub-agente hexagonal-guard sobre src/. Sin violaciones duras para el codigo de este change. La importacion directa de DraftAutoSaveDispatcher de L3 en simulacro.view-model.ts es preexistente del change draft-auto-save.
- [x] 14.3 Grep de literales vonex en src/ - cero en codigo no-generado. Los dos hits estan en src/environments/ generado por build-env.mjs desde .env.
- [x] 14.4 Verificar clasificacion de errores HTTP - sola por igualdad estricta contra enum. Confirmado: Set.has() y === en todos los clasificadores.
- [x] 14.5 Actualizar CLAUDE.md seccion Estado actual agregando el archivo del change tras archive. (Completado en sdd-archive)

## 15. Delivery (commits aplicados)

- [x] 15.1 feat(L1): AdmissionArea VO + InvalidAdmissionAreaError + port extension
- [x] 15.2 test(L1): AdmissionArea VO + error
- [x] 15.3 feat(L2): SeleccionarAdmissionAreaUseCase + integracion enviar/guardar
- [x] 15.4 test(L2): use cases con admissionArea
- [x] 15.5 feat(L3): IDB storage + HttpExamsApi body + classifier
- [x] 15.6 test(L3): storage + adapter body + classifier
- [x] 15.7 feat(LR): AdmissionAreaPickerComponent + tests
- [x] 15.8 feat(LR): simulacro.view-model wiring del picker + tests
