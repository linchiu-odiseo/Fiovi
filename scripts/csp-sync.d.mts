// Type declarations for `scripts/csp-sync.mjs`, so the spec can import it with
// `allowJs` off in tsconfig.json.

export declare const API_ORIGIN_RE: RegExp;
export declare const REQUIRED_CSP_HOSTS: readonly string[];

export declare class CspSyncError extends Error {
  constructor(message: string);
}

export declare function readCspContent(html: string): string;

export declare function syncApiOrigin(
  html: string,
  apiOrigin: string,
): { html: string; previousOrigin: string; changed: boolean };

export declare function findMissingHosts(csp: string, hosts: readonly string[]): string[];
