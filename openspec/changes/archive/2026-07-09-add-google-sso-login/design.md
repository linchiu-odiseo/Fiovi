# Design: Google SSO Login

## Context

Ver `proposal.md` para intent y `specs/auth-login/spec.md` para contrato exacto. Este doc resuelve las decisiones técnicas concretas: estilo del botón, ubicación del helper de mapping, wiring del flag env, y estrategia de tests sin acoplar al `window`.

## Architecture Decisions

### 1. Estilo del botón: outlined blanco + G colorful

**Choice**: fondo `--color-surface-container-lowest` (blanco), border `1.5px --color-outline-variant`, texto `--color-on-surface` semibold, logo G oficial de Google (SVG inline con 4 colores) a la izquierda a 20px. Hover: `--color-surface-container-low` background + `border-color: --color-primary` (Fiovi Blue).

**Why**: 
- Los guidelines oficiales de Google Sign-In recomiendan botón "light" (fondo blanco + logo colorful) o "dark" (fondo #1a73e8 + logo blanco monocromo). El light matchea mejor con el look calmo del `--color-bg` del design system y evita competir con el botón "Ingresar" primary sólido azul del form.
- El logo G colorful es reconocible instantáneamente. Un logo monocromo azul se puede confundir con un ícono genérico de "sign-in".
- El hover con `border-color: --color-primary` añade el touch Fiovi Blue del sistema sin ensuciar el estado default.
- El botón "Ingresar" sigue siendo el primary sólido azul del form — jerarquía clara: Google es opción alternativa, Ingresar es la acción por default una vez que el usuario tipeó.

**Alternatives rechazadas**:
- **Fondo Fiovi Blue sólido + logo G colorful sobre chip blanco**: rompe la jerarquía visual con el botón "Ingresar" (dos primary azules seguidos). Confuso.
- **Fondo Fiovi Blue sólido + logo G blanco monocromo**: no reconocible como Google; peor accesibilidad para daltónicos.

### 2. Separador "o continuá con email"

Entre el botón Google y el form: `<div class="login__divider">` con 2 líneas (`--color-outline-variant`) a izquierda/derecha y label uppercase 0.75rem `--color-on-surface-variant` en el medio. Patrón standard iOS-lite / Material.

### 3. Helper `mapSsoErrorToMessage` en el page component

**Choice**: función `protected mapSsoErrorToMessage(code: string | null): string | null` dentro de `LoginPage`, no en el view-model. Switch/case sobre los 8 códigos + fallback `unknown`.

**Why**: Misma justificación que `statusChip()` del restyle tutor — traducir código HTTP a copy es-PE es presentación pura, no orquestación ni dominio. Colocarlo en L2/VM crearía un DTO de presentación. Sigue el precedente de la app.

### 4. Wiring del env flag `GOOGLE_SSO_ENABLED`

Mismo patrón que `DEV_TOOLS` (change `add-dev-tools-env-flag` implícito en los 4 commits paralelos del PR anterior):

**`.env.example`**:
```
# GOOGLE_SSO_ENABLED: habilita el botón "Continuar con Google" en /login.
# En dev suele ser true. En un ambiente donde el backend aún no soporta el
# flujo Google (?app=pwa + WEB_PWA_BASE_URL), dejar en false para no exponer
# un botón que redirige mal.
GOOGLE_SSO_ENABLED=true
```

**`scripts/build-env.mjs`**:
```js
const googleSsoEnabled = (env['GOOGLE_SSO_ENABLED'] ?? 'true').toLowerCase() === 'true';
// ...
`  googleSsoEnabled: ${googleSsoEnabled},\n` +
```

**`src/environments/environment.ts`** (generado): campo `googleSsoEnabled: boolean`.

**Default `true`**: en dev y prod normal, el botón está visible. Solo se apaga con `GOOGLE_SSO_ENABLED=false` explícito. Justificación: la ausencia del flag no debería romper la feature — es un opt-out, no un opt-in.

### 5. Redirect via `window.location.assign` (no `href`)

**Choice**: `window.location.assign(url)` en el handler.

**Why**: `assign` es un método spy-friendly (fácil de mockear en tests con `vi.spyOn(window.location, 'assign')`), mientras que `href = ...` es un setter que rompe algunos runners y requiere `Object.defineProperty` gymnastics. Funcionalmente equivalentes para navigation externa.

### 6. `returnTo=/` fijo

**Choice**: siempre pasar `returnTo=/` en la URL del `/start`.

**Why**: El backend post-callback redirige a `${WEB_PWA_BASE_URL}${returnTo}`. Como Fiovi arranca en `/` y el `AppInitializer` decide el destino final según role (student → `/student/home`, tutor → `/tutor/home`) usando `identity` post-login, no tiene sentido que el frontend prediga la ruta acá. Confiar en el pipeline post-login existente.

**Alternatives rechazadas**:
- **Pasar la ruta actual del usuario (deep-link recovery)**: en `/login` no hay ruta anterior útil — si el usuario vino de una ruta protegida via authGuard, ya perdió el contexto. Deep-link recovery es feature futura opcional, no scope de este change.

### 7. Lectura del `?ssoError=` con `ActivatedRoute.snapshot`

**Choice**: en el constructor (o `ngOnInit`) leer `this.route.snapshot.queryParams['ssoError']` una sola vez.

**Why**: 
- El `ssoError` solo se setea cuando el backend redirige — no cambia durante la sesión del `LoginPage`, así que no necesitamos suscribirse a `queryParams` (Observable) ni disparar re-render.
- `snapshot` es sincrónico, evita crear un signal derivado que solo actualiza al montar.
- Setear directamente `vm.errorMessage.set(msg)` al montar es más simple que introducir un signal separado.

### 8. Tests: mockear `window.location.assign` con `Object.defineProperty`

**Choice**: en el spec del `LoginPage`, hacer:
```ts
const assignSpy = vi.fn();
Object.defineProperty(window, 'location', {
  writable: true,
  value: { ...window.location, assign: assignSpy },
});
```

**Why**: es el pattern estándar en tests de Angular con jsdom + Vitest cuando hay que interceptar `window.location.*`. El `writable: true` permite restaurar el valor original en `afterEach`.

### 9. Sin tests para el env flag

**Choice**: no agregar tests de `environment.googleSsoEnabled === false → botón ausente`. Confiar en el binding `@if` directo.

**Why**: el flag es config estática compilada en build time — no es reactive. Testear que un `@if (environment.googleSsoEnabled) { ... }` esconde el DOM cuando `false` es testear el compilador de Angular, no lógica del proyecto. Documentado en spec pero no se implementa como spec-test.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/LR_render/pages/login/login.page.html` | Modify | Agregar botón Google + separador arriba del form actual |
| `src/LR_render/pages/login/login.page.scss` | Modify | Estilos `.login__google-btn` outlined + `.login__divider` |
| `src/LR_render/pages/login/login.page.ts` | Modify | Agregar `ActivatedRoute` inject, `ngOnInit` lector de `ssoError`, `onGoogleLoginClick()`, helper `mapSsoErrorToMessage()`, expose `isGoogleSsoEnabled` |
| `.env.example` | Modify | Documentar `GOOGLE_SSO_ENABLED` |
| `scripts/build-env.mjs` | Modify | Coerción a boolean + escritura en `environment.ts` |
| `tests/feature/LR_render/pages/login/login.page.spec.ts` | Modify | Añadir tests nuevos (mapSsoError + click botón + presencia del botón) |

## SVG Logo G (inline, 24×24)

Se inline el SVG oficial multicolor de Google en el HTML del botón:

```html
<svg class="login__google-btn-icon" viewBox="0 0 24 24" aria-hidden="true" width="20" height="20">
  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
</svg>
```

## Testing Strategy

- **Nuevos tests** en `tests/feature/LR_render/pages/login/login.page.spec.ts`:
  - `Scenario: Botón Google visible cuando flag=true` (con environment.googleSsoEnabled patcheado)
  - `Scenario: Botón Google ausente cuando flag=false`
  - `Scenario: Click en botón dispara window.location.assign con URL correcta`
  - `Scenario: ssoError=X renderiza mensaje Y` — 8 tests parametrizados
  - `Scenario: ssoError con código desconocido → fallback unknown`
  - `Scenario: /login sin ssoError → no error message`
- **Tests existentes** no se tocan — el form email/password sigue funcionando idéntico.

## Rollback

`git revert` del commit único (o de los 3 commits: env, code, tests). Sin migración de estado, sin cambio de contrato — post-revert el `LoginPage` vuelve a mostrar solo el form.

## Follow-ups (documentados, fuera de scope)

- **PWA standalone iOS + OAuth**: cuando la PWA está instalada como app en iPhone, iOS puede abrir el redirect a Google en Safari system browser y las cookies quedan fuera de la PWA. Mitigation opcional: detectar `window.matchMedia('(display-mode: standalone)').matches` y ocultar el botón (o mostrar warning). No es scope de este change.
- **Deep-link recovery**: si el usuario cae en `/login` desde una ruta protegida (via authGuard), no recuperamos ese destino en el `returnTo`. Feature opcional futura.
- **Consumir `/config`**: si mañana hay tenants sin Google SSO habilitado, se puede consumir `GET /t/{slug}/auth/google/config` al montar para ocultar el botón dinámicamente. Hoy no aplica (Fiovi = un tenant fijo `vonex` con SSO garantizado).
