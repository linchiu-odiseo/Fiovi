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

import {
  CspSyncError,
  REQUIRED_CSP_HOSTS,
  findMissingHosts,
  readCspContent,
  syncApiOrigin,
} from './csp-sync.mjs';

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

// PUBLIC_GA_MEASUREMENT_ID: measurement ID de Google Analytics 4. Opcional y
// vacía por default, igual que la site key del captcha: con la var vacía el
// adapter L3 (`GoogleAnalyticsService`) no inyecta el script de Google, no
// define `dataLayer`/`gtag` y todos sus entry points son no-op. El prefijo
// `PUBLIC_` marca que es material público (viaja al bundle del cliente).
// Dev/staging debe usar su propio data stream para no ensuciar la propiedad
// de producción.
const gaMeasurementId = env['PUBLIC_GA_MEASUREMENT_ID'] ?? '';

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
const gaMeasurementIdLit = sq(gaMeasurementId);

writeFileSync(
  resolve(envDir, 'environment.ts'),
  `${banner}\nexport const environment = {\n` +
    `  production: false,\n` +
    `  apiBaseUrl: ${apiBaseUrl},\n` +
    `  appVersion: ${appVersion},\n` +
    `  draftEnabled: ${draftEnabled},\n` +
    `  devTools: ${devTools},\n` +
    `  captchaProvider: ${captchaProviderLit},\n` +
    `  captchaSiteKey: ${captchaSiteKeyLit},\n` +
    `  gaMeasurementId: ${gaMeasurementIdLit},\n` +
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
    `  captchaProvider: ${captchaProviderLit},\n` +
    `  captchaSiteKey: ${captchaSiteKeyLit},\n` +
    `  gaMeasurementId: ${gaMeasurementIdLit},\n` +
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
//
// La lógica de regex vive en `scripts/csp-sync.mjs` (pura, testeada en
// `tests/unit/scripts/csp-sync.spec.ts`); acá queda solo la I/O y el fallo
// ruidoso. El reemplazo toca EXACTAMENTE el primer host después de `'self'`:
// la versión anterior se comía toda la cola de la directiva y borraba en
// silencio cualquier otro host (los de GA4) en cada predev/prebuild/pretest.

let apiOrigin;
try {
  apiOrigin = new URL(env.API_BASE_URL).origin;
} catch {
  console.error(`✘ API_BASE_URL inválida en .env: "${env.API_BASE_URL}".`);
  process.exit(1);
}

const indexPath = resolve(repoRoot, 'src/index.html');
const indexBefore = readFileSync(indexPath, 'utf8');

let synced;
try {
  synced = syncApiOrigin(indexBefore, apiOrigin);
} catch (err) {
  if (err instanceof CspSyncError) {
    console.error(`✘ ${err.message}.`);
    process.exit(1);
  }
  throw err;
}

if (synced.changed) {
  writeFileSync(indexPath, synced.html);
  console.log(`✓ CSP connect-src actualizado: ${synced.previousOrigin} → ${apiOrigin}`);
} else {
  console.log(`✓ CSP connect-src ya apunta a ${apiOrigin} (sin cambios)`);
}

// Guard del fallo que este cambio existe para evitar: que el sync deje el CSP
// sin los hosts de GA4. Se chequea contra el atributo `content` del meta, NO
// contra el HTML entero: el comentario de arriba nombra esos hosts y un
// `includes` sobre todo el archivo pasaría con la directiva vacía.
const missingHosts = findMissingHosts(readCspContent(synced.html), REQUIRED_CSP_HOSTS);
if (missingHosts.length) {
  console.error(
    `✘ Faltan hosts requeridos en el CSP de src/index.html: ${missingHosts.join(', ')}.`,
  );
  console.error('  Revisar el meta Content-Security-Policy y scripts/csp-sync.mjs.');
  process.exit(1);
}
