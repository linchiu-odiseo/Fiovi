# Archive Report — add-google-sso-login (2026-07-09)

## Summary

Change **add-google-sso-login** implementado y archivado. Fiovi ahora expone un botón "Continuar con Google" en `LoginPage` que dispara el flujo OAuth del backend learnex (`?app=pwa&returnTo=/`), y muestra mensajes es-PE mapeados de los 8 códigos de error definidos por el contrato con learnex.

## Scope efectivo

5 archivos modificados:

- `src/LR_render/pages/login/login.page.html` — botón Google + separador visual
- `src/LR_render/pages/login/login.page.scss` — estilos outlined (fondo blanco, borde `--color-outline-variant`, hover con `--color-primary`)
- `src/LR_render/pages/login/login.page.ts` — helper `mapSsoErrorToMessage`, `onGoogleLoginClick`, lectura de `?ssoError=`, exposure de `googleSsoEnabled` + `googleSsoUrl`
- `tests/feature/LR_render/pages/login/login.page.spec.ts` — +12 tests (botón + click + 8 códigos + fallback + sin error)
- `scripts/build-env.mjs` — env flag `GOOGLE_SSO_ENABLED` con default opt-out (`true` salvo `false` explícito)

Delta specs mergeados a `openspec/specs/auth-ui/spec.md` (2 ADDED requirements con scenarios).

## Requirements verificados

| Requirement | Verificación |
|---|---|
| Botón Google visible cuando `googleSsoEnabled === true` | Test `renderiza el botón Google con el data-testid canónico` ✅ |
| Click dispara `window.location.assign` con URL correcta | Test `click en el botón dispara window.location.assign con la URL Google del backend` ✅ |
| 8 códigos mapean a mensajes es-PE | 8 tests parametrizados ✅ |
| Código desconocido cae al fallback `unknown` | Test `ssoError=weird_new_code` ✅ |
| Sin ssoError, sin banner de error | Test `sin ssoError en la ruta, el slot .error no aparece` ✅ |
| Cero hex hardcoded en scss | `grep -nE '#[0-9a-fA-F]{3,8}' src/LR_render/pages/login/login.page.scss` = 0 ✅ |
| Boundaries hexagonales | hexagonal-guard: 0 violaciones ✅ |
| Lint | `npm run lint` = All files pass ✅ |
| Tests | **996 verdes** (984 baseline + 12 nuevos) ✅ |

## Dependencia externa (para deployar)

El botón funciona day-1 cuando el backend learnex tenga mergeado su change de multi-frontend:
- Nueva env var `WEB_PWA_BASE_URL` en learnex
- Soporte de `?app=pwa` en `/t/{slug}/auth/google/start`
- State JWT firma incluye `app` para elegir URL en callback

Mientras tanto, el botón ya está en el DOM y disparará `?app=pwa` al backend. Si el backend viejo no reconoce el param, el flujo redirige a `WEB_TENANT_BASE_URL` (comportamiento actual sin regresión). En dev se puede setear `GOOGLE_SSO_ENABLED=false` en el `.env` de Fiovi para ocultar el botón si molesta.

Ver `openspec/changes/archive/2026-07-09-add-google-sso-login/proposal.md` §Dependencies para detalle.

## Follow-ups documentados

- **PWA standalone iOS**: OAuth redirect puede abrir en Safari system browser en vez de la PWA instalada; cookies quedan fuera de la PWA. Mitigation opcional: detectar `window.matchMedia('(display-mode: standalone)').matches` y ocultar el botón (o warning). No es scope inmediato — mayoría de alumnos usa browser normal.
- **`/config` opcional**: si mañana hay tenants sin Google SSO habilitado, se puede consumir `GET /t/{slug}/auth/google/config` al montar para ocultar el botón dinámicamente. Hoy no aplica (Fiovi = un tenant fijo `vonex` con SSO garantizado).
- **Deep-link recovery**: si el usuario cae en `/login` desde una ruta protegida (via authGuard), no recuperamos ese destino en `returnTo`. Feature opcional futura.
- **`.env.example` docs**: no se pudo editar por permisos del entorno de ejecución. El bloque a agregar manualmente:
  ```
  # GOOGLE_SSO_ENABLED: controla la visibilidad del botón "Continuar con Google"
  # en /login. Opt-out: default true (botón visible). Solo el string literal
  # 'false' (case-insensitive) lo apaga. Útil para ambientes donde el backend
  # learnex aún no soporta el flujo `?app=pwa` + `WEB_PWA_BASE_URL`.
  GOOGLE_SSO_ENABLED=true
  ```

## Verify verdict

**SDD Cycle CLOSED** — change listo para merge a `develop`.
