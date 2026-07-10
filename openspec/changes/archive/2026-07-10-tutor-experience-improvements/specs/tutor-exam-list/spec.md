# Delta for tutor-exam-list

## MODIFIED Requirements

### Requirement: Tarjetas con 3 estados via Signals

`TutorExamsListPage` SHALL renderizar en su sección principal **solo los exámenes con `serverStatus.value === 'in_progress'`** (accesible vía `vm.examsInProgress()`). Los exámenes `scheduled` y `finalized` NO SHALL aparecer en el listado del home tutor — viven bajo la jerarquía Aula → Curso → Examen (capability `tutor-aula-navigation`).

Cada tarjeta in-progress SHALL renderizar:
- Nombre, badge de estado con texto `"En curso"`, strip lateral con `var(--color-success)`.
- Nombre de curso si `exam.course` no es null.
- `count === null` → renderizar `"—"` en lugar del número.
- Duración en minutos usando `exam.durationInMinutes`.
- `course` como plain-text; NUNCA UUIDs.

Cuando `hasExamsInProgress()` es false, la sección muestra el copy `"No hay exámenes en curso ahora."`.

(Previously: la lista mostraba TODOS los exámenes con 3 estados visuales y no había filtro por status.)

#### Scenario: Solo exámenes in_progress aparecen en el DOM

- **GIVEN** el back devuelve 3 exámenes: uno `scheduled`, uno `in_progress`, uno `finalized`
- **WHEN** `TutorExamsListPage` renderiza
- **THEN** `[data-testid="exams-list"]` contiene exactamente 1 `[data-testid="exam-card"]`
- **AND** ese card corresponde al examen `in_progress`

#### Scenario: Empty state cuando no hay exámenes in_progress

- **GIVEN** el back devuelve solo exámenes `scheduled` o `finalized`
- **WHEN** `TutorExamsListPage` renderiza
- **THEN** el DOM contiene el copy `"No hay exámenes en curso ahora."`

---

### Requirement: Ruta /tutor/home — header completo con perfil, aulas y logout

La ruta `/tutor/home` SHALL cargar `TutorExamsListPage`. La página SHALL renderizar profile-card + sección de aulas + lista de exámenes in-progress + logout.

**Aulas clickeables:** cada `[data-testid="classroom-item"]` SHALL:
- Tener `role="button"`, `tabindex="0"`, `(click)` y `(keydown.enter)` handlers.
- Al activarse, navegar a `/tutor/aulas/:classroomId` vía `Router.navigate`.

**Fallback de email:** cuando `profile.email` viene `null` desde el back, o cuando `GetProfileUseCase` rechaza con `ProfileNotAvailableError`, el VM SHALL llamar a `GetIdentityUseCase` y usar `identity.email` para el header. Si Identity tampoco está disponible, el header omite la línea de email.

**Integración PWA:** `TutorExamsListPage` SHALL importar y renderizar:
- `<app-update-banner>` — visible cuando hay una versión nueva pendiente.
- `<app-update-confirm-modal>` — se abre al tap del banner y confirma la aplicación.
- `<app-version-footer>` — versión actual como footer permanente.

Los `data-testid` existentes (`profile-card`, `profile-card-degraded`, `profile-skeleton`, `classrooms-summary`, `classroom-item`, `classrooms-empty`, `classrooms-section`, `exams-list`, `exam-card`, `status-badge`, `btn-logout`) siguen presentes con la misma semántica.

(Previously: las aulas NO eran clickeables; no había navegación aula→curso; el fallback de email solo cubría `ProfileNotAvailableError`; no había integración con `pwa-shell-update`.)

#### Scenario: Aula clickeable navega al detalle

- **GIVEN** el tutor tiene un aula con `id = "cls-1"` en su profile
- **WHEN** el usuario clickea `[data-testid="classroom-item"]`
- **THEN** `Router.navigate` es llamado con `['/tutor/aulas', 'cls-1']`

#### Scenario: Aula responde a keydown.enter (a11y)

- **GIVEN** un `[data-testid="classroom-item"]` renderizado
- **WHEN** el usuario dispara `keydown.enter`
- **THEN** `Router.navigate` es llamado con `['/tutor/aulas', <classroomId>]`

#### Scenario: profile.email null → email del Identity

- **GIVEN** `GetProfileUseCase` resuelve con `profile.email = null`
- **AND** `GetIdentityUseCase` resuelve con `identity.email = "tutor1@vonex.pe"`
- **WHEN** `TutorExamsListPage` renderiza el header
- **THEN** el email visible es `"tutor1@vonex.pe"`

#### Scenario: PWA update banner integrado

- **WHEN** se inspecciona el template de `TutorExamsListPage`
- **THEN** existe un `<app-update-banner>`
- **AND** existe un `<app-version-footer>`
- **AND** existe un `<app-update-confirm-modal>` en el árbol condicional
