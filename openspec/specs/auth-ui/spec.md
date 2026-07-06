# auth-ui — Delta Spec (fase-3-login-learnex)

## REMOVED Requirements

### Requirement ELIMINADO: Login exitoso redirige a `/home` y limpia el formulario

La ruta destino post-login ya no es `/home` genérico — se navega a `/${identity.role()}/home`. El requirement se reemplaza por el ADDED equivalente con role-based routing. Los scenarios de "Submit de credenciales válidas" que apuntaban a `/home` quedan obsoletos y reemplazados.

### Requirement ELIMINADO: `HomePage` es un shell protegido con acción de logout (Fase 1)

La `HomePage` stub de Fase 1 (sin perfil, sin rol) se reemplaza por `StudentHomePage` y `TutorHomePage` con comportamiento diferenciado. El requirement anterior queda obsoleto.

---

## ADDED Requirements

### Requirement: `LoginViewModel` maneja `RateLimitError` (429)

Cuando `LoginUseCase` rechaza con `RateLimitError`, `LoginViewModel` SHALL establecer `errorMessage` con el texto "Demasiados intentos, esperá un minuto" y SHALL habilitar el formulario para reintentar.

#### Scenario: Rate limit en login

- **WHEN** el backend responde HTTP 429 y `LoginUseCase` rechaza con `RateLimitError`
- **THEN** `loginViewModel.errorMessage()` devuelve `"Demasiados intentos, esperá un minuto"`
- **AND** el botón submit vuelve a habilitarse
- **AND** el campo `email` conserva su valor

### Requirement: Login exitoso navega a `/{role}/home` según `identity.role()`

Cuando `LoginUseCase` resuelve exitosamente, `LoginViewModel` SHALL navegar a `/${identity.role()}/home`, limpiando los campos del formulario.

#### Scenario: Login de alumno navega a `/student/home`

- **WHEN** `LoginUseCase` devuelve `Identity` con `roles: ["student"]`
- **THEN** el navegador se mueve a `/student/home`
- **AND** los campos `email` y `password` del formulario están vacíos

#### Scenario: Login de tutor navega a `/tutor/home`

- **WHEN** `LoginUseCase` devuelve `Identity` con `roles: ["tutor"]`
- **THEN** el navegador se mueve a `/tutor/home`
- **AND** los campos `email` y `password` del formulario están vacíos

### Requirement: AppInitializer dispara `InitializeSessionUseCase` al arrancar

`app.config.ts` SHALL registrar un `provideAppInitializer` que ejecuta `InitializeSessionUseCase` antes de que la app renderice cualquier ruta. El resultado determina la navegación inicial:

- Si devuelve `Identity` → navega a `/${identity.role()}/home`.
- Si devuelve `null` (401 en `/auth/me`) → navega a `/login`.
- Si devuelve `NetworkError` → muestra pantalla de error genérica/offline (sin asumir estado de identity).

#### Scenario: AppInitializer con identity válida — navega a home del rol

- **WHEN** `InitializeSessionUseCase` devuelve `Identity` con `roles: ["student"]`
- **THEN** la app navega a `/student/home`

- **WHEN** `InitializeSessionUseCase` devuelve `Identity` con `roles: ["tutor"]`
- **THEN** la app navega a `/tutor/home`

#### Scenario: AppInitializer con 401 — navega a `/login`

- **WHEN** `InitializeSessionUseCase` devuelve `null` (sesión inválida)
- **THEN** la app navega a `/login`

#### Scenario: AppInitializer con NetworkError — pantalla offline/error

- **WHEN** `InitializeSessionUseCase` propaga `NetworkError`
- **THEN** la app muestra una pantalla de error genérica o indicador offline
- **AND** NO asume que el usuario está o no autenticado
- **AND** NO navega automáticamente a `/login`

### Requirement: `StudentHomePage` muestra perfil del alumno

`StudentHomePage` (LR_render) SHALL usar `GetProfileUseCase` para obtener el `StudentProfile` y SHALL mostrar: `userName = "${profile.firstName} ${profile.lastName}"`, `userEmail = identity.email`, `userDni = profile.code`. Mientras el fetch de perfil está en vuelo, los campos de nombre y DNI SHALL mostrar un skeleton.

#### Scenario: Render alumno con perfil cargado

- **WHEN** `GetProfileUseCase` resuelve con `StudentProfile { firstName: "Gabriel", lastName: "Acuña Acuña", code: "79507732" }`
- **THEN** `StudentHomeViewModel.userName()` devuelve `"Gabriel Acuña Acuña"`
- **AND** `StudentHomeViewModel.userDni()` devuelve `"79507732"`
- **AND** `StudentHomeViewModel.userEmail()` refleja `identity.email`

#### Scenario: Skeleton mientras el perfil está cargando

- **WHEN** `GetProfileUseCase` está en vuelo (pendiente)
- **THEN** los campos de nombre y DNI en la UI muestran skeleton
- **AND** el email (disponible en identity) puede mostrarse de inmediato

#### Scenario: `ProfileNotAvailableError` — degraded state

- **WHEN** `GetProfileUseCase` rechaza con `ProfileNotAvailableError`
- **THEN** la home muestra solo el email del usuario
- **AND** se muestra el mensaje "Perfil no disponible"
- **AND** la pantalla no queda bloqueada en estado de error total

#### Scenario: Logout desde `StudentHomePage`

- **WHEN** el alumno presiona el botón "Cerrar sesión"
- **THEN** `LogoutUseCase` se invoca
- **AND** el navegador se mueve a `/login`
- **AND** un refresh posterior sigue en `/login`

### Requirement: `TutorHomePage` stub con datos del tutor

`TutorHomePage` (LR_render) SHALL ser identificable visualmente como modo tutor. SHALL mostrar:

- Badge / pill con el texto `"Tutor"` en el header.
- Subtítulo `"Modo tutor"`.
- Saludo: `"Hola, ${profile.firstName} ${profile.lastName}"`.
- Email: `identity.email`.
- DNI/Código: `profile.code` (ej. `"T001"`), etiquetado como `"DNI / Código"`.
- Estadísticas derivadas: `"Tenés N aulas · M alumnos"` donde `N = classrooms.length` y `M = sum(classrooms[i].studentCount)`.
- Mensaje placeholder: `"Próximamente vas a gestionar tus exámenes desde acá"`.
- Botón `"Cerrar sesión"`.
- Empty state si `classrooms.length === 0`: `"Aún no tenés aulas asignadas — contactá a tu administrador"`.

#### Scenario: Tutor con 2 aulas

- **WHEN** `TutorProfile.classrooms` tiene 2 entradas con `studentCount: 60` cada una
- **THEN** `TutorHomeViewModel.statsText()` devuelve `"Tenés 2 aulas · 120 alumnos"`
- **AND** se muestra el badge `"Tutor"` y el subtítulo `"Modo tutor"`

#### Scenario: Tutor sin aulas — empty state

- **WHEN** `TutorProfile.classrooms` es `[]`
- **THEN** la UI muestra `"Aún no tenés aulas asignadas — contactá a tu administrador"`
- **AND** NO se muestra la línea de estadísticas con cero aulas

#### Scenario: DNI/Código de tutor

- **WHEN** `TutorProfile.code = "T001"`
- **THEN** la UI muestra `"T001"` bajo la etiqueta `"DNI / Código"`

#### Scenario: Logout desde `TutorHomePage`

- **WHEN** el tutor presiona el botón "Cerrar sesión"
- **THEN** `LogoutUseCase` se invoca
- **AND** el navegador se mueve a `/login`

### Requirement: `LoginPage` muestra footer de versión `<app-version-footer>`

`LoginPage` SHALL embeber el componente reutilizable `<app-version-footer>` (definido en la capability `pwa-shell-update`) como último child del contenedor principal de la página. El footer SHALL ser visible siempre, sin condicional de estado de auth. El componente leerá `environment.appVersion` y renderizará `"Fiovi · versión {{ env.appVersion }}"` con estilo tenue (gris claro, ~11px, sin negrita, centrado).

Razón: consistencia visual con `HomePage` (también muestra el footer) y necesidad operativa — el alumno preuniversitario puede tener problemas de login y reportar al soporte qué versión tiene SIN haber iniciado sesión.

#### Scenario: Footer presente en login fresco

- **GIVEN** la app fue cargada con `environment.appVersion === '1.1.0'`
- **AND** el usuario no está autenticado y ve `LoginPage`
- **WHEN** se renderiza la página
- **THEN** el DOM SHALL contener `<app-version-footer>` con texto `"Fiovi · versión 1.1.0"`

#### Scenario: Footer presente en login con error

- **GIVEN** el usuario intentó login y vio un error de credenciales
- **WHEN** se re-renderiza `LoginPage` con `errorMessage` poblado
- **THEN** `<app-version-footer>` SHALL seguir visible con el mismo contenido

#### Scenario: Footer no compite visualmente con el formulario

- **WHEN** se renderiza `LoginPage`
- **THEN** `<app-version-footer>` SHALL renderizarse debajo del botón "Iniciar sesión"
- **AND** el estilo `font-size` SHALL ser ~11px y color tenue (no compite con el botón primario)

### Requirement: Los view-models de home exponen estado vía Signals

`StudentHomeViewModel` y `TutorHomeViewModel` SHALL exponer su estado reactivo exclusivamente como Angular Signals. No SHALL usarse `async pipe` para estado del view-model.

#### Scenario: `TutorHomeViewModel` expone Signals

- **WHEN** se inspecciona `TutorHomeViewModel`
- **THEN** expone al menos `profileLoading: Signal<boolean>`, `userName: Signal<string | null>`, `statsText: Signal<string | null>`, `errorMessage: Signal<string | null>`
- **AND** sus campos derivados están implementados con `computed()`

---

## MODIFIED Requirements

### Requirement MODIFICADO: Mensajes de UI en español (es-PE)

Sigue vigente. Se extiende para incluir todos los textos nuevos: saludo del tutor, stats de aulas, empty states, etiqueta "DNI / Código", "Modo tutor", badge "Tutor", "Perfil no disponible", mensaje placeholder de TutorHome, y el mensaje de rate limit. Todos en español (es-PE) hardcodeados en plantilla.

#### Scenario: Mensajes en español en páginas nuevas

- **WHEN** se inspeccionan los templates de `StudentHomePage` y `TutorHomePage`
- **THEN** todos los textos visibles están en español (es-PE)
- **AND** no se usan claves de i18n ni `$localize`
