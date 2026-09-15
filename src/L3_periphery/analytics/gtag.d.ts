// Global typing for the gtag.js command queue. Unlike Turnstile, the globals
// are defined by our own bootstrap (`GoogleAnalyticsService`) before the
// external `gtag/js` file exists — the script only takes over the queue.
// `dataLayer` holds `arguments` objects, not arrays, hence `unknown[]`.

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

// Without `export {}` TS would treat this `.d.ts` as a global script and the
// `declare global` block would be redundant (same as `captcha/turnstile.d.ts`).
export {};
