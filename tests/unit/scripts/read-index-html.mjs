// The regression case in `csp-sync.spec.ts` has to run against the real
// `src/index.html`, not a fixture. The file read lives here, in plain `.mjs`,
// because `@types/node` is not a dependency of this repo and
// `tsconfig.spec.json` restricts `types` to `vitest/globals` — so `node:fs`
// and `process` have no typings inside a `.spec.ts`. Same `.mjs` + `.d.mts`
// pairing the change already uses for `scripts/csp-sync.mjs`.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function readIndexHtml() {
  return readFileSync(resolve(process.cwd(), 'src/index.html'), 'utf8');
}
