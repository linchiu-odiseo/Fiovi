// Lee `.env` en la raíz del repo y genera:
//   - `src/environments/environment.ts` y `environment.production.ts`
//   - sincroniza el `connect-src` del CSP en `src/index.html` con el origin
//     derivado de `API_BASE_URL`, para que cambiar `.env` no requiera
//     editar el HTML a mano (el browser bloquearía las requests si el CSP
//     apunta a un origin distinto del que usa el código TS).
//
// Ejecutado automáticamente por los hooks `predev`, `prebuild`, `pretest` de
// `package.json`. Falla con exit 1 si falta `.env` o si quedan variables sin
// reemplazar (placeholders `<...>`), para evitar bundles con secretos vacíos.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const envPath = resolve(repoRoot, '.env');

function parseEnv(raw) {
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

let env;
try {
  env = parseEnv(readFileSync(envPath, 'utf8'));
} catch (err) {
  if (err.code === 'ENOENT') {
    console.error(`✘ No se encontró .env en ${envPath}.`);
    console.error(`  Copia .env.example a .env y rellena los valores.`);
    process.exit(1);
  }
  throw err;
}

// TENANT_SLUG queda deprecado: el slug ahora viene del `user.slug` del
// login response y se persiste en IdentityStorage — Fiovi ya no está atado
// a un único tenant hardcoded. GOOGLE_SSO_ENABLED también sale: los botones
// SSO se renderizan según `GET /auth/sso/providers` (backend decide).
const required = ['API_BASE_URL'];
const missing = required.filter((k) => !env[k] || env[k].startsWith('<'));
if (missing.length) {
  console.error(`✘ Faltan o quedan placeholders en .env: ${missing.join(', ')}`);
  process.exit(1);
}

// APP_VERSION viene de package.json (SemVer del artefacto). Bumpear con
// `npm version patch|minor|major` — no vive en .env porque no es config
// por entorno: es la versión del bundle, la misma en local y en prod.
const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
if (!pkg.version) {
  console.error('✘ package.json no tiene campo "version".');
  process.exit(1);
}
const appVersionValue = pkg.version;

// DRAFT_ENABLED: habilita el auto-save de drafts (POST /draft). Default false
// hasta que el back deploye el endpoint en Docker local. Coerción conservadora:
// solo el string 'true' (case-insensitive) activa el flag; cualquier otro valor
// (ausente, 'false', '0') queda en false.
const draftEnabled = (env['DRAFT_ENABLED'] ?? '').toLowerCase() === 'true';

// DEV_TOOLS: habilita atajos de UI solo útiles para desarrollo (ej. botón dado
// en la cartilla que marca aleatoriamente, atajo "Cartilla prueba" en /home).
// Misma coerción que DRAFT_ENABLED: solo 'true' activa; ausente o cualquier otro
// valor queda en false. Se inyecta en ambos environment.ts para que la señal
// sobreviva a builds prod si alguien quiere hacer un smoke test con las herramientas
// activas — pero en el build de release corresponde dejar DEV_TOOLS=false en .env.
const devTools = (env['DEV_TOOLS'] ?? '').toLowerCase() === 'true';

// AUDIT_LOG_UPLOAD_ENABLED: habilita el AuditLogUploadDispatcher (Fase 1 del
// audit-log — sube periódicamente los logs capturados en Fase 0 al back).
// Default false hasta que learnex tenga desplegado
// POST /t/{slug}/student/telemetry/audit-log-batch. Misma coerción
// conservadora que DRAFT_ENABLED: solo 'true' activa.
const auditLogUploadEnabled = (env['AUDIT_LOG_UPLOAD_ENABLED'] ?? '').toLowerCase() === 'true';

// CAPTCHA_PROVIDER / PUBLIC_CAPTCHA_SITE_KEY: config del captcha anti-bot
// del login. Ambas opcionales:
//   - Sin PUBLIC_CAPTCHA_SITE_KEY (o vacía) → el adapter L3
//     (`CloudflareTurnstileProvider`) reporta `isEnabled()=false` y el
//     LoginPage skipea el widget. El body del login viaja sin `captchaToken`
//     — el backend con `CAPTCHA_SECRET` vacío acepta la request igual. Este
//     es el default de dev sin fricción.
//   - Con site key seteada → el widget renderiza en el LoginPage y el submit
//     queda bloqueado hasta tener token. Prod exige key real de Cloudflare.
// `CAPTCHA_PROVIDER` default 'turnstile' porque es el único soportado hoy;
// existe la var para poder cambiar de proveedor sin tocar código en el futuro.
// El prefijo `PUBLIC_` en la site key marca explícitamente que es material
// público (viaja al bundle del cliente); la secret key vive solo en el back.
const captchaProvider = env['CAPTCHA_PROVIDER'] ?? '';
const captchaSiteKey = env['PUBLIC_CAPTCHA_SITE_KEY'] ?? '';

const envDir = resolve(repoRoot, 'src/environments');
mkdirSync(envDir, { recursive: true });

const banner =
  '// GENERATED by scripts/build-env.mjs from .env + package.json — DO NOT EDIT MANUALLY.\n' +
  '// To change: edit .env (config) or bump package.json version (SemVer), then rerun\n' +
  '// `npm run dev` or `npm run build`.\n';

// Single-quoted string escape — alineado con el estilo Prettier del proyecto.
const sq = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const apiBaseUrl = sq(env.API_BASE_URL);
const appVersion = sq(appVersionValue);
const captchaProviderLit = sq(captchaProvider);
const captchaSiteKeyLit = sq(captchaSiteKey);

writeFileSync(
  resolve(envDir, 'environment.ts'),
  `${banner}\nexport const environment = {\n` +
    `  production: false,\n` +
    `  apiBaseUrl: ${apiBaseUrl},\n` +
    `  appVersion: ${appVersion},\n` +
    `  draftEnabled: ${draftEnabled},\n` +
    `  devTools: ${devTools},\n` +
    `  auditLogUploadEnabled: ${auditLogUploadEnabled},\n` +
    `  captchaProvider: ${captchaProviderLit},\n` +
    `  captchaSiteKey: ${captchaSiteKeyLit},\n` +
    `};\n`,
);

writeFileSync(
  resolve(envDir, 'environment.production.ts'),
  `${banner}\nexport const environment = {\n` +
    `  production: true,\n` +
    `  apiBaseUrl: ${apiBaseUrl},\n` +
    `  appVersion: ${appVersion},\n` +
    `  draftEnabled: ${draftEnabled},\n` +
    `  devTools: ${devTools},\n` +
    `  auditLogUploadEnabled: ${auditLogUploadEnabled},\n` +
    `  captchaProvider: ${captchaProviderLit},\n` +
    `  captchaSiteKey: ${captchaSiteKeyLit},\n` +
    `};\n`,
);

console.log(`✓ Generated src/environments/environment{,.production}.ts from .env`);

// Nota: la inyección de `appData.version` en `ngsw.json` se hace en
// `scripts/inject-ngsw-appdata.mjs`, ejecutado por el hook `postbuild` de
// package.json. NO se hace acá porque `ng build` regenera `ngsw.json` desde
// cero y descartaría la mutación.

// --- Sincronizar CSP del index.html con API_BASE_URL ---
//
// El meta CSP del index.html restringe `connect-src` para mitigar XSS
// roba-bearer. Cuando .env cambia el host de la API, este script reescribe
// el origin que aparece en `connect-src` para que el browser permita las
// requests. Es idempotente: si el origin ya está sincronizado, no toca el
// archivo (evita ruido en git status).

let apiOrigin;
try {
  apiOrigin = new URL(env.API_BASE_URL).origin;
} catch {
  console.error(`✘ API_BASE_URL inválida en .env: "${env.API_BASE_URL}".`);
  process.exit(1);
}

const indexPath = resolve(repoRoot, 'src/index.html');
const indexBefore = readFileSync(indexPath, 'utf8');

// Regex sobre el atributo content del meta CSP. Capta cualquier sub-string
// dentro de `connect-src 'self' <ORIGIN>;` o `connect-src 'self' <ORIGIN>"`
// (último item de la lista de directivas) y lo reemplaza por apiOrigin.
const cspConnectSrcRe = /(connect-src\s+'self'\s+)([^;"']+)/;
const match = indexBefore.match(cspConnectSrcRe);
if (!match) {
  console.error(
    "✘ No se encontró `connect-src 'self' <origin>` en src/index.html. " +
      'Revisar el meta Content-Security-Policy.',
  );
  process.exit(1);
}

const currentOrigin = match[2].trim();
if (currentOrigin === apiOrigin) {
  console.log(`✓ CSP connect-src ya apunta a ${apiOrigin} (sin cambios)`);
} else {
  const indexAfter = indexBefore.replace(cspConnectSrcRe, `$1${apiOrigin}`);
  writeFileSync(indexPath, indexAfter);
  console.log(`✓ CSP connect-src actualizado: ${currentOrigin} → ${apiOrigin}`);
}
