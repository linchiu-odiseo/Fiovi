// Post-build hook: inyecta `appData.version` en cada `ngsw.json` generado por
// `ng build`. La versión SemVer se lee de `package.json.version`.
//
// ¿Por qué postbuild y no parte de scripts/build-env.mjs?
// `ng build` regenera `ngsw.json` desde cero y descarta cualquier mutación
// previa. Tenemos que correr después del build. El hook `postbuild` en
// package.json se ejecuta automáticamente tras `npm run build`.
//
// `appData` es un campo arbitrario que Angular expone en `VersionEvent.appData`
// vía `SwUpdate.versionUpdates`. El cliente lo lee para mostrar SemVer humano
// (1.0.0) en el modal de actualización, en lugar del hash del SW (a3f2b9c...).
//
// Silencioso si no encuentra `ngsw.json` (caso development/test). Falla con
// exit 1 si `package.json.version` está ausente o si la mutación rompe.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
if (!pkg.version) {
  console.error('✘ postbuild: package.json no tiene campo "version".');
  process.exit(1);
}
const appVersion = pkg.version;

const distRoot = resolve(repoRoot, 'dist');
if (!existsSync(distRoot)) {
  // Caso normal en development/test — no se generó dist/.
  process.exit(0);
}

let mutated = 0;
for (const projectDir of readdirSync(distRoot)) {
  const ngswCandidate = join(distRoot, projectDir, 'browser', 'ngsw.json');
  if (!existsSync(ngswCandidate) || !statSync(ngswCandidate).isFile()) continue;
  try {
    const ngsw = JSON.parse(readFileSync(ngswCandidate, 'utf8'));
    ngsw.appData = { ...(ngsw.appData ?? {}), version: appVersion };
    writeFileSync(ngswCandidate, `${JSON.stringify(ngsw, null, 2)}\n`);
    console.log(`✓ ngsw.json appData.version = ${appVersion} (${ngswCandidate})`);
    mutated += 1;
  } catch (err) {
    console.error(`✘ Error inyectando appData en ${ngswCandidate}: ${err.message}`);
    process.exit(1);
  }
}

if (mutated === 0) {
  console.log('postbuild: no ngsw.json found in dist/, skipping');
}
