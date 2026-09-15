// Pure helpers for keeping the CSP meta tag of `src/index.html` in sync with
// `API_BASE_URL`. No I/O, no `console`, no `process.exit` — `build-env.mjs`
// owns all of that, and these functions stay importable from a spec without
// running the build.
//
// Why they exist at all: the previous inline regex in `build-env.mjs` captured
// the whole `connect-src` tail, so every `predev`/`prebuild`/`pretest` run
// replaced every host after `'self'` with the API origin. Any extra host (the
// GA4 ones) disappeared with no error anywhere.

// Owns exactly one host token: `[^\s;"']+` stops at the first whitespace.
// INVARIANT this introduces: the API origin must always be the FIRST host
// after `'self'` in `connect-src`.
export const API_ORIGIN_RE = /(connect-src\s+'self'\s+)(https?:\/\/[^\s;"']+)/;

// Hosts that must survive the rewrite. One entry per distinct host token —
// the check is substring presence in the CSP content, so a token covers every
// directive it appears in (`script-src`, `connect-src`, `img-src`).
export const REQUIRED_CSP_HOSTS = [
  'https://www.googletagmanager.com',
  'https://*.google-analytics.com',
  'https://*.analytics.google.com',
];

// The captured quote char is back-referenced because the CSP value itself is
// full of single quotes (`'self'`, `'none'`): a `[^"']*` class would stop at
// the first `'` and return `default-src `.
const CSP_META_RE =
  /<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*content=(["'])([\s\S]*?)\1[^>]*>/i;

export class CspSyncError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CspSyncError';
  }
}

// Returns the `content="…"` value of the CSP meta tag. Scoping every check to
// this value (instead of the whole file) is deliberate: the comment above the
// meta tag names the Google hosts, and a naive `html.includes(host)` would
// pass against the comment while the directive itself was empty.
export function readCspContent(html) {
  const match = html.match(CSP_META_RE);
  if (!match) {
    throw new CspSyncError(
      'No Content-Security-Policy meta tag with a content attribute found in src/index.html',
    );
  }
  return match[2];
}

export function syncApiOrigin(html, apiOrigin) {
  const match = html.match(API_ORIGIN_RE);
  if (!match) {
    throw new CspSyncError(
      "No `connect-src 'self' <origin>` found in src/index.html — check the " +
        'Content-Security-Policy meta tag',
    );
  }
  const previousOrigin = match[2];
  if (previousOrigin === apiOrigin) {
    return { html, previousOrigin, changed: false };
  }
  return {
    html: html.replace(API_ORIGIN_RE, `$1${apiOrigin}`),
    previousOrigin,
    changed: true,
  };
}

export function findMissingHosts(csp, hosts) {
  return hosts.filter((host) => !csp.includes(host));
}
