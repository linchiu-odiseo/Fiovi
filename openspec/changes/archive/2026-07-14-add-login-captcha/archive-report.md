# Archive Report — Add login captcha (Cloudflare Turnstile invisible)

**Fecha de archive:** 2026-07-14
**Change:** `2026-07-14-add-login-captcha`
**Rama origen:** `feat/add-login-captcha` (creada desde `develop`)

## Contexto de retro-archive

Change implementado sin arrancar por SDD (decisión del maintainer: "sin sdd luego de acabar un sdd retrospective"). Los 6 commits funcionales de la rama ya están aplicados; este report + `proposal.md` + `tasks.md` cierran el flujo SDD post-facto.

Todo compila y pasa validaciones locales:

- `tsc --noEmit -p tsconfig.app.json` — exit 0
- `tsc --noEmit -p tsconfig.spec.json` — exit 0
- `npm test` — 73 test files / 1057 tests verdes
- `npm run lint` — All files pass linting
- `npm run build` — bundle OK (warnings pre-existentes de SCSS budget)
- Subagente `hexagonal-guard` — APROBADO, cero violaciones

## Motivación externa

Learnex mergeó anti-bot en `POST /auth/login` (PR #517). El endpoint acepta un campo `captchaToken` opcional; hoy en prod `CAPTCHA_SECRET` está vacío, así que el verifier es no-op. **Cuando ops setee el secret real en prod, todos los logins responderán 401 salvo que Fiovi mande un token válido de Cloudflare Turnstile.**

Este cambio deja el cliente listo. Coordinación: el equipo learnex no prenderá `CAPTCHA_SECRET` en prod hasta que Fiovi esté deployado con el widget funcionando.

## Commits en la rama

| SHA | Área | Descripción |
|-----|------|-------------|
| `64a58d5` | L1 | Puerto CaptchaProvider + captchaToken opcional en shape login |
| `40c74e4` | L2 | Propagar captchaToken en LoginUseCase |
| `e1aee2e` | L3 | CloudflareTurnstileProvider adapter + captchaToken en HTTP body |
| `6f28ea2` | LR | CaptchaWidgetComponent + integrar en LoginPage |
| `19eac6d` | env/config | DI captcha binding + build-env vars + CSP Cloudflare |
| `ae47d22` | tests | Cobertura del path captcha (L2 + L3 + LR + fake) |

## Capabilities afectadas

### Added

- **`captcha-widget`** (implícita, sin spec formal en `openspec/specs/`) — port `CaptchaProvider`, adapter `CloudflareTurnstileProvider`, componente `CaptchaWidgetComponent`, token DI `CAPTCHA_PROVIDER`, env vars `CAPTCHA_PROVIDER` + `CAPTCHA_SITE_KEY`, CSP para `challenges.cloudflare.com`.

### Modified

- **`auth-login`** — `AuthRepository.login()` amplía shape con `captchaToken?`; `HttpAuthRepository` lo incluye en el body solo cuando viene con valor; `LoginPage` bloquea el submit hasta tener token (cuando captcha activo) y resetea el widget tras cualquier outcome distinto de éxito.

## Delta specs

Este change no genera archivos de delta spec bajo `openspec/changes/2026-07-14-add-login-captcha/specs/` porque el archivo se creó directamente en `archive/`. La única modificación de contrato (shape del login) queda documentada acá; una tarea futura puede sintetizar el spec canónico en `openspec/specs/auth-login/` si el proyecto lo requiere.

## Decisiones arquitectónicas

1. **`CaptchaContainer = unknown` en L1.** El port no importa `HTMLElement` para mantener L1 sin tipos DOM. El adapter L3 castea `container as HTMLElement` en su implementación.
2. **`isEnabled()` snapshot al montar la LoginPage.** No es reactivo — la config vive en `.env` y no cambia en runtime. Simplifica la UI (evita `signal(computed(...))` innecesario).
3. **Site key vacía = adapter deshabilitado.** El brief original permitía tres opciones para el default de dev; se eligió la test key `3x00000000000000000000FF` de Cloudflare (siempre pasa) porque permite probar el flow end-to-end sin depender de la key real. Con la var vacía, el widget no renderiza y el login funciona idéntico a antes.
4. **Body construido explícito en `HttpAuthRepository.login()`.** No pasamos `credentials` directo al `http.post` — armamos el body condicional para que `captchaToken` NO aparezca como key con `undefined` cuando el input no lo trae. Motivo: algunos serializers lo transformarían en `null`, y el zod del back en dev sin `CAPTCHA_SECRET` puede rechazar `null` estricto.
5. **Reset del widget en cualquier error (no solo credenciales inválidas).** Los tokens de Turnstile son de un solo uso — si el login falla por `NetworkError`, `RateLimitError`, `UnsupportedRoleError`, el token ya se consumió del lado del backend. Resetear siempre después de un fallo simplifica el mental model y evita edge cases.

## Notas de seguridad

- **Site key es pública por diseño.** Vive en `.env` de Fiovi (frontend) y en el bundle del build. La secret key vive solo en el backend learnex, jamás en Fiovi. Cloudflare autoriza por dominio (`yangpimpollo.com` ya cubre `app.yangpimpollo.com`); no hay que dar de alta el widget aparte para Fiovi.
- **Modo invisible.** El widget corre en background; el usuario no ve nada. Cambia de UX cero. Si Cloudflare detecta comportamiento sospechoso, escala a challenge visible automáticamente.
- **CSP: `script-src` y `frame-src`.** Se amplió con `https://challenges.cloudflare.com` para el SDK y el iframe. `connect-src` NO se toca — el fetch de validación va desde adentro del iframe (mismo origen del iframe, no cliente).
- **Política uniforme del back para 401.** Learnex responde el mismo `TENANT_AUTH_INVALID_CREDENTIALS` para captcha inválido, password inválido o email inexistente — decisión anti-bot intencional. Fiovi respeta esa política: cero diferenciación en la UI (`InvalidCredentialsError` → "Credenciales inválidas" para todo).
- **Ad-blockers.** Si un usuario tiene un ad-blocker que bloquea Cloudflare, el script no carga → widget nunca emite token → botón queda deshabilitado. Caso raro, no se cubre con UI específica (el usuario ve el botón gris y contactará soporte). Puede mejorarse en un change futuro si aparece feedback.

## Env vars nuevas

| Var | Dev (recomendado) | Prod |
|-----|-------------------|------|
| `CAPTCHA_PROVIDER` | `turnstile` (o vacío para desactivar) | `turnstile` |
| `CAPTCHA_SITE_KEY` | `3x00000000000000000000FF` (test key siempre-pass) o vacío | site key real de Cloudflare (pedir a ops learnex — misma que web-tenant) |

Con `CAPTCHA_SITE_KEY` vacío, el widget no renderiza, el login viaja sin `captchaToken`, y el backend con `CAPTCHA_SECRET` vacío acepta la request igual. Dev sin fricción.

Test keys documentadas por Cloudflare para debug:
- `3x00000000000000000000FF` — invisible, siempre pasa.
- `2x00000000000000000000AB` — invisible, siempre falla (útil para simular rechazo).

## Dependencias externas

- **learnex PR #517** — ya mergeado. Sin él, learnex no aceptaría el campo `captchaToken` en el body.
- **Cloudflare Turnstile** — cuenta compartida con web-tenant. El dominio `yangpimpollo.com` ya está autorizado en el panel de Cloudflare; cubre `app.yangpimpollo.com` (Fiovi) sin trámite adicional.
- **Ops de learnex** — cuando Fiovi esté en prod con captcha, ops setea `CAPTCHA_SECRET` + demás vars en el `.env` del back. A partir de ese momento la protección real se activa para todos.
- **Team `.env` local** — sumar `CAPTCHA_PROVIDER=turnstile` y `CAPTCHA_SITE_KEY=3x00000000000000000000FF` para probar el flow completo en dev. Sin esas vars, el flow sigue funcionando (widget deshabilitado).

## Deuda técnica declarada

- `.env.example` **no está actualizado** en este commit. El harness bloquea la escritura del archivo por permisos; el maintainer debe editar manualmente para sumar las dos vars nuevas con su doc. Ver `tasks.md` T5.4.
- No hay spec canónico en `openspec/specs/captcha-widget/` — la retrospectiva no lo requiere; se puede sintetizar en un change futuro si algún consumer (docs, herramientas de análisis) lo necesita.

## Casos post-merge

| # | Caso | Estado |
|---|------|--------|
| 1 | Dev con `CAPTCHA_SITE_KEY=""` | Login funciona idéntico a antes; body sin `captchaToken` |
| 2 | Dev con test key siempre-pass (`3x00...FF`) | Widget carga, token viaja, backend acepta |
| 3 | Prod con site key real + `CAPTCHA_SECRET` vacío en back | Widget carga, token viaja, backend ignora (no-op) |
| 4 | Prod con site key real + `CAPTCHA_SECRET` real en back | Widget carga, token viaja, backend valida — protección activa |
| 5 | Ad-blocker bloquea Cloudflare | Script no carga, botón queda deshabilitado, usuario no puede loguearse |
| 6 | Token expira (2min) antes del submit | `onExpired` emite `null`, botón vuelve a deshabilitarse hasta nuevo token |
| 7 | Login rechazado (cualquier causa) | Widget se resetea, próximo intento pide token fresco |
| 8 | SSO Google | Sin cambios — no usa captcha |
