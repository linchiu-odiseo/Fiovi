// Tests for the pure CSP-sync helpers extracted out of `scripts/build-env.mjs`.
//
// The bug these guard against: the old inline regex owned the whole
// `connect-src` tail, so every `predev`/`prebuild`/`pretest` run silently
// deleted any host that was not the API origin — including the GA4 hosts.
// The helpers live in `scripts/csp-sync.mjs` (no I/O, no `process.exit`) so
// they can be exercised here without running the build script's side effects.

import { describe, expect, it } from 'vitest';

import {
  API_ORIGIN_RE,
  CspSyncError,
  REQUIRED_CSP_HOSTS,
  findMissingHosts,
  readCspContent,
  syncApiOrigin,
} from '../../../scripts/csp-sync.mjs';
import { readIndexHtml } from './read-index-html.mjs';

function htmlWith(cspContent: string): string {
  return [
    '<!doctype html>',
    '<html lang="es-PE">',
    '  <head>',
    '    <meta charset="utf-8" />',
    '    <meta',
    '      http-equiv="Content-Security-Policy"',
    `      content="${cspContent}"`,
    '    />',
    '  </head>',
    '  <body></body>',
    '</html>',
  ].join('\n');
}

const GA_LESS_CSP =
  "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; " +
  "connect-src 'self' https://api.yangpimpollo.com; img-src 'self' data:; object-src 'none'";

const GA_CSP =
  "default-src 'self'; script-src 'self' https://challenges.cloudflare.com " +
  'https://www.googletagmanager.com; ' +
  "connect-src 'self' https://api.yangpimpollo.com https://*.google-analytics.com " +
  'https://*.analytics.google.com https://www.googletagmanager.com; ' +
  "img-src 'self' data: https://*.google-analytics.com https://www.googletagmanager.com; " +
  "object-src 'none'";

describe('readCspContent', () => {
  it('extracts the content attribute of the CSP meta tag', () => {
    expect(readCspContent(htmlWith(GA_LESS_CSP))).toBe(GA_LESS_CSP);
  });

  it('throws CspSyncError when the CSP meta tag is absent', () => {
    const html = '<!doctype html>\n<html>\n  <head></head>\n</html>';
    expect(() => readCspContent(html)).toThrow(CspSyncError);
  });
});

describe('syncApiOrigin', () => {
  it('replaces only the first host token and preserves the rest of connect-src', () => {
    const result = syncApiOrigin(htmlWith(GA_CSP), 'https://api.new.com');

    expect(result.changed).toBe(true);
    expect(result.previousOrigin).toBe('https://api.yangpimpollo.com');

    const csp = readCspContent(result.html);
    expect(csp).toContain(
      "connect-src 'self' https://api.new.com https://*.google-analytics.com " +
        'https://*.analytics.google.com https://www.googletagmanager.com;',
    );
    expect(csp).not.toContain('https://api.yangpimpollo.com');
    // El resto de directivas queda intacto.
    expect(csp).toContain("img-src 'self' data: https://*.google-analytics.com");
    expect(csp).toContain("object-src 'none'");
  });

  it('works against the current GA-less CSP shape', () => {
    const result = syncApiOrigin(htmlWith(GA_LESS_CSP), 'https://api.new.com');

    expect(result.changed).toBe(true);
    expect(readCspContent(result.html)).toContain(
      "connect-src 'self' https://api.new.com; img-src 'self' data:;",
    );
  });

  it('reports changed: false and returns the html untouched when already synced', () => {
    const html = htmlWith(GA_CSP);
    const result = syncApiOrigin(html, 'https://api.yangpimpollo.com');

    expect(result.changed).toBe(false);
    expect(result.previousOrigin).toBe('https://api.yangpimpollo.com');
    expect(result.html).toBe(html);
  });

  it("throws CspSyncError when `connect-src 'self' <origin>` is missing", () => {
    const html = htmlWith("default-src 'self'; connect-src 'self'; object-src 'none'");
    expect(() => syncApiOrigin(html, 'https://api.new.com')).toThrow(CspSyncError);
  });

  it('API_ORIGIN_RE owns a single host token', () => {
    const match = GA_CSP.match(API_ORIGIN_RE);
    expect(match?.[2]).toBe('https://api.yangpimpollo.com');
  });
});

describe('findMissingHosts', () => {
  it('returns an empty list when every required host is present', () => {
    expect(findMissingHosts(GA_CSP, REQUIRED_CSP_HOSTS)).toEqual([]);
  });

  it('returns only the missing hosts', () => {
    const csp = GA_CSP.split(' https://*.analytics.google.com').join('');
    expect(findMissingHosts(csp, REQUIRED_CSP_HOSTS)).toEqual(['https://*.analytics.google.com']);
  });

  it('does not count a host that only appears inside an HTML comment', () => {
    const html = [
      '<!doctype html>',
      '<html>',
      '  <head>',
      '    <!--',
      '      Los hosts de Google (https://*.google-analytics.com,',
      '      https://*.analytics.google.com, https://www.googletagmanager.com) estan',
      '      documentados aca pero NO estan en la directiva.',
      '    -->',
      '    <meta',
      '      http-equiv="Content-Security-Policy"',
      `      content="${GA_LESS_CSP}"`,
      '    />',
      '  </head>',
      '</html>',
    ].join('\n');

    expect(html).toContain('https://www.googletagmanager.com');
    expect(findMissingHosts(readCspContent(html), REQUIRED_CSP_HOSTS)).toEqual([
      'https://www.googletagmanager.com',
      'https://*.google-analytics.com',
      'https://*.analytics.google.com',
    ]);
  });
});

describe('regression: the real src/index.html survives a sync', () => {
  it('keeps every REQUIRED_CSP_HOSTS entry after syncApiOrigin', () => {
    const html = readIndexHtml();

    expect(findMissingHosts(readCspContent(html), REQUIRED_CSP_HOSTS)).toEqual([]);

    const result = syncApiOrigin(html, 'https://api.some-other-origin.test');
    const csp = readCspContent(result.html);

    expect(findMissingHosts(csp, REQUIRED_CSP_HOSTS)).toEqual([]);
    expect(csp).toContain("connect-src 'self' https://api.some-other-origin.test ");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  });
});
