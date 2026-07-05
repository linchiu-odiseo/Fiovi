# Delta for exam-marking

## ADDED Requirements

### Requirement: Pantalla `/simulacro/:id` renderiza `AdmissionAreaPickerComponent`

La pantalla `/simulacro/:id` SHALL renderizar el componente `AdmissionAreaPickerComponent` (definido en la capability `admission-area`) inmediatamente arriba de la grilla de preguntas y debajo del sticky header con nombre del simulacro y timer.

El `simulacro.view-model.ts` SHALL:
- Exponer un `Signal<AdmissionArea>` `admissionArea` inicializado con `DEFAULT_ADMISSION_AREA` (`'GENERAL'`).
- Al montar la página, hidratar el signal con `MarkingsStorage.getAdmissionArea(examId) ?? DEFAULT_ADMISSION_AREA`.
- Exponer un método `seleccionarArea(area: AdmissionArea): Promise<void>` que:
  1. Invoca `SeleccionarAdmissionAreaUseCase.execute({ examId, area })`.
  2. Actualiza el signal `admissionArea` al nuevo valor.
  3. Invoca `DraftAutoSaveDispatcher.notificarCambio(sessionId, exam.count)` (**dos argumentos**, idéntico al hook post-`marcarRespuesta` en `simulacro.view-model.ts:380`) para que el próximo draft persista el cambio al back.
- Bindear el signal al input `admissionArea` del componente y suscribir al output `seleccion` para invocar `seleccionarArea`.

#### Scenario: Signal se hidrata desde storage al montar

- **GIVEN** `MarkingsStorage.getAdmissionArea("X")` retorna `"MAT"`
- **WHEN** la pantalla `/simulacro/X` monta
- **THEN** `admissionArea()` retorna `"MAT"`

#### Scenario: Signal cae al default si storage retorna null

- **GIVEN** `MarkingsStorage.getAdmissionArea("X")` retorna `null`
- **WHEN** la pantalla `/simulacro/X` monta
- **THEN** `admissionArea()` retorna `"GENERAL"`

#### Scenario: `seleccionarArea` persiste, actualiza signal y notifica draft

- **GIVEN** el view-model está montado con `admissionArea()` igual a `"GENERAL"` y `exam.count === 40`
- **AND** `SeleccionarAdmissionAreaUseCase.execute` es un spy que resuelve OK
- **AND** `DraftAutoSaveDispatcher.notificarCambio` es un spy
- **WHEN** el componente emite `seleccion.next("A")` y el view-model invoca `seleccionarArea("A")`
- **THEN** `SeleccionarAdmissionAreaUseCase.execute` fue invocado con `{ examId, area: "A" }`
- **AND** `admissionArea()` ahora retorna `"A"`
- **AND** `DraftAutoSaveDispatcher.notificarCambio` fue invocado con `(sessionId, 40)` — dos argumentos, mismo patrón que el hook post-`marcarRespuesta`

#### Scenario: Picker se renderiza arriba de la grilla

- **WHEN** la pantalla `/simulacro/X` está montada
- **THEN** en el DOM, `AdmissionAreaPickerComponent` aparece antes de la primera `.row` de la grilla de preguntas
- **AND** aparece después del sticky header con nombre del simulacro y timer
