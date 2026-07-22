# pwa-shell-update Specification

## Purpose
Habilita actualización automática del shell de la PWA servido por el Service Worker de Angular, sin requerir que el usuario desinstale o reinstale. Aplica gating de ruta para preservar la integridad del simulacro en curso, expone una versión SemVer al usuario y a soporte, y garantiza que las marcaciones IndexedDB sobrevivan al reinicio.

## Requirements

### Requirement: `PwaUpdateService` en L3 detecta actualizaciones del shell vía `SwUpdate`

El sistema SHALL exponer un servicio Angular `PwaUpdateService` en `src/L3_periphery/pwa/pwa-update.service.ts` que se suscribe a `SwUpdate.versionUpdates` al arrancar la app vía `provideAppInitializer`. El servicio MUST procesar eventos `VERSION_READY` para detectar cuándo hay un nuevo bundle descargado y listo para activar. El servicio NO MUST procesar eventos `VERSION_DETECTED` ni `VERSION_INSTALLATION_FAILED` para popular el estado público, pero MAY loguearlos silenciosamente.

#### Scenario: `VERSION_READY` emitido por SwUpdate

- **GIVEN** la PWA está corriendo en producción con `enabled: !isDevMode()`
- **WHEN** `SwUpdate.versionUpdates` emite un evento con tipo `'VERSION_READY'`
- **THEN** `PwaUpdateService` registra internamente que hay update lista para activar
- **AND** evalúa la regla de gating de ruta (ver requirement siguiente) antes de exponer `pendingUpdate().available = true`

#### Scenario: `VERSION_INSTALLATION_FAILED` ignorado para estado público

- **WHEN** `SwUpdate.versionUpdates` emite `'VERSION_INSTALLATION_FAILED'`
- **THEN** `pendingUpdate().available` permanece sin cambios
- **AND** el servicio loguea silenciosamente (consola, no `alert`)

### Requirement: Gating de ruta — banner postergado en `/simulacro/:id`

`PwaUpdateService` SHALL exponer la signal `pendingUpdate()` con shape `{ available: boolean, fromVersion: string, toVersion: string }`. La regla `available` MUST cumplir: `available === (updateDownloaded && !currentUrl.startsWith('/simulacro/'))`, donde `currentUrl` es la URL actual del `Router`. El servicio MUST suscribirse a `Router.events` filtrando por `NavigationEnd` y re-evaluar `available` en cada navegación.

#### Scenario: Update detectada mientras el alumno está en /home

- **GIVEN** el alumno está navegando en `/home`
- **AND** `Router.url === '/home'`
- **WHEN** `versionUpdates` emite `VERSION_READY`
- **THEN** `pendingUpdate().available` SHALL pasar a `true`

#### Scenario: Update detectada mientras el alumno está en /simulacro/:id

- **GIVEN** el alumno está navegando en `/simulacro/abc-123`
- **AND** `Router.url === '/simulacro/abc-123'`
- **WHEN** `versionUpdates` emite `VERSION_READY`
- **THEN** `pendingUpdate().available` SHALL permanecer `false`
- **AND** el estado interno del servicio MUST recordar que hay update latched

#### Scenario: Alumno vuelve de /simulacro a /home con update latched

- **GIVEN** `pendingUpdate().available === false` con update latched
- **WHEN** `Router` emite `NavigationEnd` con `url === '/home'`
- **THEN** `pendingUpdate().available` SHALL pasar a `true`

#### Scenario: Alumno entra a /simulacro con banner ya visible

- **GIVEN** `pendingUpdate().available === true` y el alumno está en `/home`
- **WHEN** `Router` emite `NavigationEnd` con `url === '/simulacro/abc-123'`
- **THEN** `pendingUpdate().available` SHALL pasar a `false`

### Requirement: Versiones expuestas vía `appData` del `ngsw.json`

`PwaUpdateService` SHALL leer `event.currentVersion.appData?.version` y `event.latestVersion.appData?.version` para popular `fromVersion` y `toVersion` de la signal. Si cualquiera de los dos es `undefined` o vacío, el campo correspondiente SHALL valer `"—"` (em dash). El servicio NO MUST fallar la activación por falta de `appData`.

#### Scenario: Ambas versiones expuestas correctamente

- **GIVEN** `currentVersion.appData = { version: '1.0.0' }` y `latestVersion.appData = { version: '1.1.0' }`
- **WHEN** se emite `VERSION_READY` y se evalúa el gating positivamente
- **THEN** `pendingUpdate()` devuelve `{ available: true, fromVersion: '1.0.0', toVersion: '1.1.0' }`

#### Scenario: `appData` ausente en la versión vieja (legacy install)

- **GIVEN** `currentVersion.appData = undefined` y `latestVersion.appData = { version: '1.1.0' }`
- **WHEN** se emite `VERSION_READY`
- **THEN** `pendingUpdate()` devuelve `{ available: true, fromVersion: '—', toVersion: '1.1.0' }`
- **AND** la activación NO MUST bloquearse por este caso

### Requirement: `applyUpdate()` activa y recarga, con fallback silencioso

`PwaUpdateService` SHALL exponer un método público asíncrono `applyUpdate()` que llama `SwUpdate.activateUpdate()` y luego `document.location.reload()`. Si `activateUpdate()` rechaza con cualquier error, el servicio SHALL loguear silenciosamente, mantener `pendingUpdate().available === true`, y NO MUST llamar `reload()`. El método MUST ser idempotente: si ya está en curso un `applyUpdate()`, una segunda llamada SHALL no-op.

#### Scenario: Activación exitosa

- **GIVEN** `pendingUpdate().available === true`
- **WHEN** se invoca `applyUpdate()`
- **AND** `SwUpdate.activateUpdate()` resuelve `true`
- **THEN** `document.location.reload()` SHALL ser llamado una vez

#### Scenario: Activación falla

- **GIVEN** `pendingUpdate().available === true`
- **WHEN** se invoca `applyUpdate()`
- **AND** `SwUpdate.activateUpdate()` rechaza con error
- **THEN** `document.location.reload()` NO MUST ser llamado
- **AND** `pendingUpdate().available` SHALL permanecer `true`
- **AND** el error MUST loguearse en consola sin propagarse

#### Scenario: Doble click en Actualizar

- **GIVEN** `applyUpdate()` ya está en curso
- **WHEN** se invoca `applyUpdate()` por segunda vez
- **THEN** la segunda invocación SHALL retornar sin disparar otra llamada a `activateUpdate()`

### Requirement: Polling adicional en `visibilitychange`, throttled y online-gated

`PwaUpdateService` SHALL registrar un listener `document.addEventListener('visibilitychange', ...)` al inicializar. Cuando `document.visibilityState === 'visible'` Y `navigator.onLine === true`, el servicio SHALL invocar `SwUpdate.checkForUpdate()`. El servicio MUST aplicar throttle: como mínimo 60 000 ms entre dos llamadas consecutivas a `checkForUpdate()`. Si `navigator.onLine === false`, el servicio NO MUST llamar `checkForUpdate()`.

#### Scenario: App vuelve a foreground con red

- **GIVEN** la app está en background hace 5 minutos
- **AND** `navigator.onLine === true`
- **WHEN** el usuario vuelve a la PWA y `visibilitychange` dispara con `visible`
- **THEN** `SwUpdate.checkForUpdate()` SHALL ser invocado una vez

#### Scenario: App vuelve a foreground sin red

- **GIVEN** la app está en background
- **AND** `navigator.onLine === false`
- **WHEN** `visibilitychange` dispara con `visible`
- **THEN** `SwUpdate.checkForUpdate()` NO MUST ser invocado

#### Scenario: Throttle bloquea segundo check rápido

- **GIVEN** `checkForUpdate()` se llamó hace 20 segundos
- **WHEN** `visibilitychange` dispara nuevamente con `visible` y `onLine`
- **THEN** `SwUpdate.checkForUpdate()` NO MUST ser invocado en esta vuelta

#### Scenario: Throttle permite check después de 60 s

- **GIVEN** `checkForUpdate()` se llamó hace 65 segundos
- **WHEN** `visibilitychange` dispara con `visible` y `onLine`
- **THEN** `SwUpdate.checkForUpdate()` SHALL ser invocado

### Requirement: Banner "Hay una versión nueva" en `HomePage`, no bloqueante

`HomePage` SHALL renderizar un componente `<app-update-banner>` que sea visible si y solo si `PwaUpdateService.pendingUpdate().available === true`. El banner MUST renderizarse entre el `<header>` del saludo y la sección `<section class="simulacros">`, en el mismo slot vertical que los `banner--blocking` actuales. El banner NO MUST bloquear interacción con el resto de la página: el alumno puede ignorarlo y entrar a un simulacro disponible. El copy del banner MUST ser exactamente: `"Hay una versión nueva — Toca para actualizar"`. El estilo MUST usar la variante CSS `banner--update` (azul tenue, descrito en `design.md` D7) y NO MUST usar las variantes existentes `banner--error` (rojo) ni `banner--blocking` (gris/rojo bloqueante).

#### Scenario: Banner visible cuando hay update disponible

- **GIVEN** `pendingUpdate().available === true`
- **WHEN** se renderiza `HomePage`
- **THEN** el DOM SHALL contener un elemento `<app-update-banner>` visible
- **AND** el texto SHALL ser exactamente `"Hay una versión nueva — Toca para actualizar"`

#### Scenario: Banner ausente cuando no hay update

- **GIVEN** `pendingUpdate().available === false`
- **WHEN** se renderiza `HomePage`
- **THEN** el DOM NO MUST contener `<app-update-banner>` (o el componente debe estar oculto a aria-hidden)

#### Scenario: Banner no bloquea entrada a simulacro disponible

- **GIVEN** `pendingUpdate().available === true`
- **AND** existe un simulacro con `estado === 'abierto'` y `card.clickable === true`
- **WHEN** el alumno toca la card del simulacro
- **THEN** la navegación SHALL ejecutarse normalmente hacia `/simulacro/:id`

### Requirement: Modal de confirmación al tocar el banner

`<app-update-banner>` SHALL emitir un evento al tocarse que abre `<app-update-confirm-modal>`. El modal MUST cubrir la página con un overlay semi-transparente. El título MUST ser `"Actualizar Fiovi"`. El cuerpo MUST mostrar dos líneas: `"Versión actual: {{ pendingUpdate().fromVersion }}"` y `"Versión nueva: {{ pendingUpdate().toVersion }}"`. El texto explicativo MUST ser literal: `"La app se va a reiniciar para aplicar la nueva versión. Tus marcaciones están guardadas."`. PROHIBIDO incluir las frases `"se borrarán"`, `"vas a perder"`, `"se eliminarán"` o cualquier variante que implique pérdida de datos del alumno. El modal MUST exponer dos botones: `[Cancelar]` y `[Actualizar]`. `[Cancelar]` SHALL cerrar el modal sin efectos colaterales. `[Actualizar]` SHALL invocar `PwaUpdateService.applyUpdate()`.

#### Scenario: Modal abre con versiones correctas

- **GIVEN** `pendingUpdate() = { available: true, fromVersion: '1.0.0', toVersion: '1.1.0' }`
- **WHEN** el alumno toca el banner
- **THEN** el modal SHALL renderizarse con título `"Actualizar Fiovi"`
- **AND** el cuerpo SHALL contener `"Versión actual: 1.0.0"` y `"Versión nueva: 1.1.0"`
- **AND** el texto explicativo SHALL ser literal `"La app se va a reiniciar para aplicar la nueva versión. Tus marcaciones están guardadas."`

#### Scenario: Modal con versiones em-dash (fallback legacy)

- **GIVEN** `pendingUpdate() = { available: true, fromVersion: '—', toVersion: '1.1.0' }`
- **WHEN** el modal se renderiza
- **THEN** el cuerpo SHALL contener `"Versión actual: —"` y `"Versión nueva: 1.1.0"`

#### Scenario: Cancelar cierra el modal sin aplicar

- **GIVEN** el modal está abierto
- **WHEN** el alumno toca `[Cancelar]`
- **THEN** el modal SHALL cerrarse
- **AND** `pendingUpdate().available` SHALL permanecer `true`
- **AND** el banner SHALL seguir visible en el home

#### Scenario: Actualizar dispara applyUpdate

- **GIVEN** el modal está abierto
- **WHEN** el alumno toca `[Actualizar]`
- **THEN** `PwaUpdateService.applyUpdate()` SHALL ser invocado exactamente una vez

#### Scenario: Copy NO contiene lenguaje de borrado

- **WHEN** se renderiza el modal en cualquier estado
- **THEN** el texto agregado de todos los elementos del modal NO MUST contener las subcadenas (case-insensitive): `"se borrarán"`, `"vas a perder"`, `"se eliminarán"`, `"se borran"`, `"se pierden"`, `"se eliminan"`

### Requirement: Componente `<app-version-footer>` reutilizable

El sistema SHALL exponer un componente standalone Angular `<app-version-footer>` en `src/LR_render/components/version-footer/`. El componente SHALL renderizar un `<footer>` con texto exacto `"Fiovi · versión {{ environment.appVersion }}"`. El estilo MUST cumplir: color tenue (gris claro, usando token `--color-text-muted` o equivalente del design system), `font-size` ~11px, sin negrita, centrado horizontalmente. Si `environment.appVersion` es vacío o `undefined`, el componente NO MUST renderizar ningún texto (defensive).

#### Scenario: Footer muestra versión

- **GIVEN** `environment.appVersion === '1.1.0'`
- **WHEN** se renderiza `<app-version-footer>`
- **THEN** el DOM SHALL contener un `<footer>` con texto `"Fiovi · versión 1.1.0"`

#### Scenario: Footer oculto si versión vacía

- **GIVEN** `environment.appVersion === ''`
- **WHEN** se renderiza `<app-version-footer>`
- **THEN** el DOM SHALL contener un `<footer>` vacío o sin elemento de texto

### Requirement: Footer de versión visible en `HomePage`

`HomePage` SHALL embeber `<app-version-footer>` como último child del `<main class="home">`, después del `<footer class="home__footer">` con el botón "Cerrar sesión". El componente SHALL ser visible siempre, independientemente del estado de update.

#### Scenario: Footer presente con o sin update

- **GIVEN** la app fue cargada con `environment.appVersion === '1.1.0'`
- **WHEN** se renderiza `HomePage` en cualquier estado (con o sin `pendingUpdate().available`)
- **THEN** el DOM de `HomePage` SHALL contener `<app-version-footer>` con texto `"Fiovi · versión 1.1.0"`

### Requirement: `version` en `package.json` propagada por `build-env.mjs` y `inject-ngsw-appdata.mjs`

`scripts/build-env.mjs` SHALL leer el campo `version` desde `package.json` (raíz del repo). Si está ausente o vacío, el script SHALL fallar con un mensaje de error que mencione `package.json` y `version`. Cuando está presente, el script SHALL escribir el campo `appVersion: '<valor>'` en `src/environments/environment.ts` y `src/environments/environment.production.ts`. Post-build, `scripts/inject-ngsw-appdata.mjs` (hook `postbuild`) SHALL abrir el `ngsw.json` generado por `ng build` y mutar el JSON para incluir el campo `appData: { version: '<valor>' }` a nivel raíz, persistiendo el cambio. La mutación SHALL NO ejecutarse si `ngsw.json` no existe (ej. en build de development o tests). La versión NO SHALL leerse de `.env`: `package.json` es la única fuente de verdad para que el bump se haga con `npm version` y no requiera tocar `.env` en producción.

#### Scenario: `package.json.version` presente — environments y ngsw.json actualizados

- **GIVEN** `package.json` contiene `"version": "1.1.0"`
- **WHEN** se ejecuta `npm run build`
- **THEN** `src/environments/environment.ts` SHALL exportar un objeto con `appVersion: '1.1.0'`
- **AND** `dist/.../ngsw.json` SHALL contener `appData: { version: '1.1.0' }` a nivel raíz

#### Scenario: `package.json.version` ausente — preflight falla

- **GIVEN** `package.json` no contiene el campo `version` (o está vacío)
- **WHEN** se ejecuta `npm run build` o `npm run dev`
- **THEN** el proceso SHALL salir con código no-cero
- **AND** stderr SHALL mencionar `package.json` y `version`

#### Scenario: Build sin ngsw.json (development)

- **GIVEN** `package.json` contiene `"version": "1.1.0"`
- **AND** se corre un comando que no genera `ngsw.json` (ej. `npm test`)
- **WHEN** el hook `postbuild` no dispara (o `dist/` no existe)
- **THEN** el step de mutación de `ngsw.json` SHALL ser skipped silenciosamente
- **AND** `environment.ts` SHALL escribirse correctamente igual

### Requirement: `PwaUpdateService` se inicializa via `provideAppInitializer`

`src/app.config.ts` SHALL agregar un nuevo `provideAppInitializer` que inyecta `PwaUpdateService` y llama un método `start()` (o equivalente) que efectivamente arranca la suscripción a `versionUpdates` y al `visibilitychange` listener. La inicialización NO MUST bloquear el boot de la app: el método `start()` SHALL ejecutar setup sincrónico y no devolver una Promise que la app deba esperar.

#### Scenario: Servicio arranca al boot de la app

- **GIVEN** la app monta en producción con `provideServiceWorker.enabled === true`
- **WHEN** Angular ejecuta los `appInitializers`
- **THEN** `PwaUpdateService.start()` SHALL invocarse exactamente una vez
- **AND** el servicio SHALL tener suscripta `SwUpdate.versionUpdates`
- **AND** el servicio SHALL tener registrado el listener de `visibilitychange`
