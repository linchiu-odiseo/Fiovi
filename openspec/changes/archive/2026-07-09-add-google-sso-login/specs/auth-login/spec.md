# Delta for auth-login

## MODIFIED Requirements

### Requirement: Página de login con formulario email/password

`LoginPage` SHALL renderizar un formulario de email + password que dispara `LoginViewModel.submit()` al enviar. La página SHALL renderizar también un botón "Continuar con Google" arriba del formulario cuando `environment.googleSsoEnabled === true`.

Cuando el botón Google se clickea, la página SHALL redirigir al usuario a la URL del flujo OAuth del backend:

```
${environment.apiBaseUrl}/t/${environment.tenantSlug}/auth/google/start?app=pwa&returnTo=/
```

El parámetro `app=pwa` SHALL estar siempre presente para que el backend redirija al frontend correcto (`WEB_PWA_BASE_URL`). El `returnTo=/` SHALL ser el path fallback — el `AppInitializer` decide el destino final según el role del identity.

Cuando `environment.googleSsoEnabled === false`, el botón NOT SHALL aparecer en el DOM. El formulario email/password sigue funcionando idéntico.

(Previously: la página solo tenía el formulario email/password sin botón Google.)

#### Scenario: Botón Google visible cuando flag habilitado

- **GIVEN** `environment.googleSsoEnabled === true`
- **WHEN** `LoginPage` renderiza
- **THEN** existe un botón con `data-testid="btn-google-sso"` visible en el DOM
- **AND** contiene el texto `"Continuar con Google"`

#### Scenario: Botón Google ausente cuando flag deshabilitado

- **GIVEN** `environment.googleSsoEnabled === false`
- **WHEN** `LoginPage` renderiza
- **THEN** NO existe ningún elemento con `data-testid="btn-google-sso"`

#### Scenario: Click en botón Google redirige al start del backend

- **GIVEN** `environment.googleSsoEnabled === true`
- **GIVEN** `environment.apiBaseUrl === "http://localhost:2001"`
- **GIVEN** `environment.tenantSlug === "vonex"`
- **WHEN** el usuario clickea el botón Google
- **THEN** `window.location.assign` es invocado con `"http://localhost:2001/t/vonex/auth/google/start?app=pwa&returnTo=%2F"`

#### Scenario: Formulario email/password funciona igual con o sin botón Google

- **GIVEN** cualquier valor de `environment.googleSsoEnabled`
- **WHEN** el usuario ingresa email + password válidos y submitea
- **THEN** `LoginViewModel.submit()` es invocado
- **AND** el flujo actual (redirect según role, error mapping, etc.) no cambia

---

## ADDED Requirements

### Requirement: Mapeo de códigos de error SSO a mensajes es-PE

`LoginPage` SHALL leer el query parameter `ssoError` de la ruta al montar. Cuando el valor está presente, SHALL setear un mensaje es-PE en `LoginViewModel.errorMessage()` según el mapeo:

| Código del backend | Mensaje es-PE |
|---|---|
| `sso_disabled` | El login con Google no está disponible para tu institución. |
| `google_error` | Google no autorizó tu ingreso. Intentá de nuevo. |
| `missing_params` | Hubo un problema con Google. Intentá de nuevo. |
| `state_invalid` | La sesión de login venció. Intentá de nuevo. |
| `hosted_domain_mismatch` | Solo podés ingresar con tu correo institucional. |
| `email_not_verified` | Tu correo de Google no está verificado. |
| `user_not_found` | Tu cuenta de Google no está registrada. Contactá a tu tutor. |
| `unknown` | No se pudo iniciar sesión con Google. Intentá de nuevo. |

Cualquier valor no reconocido (incluido `null`/`undefined`/vacío) SHALL usar el mensaje de `unknown` como fallback. Si el query param no está presente, `errorMessage()` queda `null`.

El helper `mapSsoErrorToMessage(code: string | null): string | null` SHALL vivir en el page component `LoginPage`, no en el view-model — es traducción es-PE + presentación, mismo criterio que `statusLabel()` en tutor.

El mensaje SHALL renderizarse en el mismo slot `<p class="error">` que ya usa `vm.errorMessage()` para errores de submit — sin agregar un banner adicional.

#### Scenario: ssoError=sso_disabled → mensaje de institución

- **GIVEN** la URL es `/login?ssoError=sso_disabled`
- **WHEN** `LoginPage` monta
- **THEN** el elemento `<p class="error">` contiene `"El login con Google no está disponible para tu institución."`

#### Scenario: ssoError=google_error → mensaje de reintento

- **GIVEN** la URL es `/login?ssoError=google_error`
- **WHEN** `LoginPage` monta
- **THEN** el elemento `<p class="error">` contiene `"Google no autorizó tu ingreso. Intentá de nuevo."`

#### Scenario: ssoError=user_not_found → mensaje pedir tutor

- **GIVEN** la URL es `/login?ssoError=user_not_found`
- **WHEN** `LoginPage` monta
- **THEN** el elemento `<p class="error">` contiene `"Tu cuenta de Google no está registrada. Contactá a tu tutor."`

#### Scenario: ssoError=state_invalid → mensaje de sesión expirada

- **GIVEN** la URL es `/login?ssoError=state_invalid`
- **WHEN** `LoginPage` monta
- **THEN** el elemento `<p class="error">` contiene `"La sesión de login venció. Intentá de nuevo."`

#### Scenario: ssoError=hosted_domain_mismatch → mensaje de correo institucional

- **GIVEN** la URL es `/login?ssoError=hosted_domain_mismatch`
- **WHEN** `LoginPage` monta
- **THEN** el elemento `<p class="error">` contiene `"Solo podés ingresar con tu correo institucional."`

#### Scenario: ssoError=email_not_verified → mensaje de correo no verificado

- **GIVEN** la URL es `/login?ssoError=email_not_verified`
- **WHEN** `LoginPage` monta
- **THEN** el elemento `<p class="error">` contiene `"Tu correo de Google no está verificado."`

#### Scenario: ssoError=missing_params → mensaje de reintento

- **GIVEN** la URL es `/login?ssoError=missing_params`
- **WHEN** `LoginPage` monta
- **THEN** el elemento `<p class="error">` contiene `"Hubo un problema con Google. Intentá de nuevo."`

#### Scenario: ssoError=unknown → mensaje fallback

- **GIVEN** la URL es `/login?ssoError=unknown`
- **WHEN** `LoginPage` monta
- **THEN** el elemento `<p class="error">` contiene `"No se pudo iniciar sesión con Google. Intentá de nuevo."`

#### Scenario: ssoError con código no reconocido → cae al fallback unknown

- **GIVEN** la URL es `/login?ssoError=weird_new_code`
- **WHEN** `LoginPage` monta
- **THEN** el elemento `<p class="error">` contiene `"No se pudo iniciar sesión con Google. Intentá de nuevo."`

#### Scenario: /login sin ssoError → sin mensaje pre-poblado

- **GIVEN** la URL es `/login` (sin query params)
- **WHEN** `LoginPage` monta
- **THEN** `vm.errorMessage()` es `null`
- **AND** NO existe el elemento `<p class="error">` en el DOM
