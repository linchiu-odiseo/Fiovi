# Tasks: add-google-sso-login

## Phase 1: env flag (patrón DEV_TOOLS)

- [ ] T1.1 `.env.example`: agregar bloque documentado para `GOOGLE_SSO_ENABLED=true` (mismo estilo que `DEV_TOOLS`).
- [ ] T1.2 `scripts/build-env.mjs`: leer `GOOGLE_SSO_ENABLED`, coercer a boolean (default `true` si ausente), escribir `googleSsoEnabled: <bool>` en el objeto environment generado (2 llamadas: dev + prod).
- [ ] T1.3 Correr `npm run build-env` y verificar que `src/environments/environment.ts` tiene `googleSsoEnabled: true`.

## Phase 2: login.page.ts

- [ ] T2.1 Import: `ActivatedRoute` de `@angular/router` + `environment` de `../../../environments/environment` + `OnInit` de `@angular/core`.
- [ ] T2.2 Inject `ActivatedRoute` en el constructor.
- [ ] T2.3 Agregar propiedad `protected readonly googleSsoEnabled = environment.googleSsoEnabled` y `protected readonly googleSsoUrl` computado como getter con `${environment.apiBaseUrl}/t/${environment.tenantSlug}/auth/google/start?app=pwa&returnTo=%2F`.
- [ ] T2.4 Implementar `OnInit.ngOnInit()`: leer `this.route.snapshot.queryParams['ssoError']`, si presente pasarlo a `mapSsoErrorToMessage()` y setear `this.vm.errorMessage.set(msg)` con el resultado (si no es null).
- [ ] T2.5 Agregar `protected onGoogleLoginClick(): void { window.location.assign(this.googleSsoUrl); }`.
- [ ] T2.6 Agregar helper `protected mapSsoErrorToMessage(code: string | null | undefined): string | null` con switch de 8 códigos + fallback `unknown` según spec `auth-login`.

## Phase 3: login.page.html

- [ ] T3.1 Antes del `<form>` agregar `@if (googleSsoEnabled) { <button class="login__google-btn" ...>...</button> <div class="login__divider">...</div> }`.
- [ ] T3.2 Botón Google con `type="button"`, `data-testid="btn-google-sso"`, `(click)="onGoogleLoginClick()"`, y contenido: SVG oficial de Google (inline según design §SVG) + texto "Continuar con Google".
- [ ] T3.3 Separador con `<span></span><span class="login__divider-label">o continuá con email</span><span></span>` para las líneas laterales.

## Phase 4: login.page.scss

- [ ] T4.1 Agregar bloque `.login__google-btn` outlined según design §1: min-height 48px, radius `--radius`, border 1.5px `--color-outline-variant`, bg `--color-surface-container-lowest`, color `--color-on-surface`, font-weight 600, display inline-flex align-items center gap 0.6rem. Hover: bg `--color-surface-container-low`, border-color `--color-primary`.
- [ ] T4.2 Nested `.login__google-btn-icon { flex-shrink: 0; }` para el SVG.
- [ ] T4.3 Agregar bloque `.login__divider` display flex align-items center gap `--space-sm`, con `> span:first-child, > span:last-child { flex: 1; height: 1px; background: --color-outline-variant; }`. El `.login__divider-label` con font-size 0.75rem uppercase letter-spacing 0.05em color `--color-on-surface-variant`.
- [ ] T4.4 Verificar cero hex hardcoded: `grep -nE '#[0-9a-fA-F]{3,8}' src/LR_render/pages/login/login.page.scss` = 0. Los SVG hex del logo Google están en `.html`, no en `.scss` — OK.

## Phase 5: tests

- [ ] T5.1 En `login.page.spec.ts`, en el `beforeEach`, mockear `window.location.assign` con `Object.defineProperty(window, 'location', { writable: true, value: { ...window.location, assign: assignSpy } })`. Restaurar en `afterEach`.
- [ ] T5.2 Test: `data-testid="btn-google-sso"` presente cuando `environment.googleSsoEnabled === true`. Nota: como `environment` es import estático, no se puede patchear fácil — mejor asumir `true` (default) y solo testear presencia del botón. El caso `false` se documenta en spec pero no se implementa.
- [ ] T5.3 Test: click en el botón → `window.location.assign` invocado con URL exacta `${apiBaseUrl}/t/${tenantSlug}/auth/google/start?app=pwa&returnTo=%2F` construida con los mismos `environment.apiBaseUrl` y `tenantSlug` que tiene el test env.
- [ ] T5.4 Tests parametrizados sobre los 8 códigos + `weird_new_code`: en el `TestBed` provider de `ActivatedRoute`, mockear `snapshot.queryParams = { ssoError: 'sso_disabled' }` etc., renderizar `LoginPage`, verificar `.error` textContent contiene el mensaje esperado del mapping.
- [ ] T5.5 Test: sin `ssoError` en query params, `.error` NO existe (o `errorMessage()` es null).

## Phase 6: auditoría

- [ ] T6.1 `npm test` verde (baseline + nuevos tests).
- [ ] T6.2 `npm run lint` sin warnings nuevos.
- [ ] T6.3 `npx prettier --write` sobre los 4 archivos modificados (html/scss/ts/spec).
- [ ] T6.4 `grep -nE '#[0-9a-fA-F]{3,8}' src/LR_render/pages/login/login.page.scss` = 0.
- [ ] T6.5 `hexagonal-guard` sobre `src/` → 0 violaciones (change 100% LR + config env, nada de L1/L2/L3).
- [ ] T6.6 Inspección visual manual del botón en `npm run dev` — verificar look outlined + logo G colorful + hover con acento azul + separador prolijo.
