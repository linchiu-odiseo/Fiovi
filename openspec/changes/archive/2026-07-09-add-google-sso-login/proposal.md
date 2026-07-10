# Proposal: Google SSO Login

## Intent

Agregar botón "Continuar con Google" en `LoginPage` que dispara el flujo Google OAuth expuesto por el backend learnex (`/t/{slug}/auth/google/start?app=pwa`). El backend maneja todo el ciclo OAuth y setea las mismas cookies HttpOnly (`learnex_tenant_access` + `learnex_tenant_refresh`) que ya usa el login por email/password — Fiovi solo redirige al inicio y lee `?ssoError=` al volver.

Motivación: los usuarios institucionales (`@vonex.edu.pe`) esperan poder loguearse con su cuenta Google del dominio en vez de recordar contraseña separada. El backend ya está diseñado para servir a múltiples frontends via el param `?app=` (Fiovi = `pwa`, web-tenant = default), y va a redirigir al callback usando `WEB_PWA_BASE_URL` del env de learnex.

## Scope

### In Scope
- Botón "Continuar con Google" siempre visible en `LoginPage`, arriba del form email/password.
- Handler `onGoogleLoginClick()` que redirige a `${apiBaseUrl}/t/${tenantSlug}/auth/google/start?app=pwa&returnTo=/`.
- Lectura de `?ssoError=<code>` en `LoginPage` al montar → helper `mapSsoErrorToMessage(code)` que traduce los 8 códigos definidos por learnex a copy es-PE → muestra en el mismo slot `vm.errorMessage`.
- Separador visual "o continuá con email" entre el botón Google y el form.
- Env flag opcional `GOOGLE_SSO_ENABLED` (default `true`) en `.env.example` + `build-env.mjs` para poder ocultar el botón si el backend aún no está listo en un ambiente concreto. Sigue el patrón exacto de `DEV_TOOLS` ya establecido.

### Out of Scope
- **No consumir `/config`**: mostramos el botón siempre. Si el tenant no tiene SSO habilitado, el backend redirige con `?ssoError=sso_disabled` y Fiovi muestra el mensaje.
- No tocar view-models existentes (`LoginViewModel`), stores, L1/L2/L3 auth, ni contratos HTTP. El interceptor de `withCredentials: true` ya maneja las cookies devueltas por el callback del backend.
- No agregar rutas nuevas. `/login` ya existe y es el destino del `?ssoError=`.
- No tocar los tests existentes de `login.page.spec.ts` — se agregan tests nuevos para las capabilities nuevas (botón + error mapping).
- No implementar detection de PWA standalone iOS (issue conocido: OAuth redirect puede abrir en Safari system browser, no en la PWA instalada). Se documenta en design como follow-up; hoy la mayoría de usuarios navegan desde el browser.

## Capabilities

### Modified Capabilities
- `auth-login`: agrega botón Google + lectura de `?ssoError=` con mapping es-PE. El flujo email/password existente no cambia.

### New Capabilities
- Ninguna — el flujo Google es una variante del login existente que termina con las mismas cookies.

## Approach

Cambio quirúrgico 100% LR_render + config env:

1. **`login.page.html`**: botón "Continuar con Google" arriba del form (con logo G colorful oficial), separador visual, form email/password existente sin cambios.
2. **`login.page.scss`**: estilo del botón (outlined blanco + logo G a la izquierda + hover con acento Fiovi Blue), separador con línea + label uppercase.
3. **`login.page.ts`**: `onGoogleLoginClick()` construye URL con `apiBaseUrl` + `tenantSlug` + `?app=pwa` y hace `window.location.href = ...`. Al montar (`ngOnInit`), lee `ssoError` del `ActivatedRoute.snapshot.queryParams`, mapea a copy es-PE con helper local, setea `vm.errorMessage`.
4. **`.env.example` + `scripts/build-env.mjs` + `environment.ts`**: agregar `GOOGLE_SSO_ENABLED` boolean opt-in (default `true`) siguiendo el patrón exacto de `DEV_TOOLS`.
5. **Tests**: agregar spec de `mapSsoErrorToMessage` para los 8 códigos + spec de que el botón dispara `window.location.assign` con la URL correcta (spy sobre `window.location`). Sin modificar los tests actuales.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/LR_render/pages/login/login.page.html` | Modified | Botón Google + separador arriba del form actual |
| `src/LR_render/pages/login/login.page.scss` | Modified | Estilo botón outlined + separador |
| `src/LR_render/pages/login/login.page.ts` | Modified | `onGoogleLoginClick()` + lectura `ssoError` + helper `mapSsoError` |
| `.env.example` | Modified | Agregar `GOOGLE_SSO_ENABLED` documentado |
| `scripts/build-env.mjs` | Modified | Escribir `googleSsoEnabled` en `environment.ts` |
| `tests/feature/LR_render/pages/login/login.page.spec.ts` | Modified | Añadir tests nuevos (no modificar los existentes) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| R1 — Backend learnex aún no implementó `?app=pwa` | High | Env flag `GOOGLE_SSO_ENABLED=false` en prod hasta merge; en dev el flag queda `true` para probar. El día que learnex merguee, el flag se activa por deploy sin código nuevo. |
| R2 — PWA standalone iOS abre OAuth en Safari system y las cookies quedan fuera de la PWA | Med | Documentado en design como follow-up. La mayoría de alumnos usa Fiovi en browser, no PWA instalada. |
| R3 — Cross-origin redirect en dev (backend en `localhost:2001`, front en `localhost:3006`) — SameSite cookies | Low | Backend en dev usa `SameSite=Lax` y localhost es same-site aunque cambien puertos. Cookies HttpOnly del login email/password ya funcionan con el mismo setup. |
| R4 — El logo G oficial de Google requiere assets o SVG inline | Low | Se inline el SVG oficial de Google en el HTML — cero request extra, cero dependencia. |
| R5 — `window.location.href` en un test spec puede romper el runner | Low | Usar spy sobre `window.location.assign` en vez de setter directo; los tests actuales ya patchean navigation similar. |

## Rollback Plan

`git revert` del PR entero. El change no toca dominio, contratos ni schema — el rollback es puramente cosmético + el env flag. Post-revert, el `LoginPage` vuelve al estado pre-cambio con solo el form email/password.

## Dependencies

- **Backend learnex** debe tener mergeado el cambio del `?app=pwa` + `WEB_PWA_BASE_URL` para que el flujo funcione end-to-end en dev y prod. Sin ese cambio, el botón redirige a Google, Google vuelve al callback del backend, y el backend redirige al `WEB_TENANT_BASE_URL` (web-tenant de learnex) en vez de a Fiovi — el usuario cae en el frontend equivocado.
- El env flag `GOOGLE_SSO_ENABLED` permite deploy antes que learnex esté listo (queda oculto hasta activar el flag).
- Google Cloud Console: sin cambios necesarios (el `redirect_uri` es del backend).

## Success Criteria

- [ ] Botón "Continuar con Google" visible en `/login` cuando `GOOGLE_SSO_ENABLED=true`; oculto cuando `false`.
- [ ] Click en botón navega a `${apiBaseUrl}/t/${tenantSlug}/auth/google/start?app=pwa&returnTo=/` (verificado por spec).
- [ ] Query param `?ssoError=<code>` en `/login` renderiza el mensaje es-PE correspondiente en el slot `.error`.
- [ ] Los 8 códigos definidos por learnex (`sso_disabled`, `google_error`, `missing_params`, `state_invalid`, `hosted_domain_mismatch`, `email_not_verified`, `user_not_found`, `unknown`) tienen mensaje mapeado.
- [ ] `npm test` verde (984 tests actuales + los nuevos).
- [ ] `npm run lint` sin warnings nuevos.
- [ ] Cero hex hardcoded en el nuevo SCSS (grep = 0).
- [ ] `hexagonal-guard` reporta 0 violaciones — el change es 100% LR_render + config env.
