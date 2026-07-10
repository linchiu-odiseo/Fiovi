# exam-marking Specification

## Purpose
Allows students to mark answers (A–E) for exam questions in a grid, with accidental-change protection and local persistence.

## Requirements

### Requirement: Pantalla de marcación de un simulacro abierto

La UI (LR_render) SHALL exponer una página `/simulacro/:id` que muestra una grilla de `count` preguntas, cada una con bubbles seleccionables A, B, C, D, E. La página solo es accesible si el simulacro está `abierto`. NO muestra enunciados (el alumno los tiene en papel).

#### Scenario: Acceso a simulacro abierto

- **WHEN** el alumno navega a `/simulacro/:id` y el simulacro está `abierto`
- **THEN** se muestra la grilla con `count` filas, una por pregunta
- **AND** cada fila ofrece cinco bubbles A–E

#### Scenario: Bloqueo de acceso a simulacro pendiente

- **WHEN** el alumno navega a `/simulacro/:id` y el simulacro está `pendiente`
- **THEN** la PWA redirige a `/home`
- **AND** muestra un mensaje "El simulacro aún no está disponible"

#### Scenario: Bloqueo de acceso a simulacro cerrado

- **WHEN** el alumno navega a `/simulacro/:id` y el simulacro está `cerrado`
- **THEN** la PWA redirige a `/home`
- **AND** muestra un mensaje "Este simulacro ya cerró"

#### Scenario: Bloqueo de acceso a simulacro enviado

- **WHEN** el alumno navega a `/simulacro/:id` y el simulacro está `enviado`
- **THEN** la PWA redirige a `/home`
- **AND** muestra un mensaje "Ya enviaste este simulacro"

### Requirement: Marcar una respuesta persiste localmente al instante

El sistema SHALL exponer `MarcarRespuestaUseCase` (L2) que recibe `(simulacroId, preguntaNumero, alternativa)` y persiste la marca vía el puerto `MarkingsStorage` (L1). La operación NO requiere conexión a internet.

#### Scenario: Marca de una alternativa válida

- **WHEN** el alumno toca la alternativa C de la pregunta 5 del simulacro X
- **THEN** `MarcarRespuestaUseCase.execute({ simulacroId: X, pregunta: 5, alternativa: "C" })` se invoca
- **AND** la marca queda persistida en `MarkingsStorage` antes de devolver control a la UI
- **AND** la UI refleja la selección visualmente sin esperar respuesta de red

#### Scenario: Cambio de marca en la misma pregunta (requiere modo edición)

- **WHEN** el alumno tenía marcada C en la pregunta 5, la fila está `locked`, mantiene presionada la fila ≥500ms para entrar a modo `editing`, y luego toca A
- **THEN** la marca persistida cambia a A
- **AND** la UI refleja A como seleccionada y C como deseleccionada
- **AND** la fila vuelve automáticamente a estado `locked`

#### Scenario: Desmarcar (requiere modo edición)

- **WHEN** el alumno tiene C marcada en la pregunta 5, la fila está `locked`, mantiene presionada la fila ≥500ms para entrar a modo `editing`, y luego toca C de nuevo
- **THEN** la pregunta 5 queda sin marca (valor `null`)
- **AND** la UI refleja todas las bubbles deseleccionadas
- **AND** la fila vuelve a estado `unmarked`

#### Scenario: Alternativa inválida rechazada

- **WHEN** se invoca `MarcarRespuestaUseCase` con una alternativa fuera de A–E
- **THEN** el use case lanza `InvalidAlternativaError`
- **AND** nada se persiste

### Requirement: Protección contra cambios accidentales una vez marcada una respuesta

La UI SHALL proteger respuestas ya marcadas contra cambios o borrados accidentales por toques no intencionales. El primer marcado de una pregunta vacía es de un solo tap (fricción cero); cualquier modificación posterior requiere un gesto deliberado (long-press de 500ms en la fila) que entra a modo `editing` por 5 segundos, durante los cuales un tap simple aplica el cambio o el borrado.

#### Scenario: Tap simple en burbuja de fila bloqueada no cambia la marca

- **WHEN** la pregunta 5 está marcada en A (fila `locked`) y el alumno toca B
- **THEN** la marca persistida y la UI permanecen sin cambio (sigue A)
- **AND** la UI NO muestra ningún toast, banner ni hint inline — el feedback de "no se cambió nada" es la propia ausencia de cambio visual

#### Scenario: Long-press en fila bloqueada entra a modo edición con chip permanente

- **WHEN** el alumno mantiene presionada cualquier zona de una fila `locked` durante 500ms sin levantar el dedo ni moverlo más de 10px
- **THEN** la fila pasa a estado `editing`
- **AND** la UI resalta el borde de la fila con `var(--color-primary)` y aplica el tonal layer correspondiente
- **AND** la UI muestra un chip flotante "Toca para cambiar" en la esquina superior derecha de la fila, posicionado absolute sobre el borde
- **AND** el chip permanece visible durante toda la duración del estado `editing` (no es one-shot por sesión)
- **AND** el navegador dispara un pulso háptico breve si está soportado

#### Scenario: Movimiento durante long-press cancela el gesto

- **WHEN** el alumno mantiene presionada una fila pero mueve el dedo más de 10px antes de cumplirse los 500ms
- **THEN** el long-press se cancela
- **AND** la fila permanece en estado `locked`
- **AND** el scroll natural de la grilla funciona normalmente

#### Scenario: Auto-bloqueo después de 5s sin acción

- **WHEN** la fila está en estado `editing` y pasan 5 segundos sin que el alumno toque ninguna burbuja
- **THEN** la fila vuelve a estado `locked` automáticamente
- **AND** la marca persistida no cambia
- **AND** el resalte visual de edición desaparece
- **AND** el chip "Toca para cambiar" deja de mostrarse

#### Scenario: Solo una fila puede estar en edición a la vez

- **WHEN** la fila 5 está en `editing` y el alumno hace long-press en la fila 7
- **THEN** la fila 5 vuelve a `locked` y su chip se oculta
- **AND** la fila 7 pasa a `editing` y muestra su propio chip
- **AND** el timeout de 5s se reinicia para la fila 7

### Requirement: Recuperación de marcaciones al reabrir la pantalla

La pantalla `/simulacro/:id` SHALL leer del puerto `MarkingsStorage` al montar y reconstruir el estado visual con todas las marcaciones previas del alumno para ese simulacro.

#### Scenario: Reapertura tras cierre de app

- **WHEN** el alumno había marcado preguntas 1–10, cerró la PWA, y vuelve a abrir `/simulacro/:id`
- **THEN** la grilla muestra las preguntas 1–10 con sus respuestas marcadas
- **AND** las preguntas 11–20 quedan sin marca

#### Scenario: Reapertura tras navegar a /home y volver

- **WHEN** el alumno entró a un simulacro, marcó algunas preguntas, volvió a `/home`, y vuelve a entrar
- **THEN** las marcaciones previas se restauran

### Requirement: Navegación libre entre `/home` y un simulacro `abierto`

La UI SHALL permitir al alumno volver a `/home` desde cualquier simulacro abierto sin enviar, y reentrar al mismo simulacro mientras siga abierto.

#### Scenario: Salida sin envío

- **WHEN** el alumno está en `/simulacro/:id` con marcas pendientes y toca "Volver"
- **THEN** navega a `/home`
- **AND** las marcaciones permanecen en `MarkingsStorage`
- **AND** el simulacro sigue en estado `abierto`

### Requirement: Entidad `Marcacion` y value-object `Alternativa` en L1

La capa L1 SHALL definir la entidad `Marcacion` con `(simulacroId, pregunta, alternativa)` y el value-object `Alternativa` que solo admite "A" | "B" | "C" | "D" | "E" | null.

#### Scenario: Construcción válida

- **WHEN** se construye `Marcacion(simulacroId, 5, Alternativa.fromString("C"))`
- **THEN** la entidad existe sin errores
- **AND** `marcacion.alternativa.value` es "C"

#### Scenario: Alternativa null para desmarcado

- **WHEN** se construye `Alternativa.fromString(null)`
- **THEN** el value-object existe con `value === null`

#### Scenario: Alternativa inválida rechazada

- **WHEN** se intenta construir `Alternativa.fromString("F")`
- **THEN** se lanza `InvalidAlternativaError`

### Requirement: Modal de comprobante shape

La capa LR SHALL exponer un componente standalone `<app-submission-receipt-modal>` con inputs `[ack]: SubmissionAck` (requerido) y output `(close): EventEmitter<void>`. El modal:
- Renderiza centrado sobre la pantalla con un backdrop oscuro y `backdrop-filter: blur(6px)`.
- Contiene un check ícono verde en círculo, título "Envío exitoso" y subtítulo "Pendiente de calificación.".
- Muestra la hora del servidor (`ack.submittedAt`) formateada como `"HH:MM — DD mmm YYYY"` (mes en español abreviado).
- Muestra el `ack.submissionHash` en bloque 4×4×4 (ver Requirement "Hash visible 4×4×4").
- Tiene un único botón "Volver al inicio" que emite `(close)`.
- Aplica pulso háptico (`navigator.vibrate([40])`) al inicializarse, reusando el patrón de fila editing.
- Su backdrop NO cierra el modal por click — solo el botón cierra (es un recibo, no un toast).

#### Scenario: Modal renderiza datos del ack

- **GIVEN** un `ack` con `submissionHash = "a3f5c8d1b2e4f6a8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2"`, `submittedAt = Date("2026-06-17T15:29:54.531Z")`
- **WHEN** se renderiza `<app-submission-receipt-modal [ack]="ack">`
- **THEN** el template muestra "Envío exitoso", "Pendiente de calificación.", el hash en 4 líneas, y la hora `"15:29 — 17 jun 2026"`

#### Scenario: Modal emite close al tocar el botón

- **GIVEN** el modal renderizado
- **WHEN** el usuario toca "Volver al inicio"
- **THEN** el componente emite `close` (sin payload)

### Requirement: Hash visible 4×4×4

El componente del modal SHALL renderizar el `ack.submissionHash` (64 chars hex) dividido en 4 líneas, cada línea con 4 grupos de 4 chars separados por un espacio. La tipografía es monoespaciada (JetBrains Mono).

#### Scenario: Hash de 64 chars produce 4 líneas

- **GIVEN** `submissionHash = "a3f5c8d1b2e4f6a8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2"`
- **WHEN** el helper `formatHashBlock(hash)` se evalúa
- **THEN** retorna `["a3f5 c8d1 b2e4 f6a8", "c9d0 e1f2 a3b4 c5d6", "e7f8 a9b0 c1d2 e3f4", "a5b6 c7d8 e9f0 a1b2"]`

#### Scenario: Hash de longitud inválida no crashea

- **GIVEN** un hash de longitud distinta a 64 (defensa contra bug del adapter)
- **WHEN** `formatHashBlock(hash)` se evalúa
- **THEN** el componente loguea un warning y renderiza el hash en una sola línea o vacío sin crashear

### Requirement: Modal aparece tras 201 en /simulacro

El view-model `SimulacroPageViewModel` SHALL exponer `readonly lastAck = signal<SubmissionAck | null>(null)`. En el path síncrono de `submit()`: cuando `EnviarSimulacroUseCase` retorna `{ status: 'enviado', ack }` con `ack !== null`, el view-model SHALL setear `lastAck(ack)` y NO navegar inmediatamente. El template del page SHALL renderizar `<app-submission-receipt-modal>` cuando `lastAck() !== null`. Cuando el modal emite `(close)`, el view-model SHALL invocar `onReceiptClose()` que limpia el signal y navega a `/home`.

#### Scenario: Submit exitoso muestra modal y no navega

- **GIVEN** `EnviarSimulacroUseCase` retorna `{ status: 'enviado', ack: validAck }`
- **WHEN** el view-model procesa el éxito de `submit()`
- **THEN** `lastAck()` es igual a `validAck`
- **AND** `Router.navigate` NO es invocado en este momento

#### Scenario: Modal dismiss navega a /home

- **GIVEN** `lastAck() !== null`
- **WHEN** el modal emite `(close)` y el view-model invoca `onReceiptClose()`
- **THEN** `lastAck()` vuelve a `null`
- **AND** `Router.navigate(['/home'])` es invocado

#### Scenario: Submit queued NO muestra modal

- **GIVEN** `EnviarSimulacroUseCase` retorna `{ status: 'queued', ack: null }`
- **WHEN** el view-model procesa el resultado
- **THEN** `lastAck()` permanece `null`
- **AND** el modal NO se renderiza
- **AND** `submissionState` es `'queued'`

### Requirement: Botón Enviar deshabilitado tras 201

Cuando `lastAck() !== null` en `/simulacro`, el botón "Enviar" del footer SHALL estar deshabilitado visualmente (clase `disabled`, color atenuado) y NO responder a clicks. Es UX defensiva — la idempotencia server-side ya cubre el caso, pero queremos que el alumno entienda que no debe volver a intentar.

#### Scenario: Botón Enviar disabled cuando hay ack

- **GIVEN** `vm.lastAck() !== null` en el template
- **THEN** el elemento `<button>` de Enviar tiene `disabled` y clase atenuada
- **AND** un click sobre él NO invoca `vm.submit()`

### Requirement: Card "enviado" con ack real

El `HomePageViewModel.composeEstado` SHALL retornar `'enviado'` cuando el examen tiene un ack persistido (`getSubmissionAck(examId) !== null`), independientemente de si `serverStatus` es `'in_progress'` o `'finalized'`. Esto reemplaza la lógica anterior basada en el booleano `hasSubmittedAck`.

#### Scenario: in_progress con ack → enviado

- **GIVEN** un examen con `serverStatus: 'in_progress'` y un `SubmissionAck` persistido
- **WHEN** `composeEstado(exam, ack)` se evalúa
- **THEN** retorna `'enviado'`

#### Scenario: finalized con ack → enviado

- **GIVEN** un examen con `serverStatus: 'finalized'` y un `SubmissionAck` persistido
- **WHEN** `composeEstado(exam, ack)` se evalúa
- **THEN** retorna `'enviado'`

#### Scenario: finalized sin ack → cerrado

- **GIVEN** un examen con `serverStatus: 'finalized'` y `null` ack
- **WHEN** `composeEstado(exam, null)` se evalúa
- **THEN** retorna `'cerrado'`

### Requirement: Card enviado muestra HH:MM del server

El `HomePageViewModel.primaryText(exam, estado: 'enviado', ack)` SHALL retornar `` `Enviado · ${formatHHMM(ack.submittedAt)}` ``. Usa el timestamp real del server (`ack.submittedAt`), NO `exam.effectiveCloseAt()`.

#### Scenario: primaryText usa ack.submittedAt

- **GIVEN** un `ack` con `submittedAt = Date("2026-06-17T15:29:54.531Z")`
- **WHEN** `primaryText(exam, 'enviado', ack)` se evalúa
- **THEN** retorna `"Enviado · 15:29"` (asumiendo timezone que renderiza ese ISO como 15:29)

### Requirement: secondaryText pendiente de calificación

El `HomePageViewModel.secondaryText(exam, estado)` SHALL retornar `"Pendiente de calificación"` cuando `estado === 'enviado'`. Para los demás estados conserva la lógica existente (`area ?? course ?? '—'` + número de preguntas).

#### Scenario: secondaryText en estado enviado

- **GIVEN** un examen en estado `enviado`
- **WHEN** `secondaryText(exam, 'enviado')` se evalúa
- **THEN** retorna `"Pendiente de calificación"`

#### Scenario: secondaryText en estado abierto conserva lógica previa

- **GIVEN** un examen en estado `abierto` con `area: "Mate"`, `count: 90`
- **WHEN** `secondaryText(exam, 'abierto')` se evalúa
- **THEN** retorna `"Mate · 90 preguntas"`

### Requirement: Copy banner queued (sin botón manual)

El banner `--queued` en `/simulacro` SHALL mostrar el copy "Sin conexión. Tus respuestas se enviarán automáticamente cuando vuelva la red." sin ningún botón ni control adicional. El reintento es 100% automático vía `EnvioRetryDispatcher` cableado a `Connectivity.isOnline` (sin cambio respecto a `fase-3-exam-list-learnex`).

#### Scenario: Banner queued no tiene botón

- **WHEN** el banner queued se renderiza en `/simulacro`
- **THEN** NO existe un `<button>` con copy "Reintentar ahora" ni similar
- **AND** el texto exacto es "Sin conexión. Tus respuestas se enviarán automáticamente cuando vuelva la red."

### Requirement: Cleanup del branch SubmissionNotAvailableError en view-model

El `SimulacroPageViewModel.handleSubmissionError` SHALL NO contener ningún branch para `SubmissionNotAvailableError`. El import de la clase SHALL eliminarse. El tipo `SimulacroErrorState` NO incluye estados específicos de ese error.

#### Scenario: View-model no importa SubmissionNotAvailableError

- **WHEN** se inspecciona `src/LR_render/view-models/simulacro.view-model.ts`
- **THEN** no hay `import` de `SubmissionNotAvailableError`
- **AND** no hay branch `instanceof SubmissionNotAvailableError`

### Requirement: Card --enviado se compone con ack !== null

La card visual `--enviado` en `/home` SHALL renderizarse cuando `getSubmissionAck(exam.id)` retorna un `SubmissionAck`, independientemente del `serverStatus`. Hoy esa lógica existe pero `getSubmissionAck` no existía (era `hasSubmittedAck` que retornaba `false` fake); este requirement formaliza la activación real.

#### Scenario: Card enviado se renderiza con ack persistido

- **GIVEN** un examen visible en `/home` con `getSubmissionAck(exam.id)` retornando un `SubmissionAck` no-null
- **WHEN** el `HomePageViewModel.cards` recompone
- **THEN** la card correspondiente tiene `estado === 'enviado'` y aplica la clase CSS `card--enviado`
- **AND** muestra el ícono `check_circle` en verde

#### Scenario: Card abierto cuando ack es null

- **GIVEN** un examen con `serverStatus: 'in_progress'` y `getSubmissionAck(exam.id)` retornando `null`
- **WHEN** la card se compone
- **THEN** `estado === 'abierto'` y NO se aplica `card--enviado`

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
