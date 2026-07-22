# learnex — Contrato consumido por Fiovi

> **Fuente de verdad para subagentes** (`frontend-builder`, `test-engineer`).
> Cualquier adapter en `src/L3_periphery/http/` debe cumplir este contrato.
> Histórico: `openspec/changes/archive/2026-06-11-add-auth-login/api-contract-request.md` (Fase 1, API-FAKE), `openspec/changes/archive/2026-06-12-cartilla-fase-2/design.md` (Fase 2, cartilla), `openspec/changes/2026-06-14-fase-3-login-learnex/proposal.md` (Fase 3, migración).

## Resumen ejecutivo

**learnex** es el backend real del producto (NestJS + Postgres). Multi-tenant — el slug viaja en el path `/t/{slug}/...`. Slug actual de dev: `vonex`. Auth basada en **cookies HttpOnly** + `withCredentials: true` (cero Bearer, cero API-Key). Contrato auth completo verificado contra learnex al 2026-06-13 en `.authentic/pwa-auth-contract.md`.

**Estado de Fase 3 (en curso):**

- ✅ Auth + profile migrados (cambio `fase-3-login-learnex`).
- ⚠️ Cartilla (`/simulacros`, envío de marcaciones) **ROTA en runtime** — el contrato API-FAKE de la sección "Cartilla (legacy)" más abajo queda preservado solo como referencia hasta que `fase-3-exam-learnex` migre los endpoints a learnex.

## Valores de entorno

| Variable       | Origen                            | Dev                     |
| -------------- | --------------------------------- | ----------------------- |
| `API_BASE_URL` | `.env` → `environment.apiBaseUrl` | `http://localhost:2001` |
| `TENANT_SLUG`  | `.env` → `environment.tenantSlug` | `vonex`                 |

URLs se arman SIEMPRE vía `src/L3_periphery/http/api-paths.ts`. Cualquier mención literal de `"vonex"` o `/t/vonex/...` en `src/` está prohibida.

Credenciales seed dev:

- Alumno: `79507732@vonex.edu.pe` / `79507732`.
- Tutor: `tutor1@vonex.pe` / `tutor123`.

## Headers

### Request

| Header         | Cuándo            | Valor              |
| -------------- | ----------------- | ------------------ |
| `Content-Type` | Requests con body | `application/json` |

**`withCredentials: true`** lo agrega el interceptor `credentials.interceptor.ts` a TODA request al `apiBaseUrl` — el browser envía/recibe cookies HttpOnly de learnex (`learnex_tenant_access`, `learnex_tenant_refresh`). Ningún otro código maneja auth headers.

### Response

learnex setea cookies `Set-Cookie` con `HttpOnly; Secure; SameSite=Lax/None` (según env del back). El cliente NO las lee — el browser las gestiona. Tras `POST /auth/login` y `POST /auth/refresh`, el body trae además el shape `{user, expiresAt}` para que el cliente conozca la identity sin tocar la cookie.

## Auth endpoints (Fase 3 — learnex)

### `POST /t/{slug}/auth/login` — público

Request body:

```json
{ "email": "79507732@vonex.edu.pe", "password": "79507732" }
```

Response 200 (alumno):

```json
{
  "user": {
    "id": "766aac21-71f9-4f48-a14a-5c2bcebc7d0b",
    "tenantId": "5fff5eec-34dc-40a2-b15e-10e503e7c2dc",
    "email": "79507732@vonex.edu.pe",
    "codigo": "79507732",
    "roles": ["student"],
    "permissions": ["student:dashboard:view", "student:exams:view", "..."]
  },
  "expiresAt": 1781458612856
}
```

> El campo `permissions[]` viaja en el body pero Fiovi lo ignora en el mapper (F5-03 — no se hornea en `Identity` ni en `localStorage`). La autorización efectiva es server-side (RLS + guards). No agregar consumo de `permissions` en cliente sin discutir alternativas primero.

Response 200 (tutor): mismo shape, `roles: ["tutor"]`, `codigo: null` (caso observado).

Invariante: `roles.length === 1` en este producto.

Errores:

- 401 + `{code: "TENANT_AUTH_INVALID_CREDENTIALS"}` → `InvalidCredentialsError`.
- 401 sin code conocido → `InvalidCredentialsError` (anti-enumeration).
- 429 → `RateLimitError` (5 req/min/IP).
- 0 / 5xx → `NetworkError`.

### `POST /t/{slug}/auth/refresh` — semi-público

Sin body. Cookie `learnex_tenant_refresh` viaja en el request automáticamente.

Response 200: mismo shape que login (rota cookies + body con identity actualizada).

Errores:

- 401 + `{code: "TENANT_AUTH_REFRESH_TOKEN_INVALID"}` → `RefreshFailedError` → cliente dispara `LogoutUseCase` + redirect a `/login`.
- 401 + `{code: "TENANT_AUTH_REFRESH_TOKEN_MISSING"}` → mismo.
- 0 / 5xx → `NetworkError`.

### `POST /t/{slug}/auth/logout` — protegido

Sin body. Response 204. El server limpia cookies con `Max-Age=0`.

Best-effort en el cliente: si falla por red o 5xx, `LogoutUseCase` igual continúa con limpieza local.

### `GET /t/{slug}/auth/me` — protegido

Sin body. Response 200: mismo shape que login (identity actualizada con `expiresAt` nuevo si la cookie todavía es válida).

Errores:

- 401 → `SessionExpiredError` → cliente va a `/login` (sin intentar refresh — el interceptor salta refresh para URLs `/auth/`).
- 0 / 5xx → `NetworkError`.

Disparado por AppInitializer al arrancar.

### `GET /t/{slug}/student/me` — protegido (rol student)

Sin body. Response 200:

```json
{
  "id": "573e8dfa-faf4-4846-b05f-14143710515d",
  "code": "79507732",
  "firstName": "Gabriel",
  "lastName": "Acuña Acuña",
  "area": null
}
```

- `id` = `Student.id` (NO `TenantUser.id` del login).
- `code` = DNI del alumno.
- `area` puede ser `null` si el alumno aún no rindió examen.

Errores:

- 401 → `SessionExpiredError`.
- 403 / 404 → `ProfileNotAvailableError` (user con rol pero sin fila en `students`).
- 0 / 5xx → `NetworkError`.

### `GET /t/{slug}/tutor/me` — protegido (rol tutor)

Sin body. Response 200:

```json
{
  "id": "19cabb89-c81d-4882-91be-3ab0e1414fae",
  "code": "T001",
  "firstName": "Carlos",
  "lastName": "Mendoza",
  "email": "tutor1@vonex.pe",
  "classrooms": [
    {
      "id": "a957e020-...",
      "code": "LIMA0001",
      "name": "Lima 01",
      "modality": "presencial",
      "shift": "manana",
      "campusName": "Lima Cercado",
      "cycleId": "...",
      "cycleName": "San Marcos - Semi Anual 0326",
      "studentCount": 60
    }
  ]
}
```

- `id` = `Tutor.id` (NO `TenantUser.id`).
- `code` = código interno del tutor (NO un DNI).
- `email` puede diferir del email de login.
- `classrooms` puede ser `[]` (tutor sin aulas asignadas — empty state en UI).

Errores: idénticos a `/student/me`.

## Cartilla (legacy — API-FAKE, **ROTA en runtime**)

> ⚠️ **Esta sección queda como referencia hasta que `fase-3-exam-learnex` migre los endpoints a learnex.** Tras `fase-3-login-learnex`, los siguientes endpoints **no existen** en el backend activo (`localhost:2001`). El código actual de la cartilla (use cases `Obtener…`, `Marcar…`, `Enviar…` y el adapter `HttpSimulacrosApi`) sigue apuntando a paths inexistentes — la app no puede listar simulacros ni enviar marcaciones hasta el change siguiente.

### `GET /simulacros` — protegido (Fase 2, contra API-FAKE)

Response 200:

```json
{
  "serverTime": "2026-06-12T08:15:05-05:00",
  "simulacros": [
    {
      "id": "uuid-or-string",
      "area": "Matemática",
      "name": "Simulacro 03",
      "count": 20,
      "inicio": "2026-06-12T08:00:00-05:00",
      "fin": "2026-06-12T09:00:00-05:00",
      "estado": "pendiente | abierto | enviado | cerrado"
    }
  ]
}
```

### `POST /simulacros/:id/envio` — protegido (Fase 2, contra API-FAKE)

Request:

```json
{ "answers": { "1": "C", ... }, "clientSubmittedAt": "2026-06-12T08:47:00-05:00" }
```

Responses: 200 (aceptado), 409 (idempotencia, tratar como éxito), 400 (`INVALID_TIME` o `INVALID_SHAPE`), 403 (`CLOSED`), 404, 401.

Para detalles completos, ver `openspec/changes/archive/2026-06-12-cartilla-fase-2/design.md`.

## Mapeo HTTP → errores de dominio (L3 → L1)

### Auth (Fase 3 — learnex)

| Origen                                                                   | Error L1 emitido                                                           | Mensaje UI                                             |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------ |
| `POST /auth/login` → `401` + `code: TENANT_AUTH_INVALID_CREDENTIALS`     | `InvalidCredentialsError`                                                  | "Credenciales inválidas"                               |
| `POST /auth/login` → `401` sin code                                      | `InvalidCredentialsError`                                                  | "Credenciales inválidas"                               |
| `POST /auth/login` → `429`                                               | `RateLimitError`                                                           | "Demasiados intentos, esperá un minuto."               |
| `POST /auth/login` → `5xx` o network                                     | `NetworkError`                                                             | "No se pudo conectar al servidor. Inténtalo de nuevo." |
| `POST /auth/refresh` → `401` + `code: TENANT_AUTH_REFRESH_TOKEN_INVALID` | `RefreshFailedError` (interceptor dispara logout + redirect)               | (silencioso)                                           |
| `POST /auth/refresh` → `401` + `code: TENANT_AUTH_REFRESH_TOKEN_MISSING` | `RefreshFailedError`                                                       | (silencioso)                                           |
| `GET /auth/me` → `401`                                                   | `SessionExpiredError`                                                      | (AppInitializer va a `/login`)                         |
| Cualquier endpoint protegido (no `/auth/*`) → `401`                      | Interceptor refresca + reintenta. Si refresh falla → `RefreshFailedError`. | (transparente para el caller)                          |
| `GET /{role}/me` → `403` o `404`                                         | `ProfileNotAvailableError`                                                 | (UI degradada: solo email)                             |
| `POST /auth/logout` → cualquier error                                    | (best-effort, sin error)                                                   | n/a (limpieza local procede igual)                     |

**Regla crítica:** clasificar SIEMPRE por `(status, endpoint, code)` donde `code` viene del zod del back (campo `code` del body de error, valores conocidos: `TENANT_AUTH_*`). **PROHIBIDO** leer `message` (texto humano volátil, cambia sin aviso).

### Cartilla (legacy — preservado como referencia hasta migración)

Ver tabla original en `openspec/changes/archive/2026-06-12-cartilla-fase-2/design.md`. Los errores `InvalidSubmissionTimeError`, `InvalidPayloadError`, `SimulacroCerradoError`, `SimulacroNoAsignadoError` siguen definidos en L1 pero no se disparan hoy (los endpoints no existen).

## CORS

learnex en dev tiene `app.enableCors({ origin: true, credentials: true })` — acepta cualquier origin con credenciales. El dev server Angular (`http://localhost:4200`) está cubierto sin configuración extra.

Para prod (cuando se defina dominio): pedir al equipo learnex pasar a allowlist explícita + `SameSite=None; Secure` en las cookies.

## Comportamientos confirmados en dev

- **Cookies HttpOnly**: el server las setea en login y refresh; el browser las envía con `withCredentials: true`; el cliente nunca las lee directamente.
- **TTL JWT**: 15 minutos por defecto (`learnex_tenant_access`). Refresh cookie: 7 días (`learnex_tenant_refresh`). Durante un examen de 2h se refrescan ~8 veces silenciosamente.
- **Single-role invariant**: cada user del producto tiene exactamente 1 rol. La entidad `Identity` valida esto en el constructor.
- **`codigo` para tutor**: observado como `null` en producción (el contrato sugería que tendría valor; preferimos `Profile.code` para mostrar DNI/Código en UI).

## Fuera de contrato

- Pre-emptive refresh timer (postergado hasta acordar TTL más largo con learnex).
- Endpoints de examen learnex (bloqueado, en proceso para `fase-3-exam-learnex`).
- Multi-tenant runtime por hostname (por ahora una build = un tenant via env var).
- Registro, recuperación de contraseña, MFA.
- Resultados / historial post-envío.
