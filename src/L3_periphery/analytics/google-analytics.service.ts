import { Injectable, inject } from '@angular/core';

import { environment } from '../../environments/environment';
import { BrowserInstallEnvironmentProbe } from '../pwa/browser-install-environment-probe';
import { ExamActivity } from '../telemetry/exam-activity.service';

const GTAG_SCRIPT_BASE = 'https://www.googletagmanager.com/gtag/js';

// GA4 adapter. Answers three questions and nothing else: how many people
// arrive, from what devices, and how many install the PWA. It has no L1 port
// on purpose — no use case tracks anything, both call sites live in L3.
//
// The `dataLayer`/`gtag` bootstrap is bundled TypeScript rather than the stock
// inline snippet because adding `'unsafe-inline'` to `script-src` would undo
// the reason the CSP exists (see the comment in `src/index.html`). The only
// external file is `gtag/js`, injected as a `<script src>` the same way
// `CloudflareTurnstileProvider` loads Turnstile — a host allowlist entry, not
// an inline exemption.
//
// Nothing that identifies a student may leave the device: no user id, no
// tenant slug, no exam/classroom/record id, no answers. `trackPageView`
// receives a route TEMPLATE and `page_location` is rebuilt from it instead of
// letting gtag read `document.location`, which is also why the property is
// configured with `send_page_view: false` — the automatic first hit would
// leak the real URL of a deep link before anything could scrub it.
//
// Every entry point is a no-op when the measurement ID is empty, while an
// exam is in progress, or when `gtag` is missing because the request was
// blocked. A blocked load is normal operation, not an error: measured traffic
// is a floor, not a census.
@Injectable({ providedIn: 'root' })
export class GoogleAnalyticsService {
  private readonly examActivity = inject(ExamActivity);
  // Concrete class, not the `INSTALL_ENV_PROBE` token: both are `providedIn:
  // 'root'` and this keeps the L3 → L3 dependency resolvable from specs that
  // build a TestBed without knowing about analytics.
  private readonly installEnvironment = inject(BrowserInstallEnvironmentProbe);
  private readonly measurementId = environment.gaMeasurementId ?? '';

  private enabled = false;
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    if (this.measurementId.length === 0) return;
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    try {
      this.bootstrapGtag();
      this.injectScript();
      this.enabled = true;
    } catch {
      // A failed bootstrap leaves analytics off and the app untouched.
      this.enabled = false;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  trackPageView(routeTemplate: string): void {
    if (!this.canEmit()) return;
    try {
      window.gtag?.('event', 'page_view', {
        page_path: routeTemplate,
        page_location: `${window.location.origin}${routeTemplate}`,
        page_referrer: this.pageReferrer(),
        display_mode: this.displayMode(),
      });
    } catch {
      // Fail-silent: GA must never change how the app behaves.
    }
  }

  trackPwaInstall(): void {
    if (!this.canEmit()) return;
    try {
      window.gtag?.('event', 'pwa_install', { display_mode: this.displayMode() });
    } catch {
      // Fail-silent.
    }
  }

  private canEmit(): boolean {
    if (!this.enabled) return false;
    // Same gate `AuditLogUploadScheduler` uses: a student sitting an exam
    // sends no telemetry of any kind.
    if (this.examActivity.isActive()) return false;
    return typeof window !== 'undefined' && typeof window.gtag === 'function';
  }

  private bootstrapGtag(): void {
    window.dataLayer = window.dataLayer ?? [];
    if (typeof window.gtag !== 'function') {
      // Must be a `function` pushing its `arguments` object: gtag.js
      // distinguishes `arguments` from a real Array when it parses dataLayer
      // commands, and a plain Array is not reliably read as a command. An
      // arrow with rest params would push an Array.
      window.gtag = function gtag() {
        // eslint-disable-next-line prefer-rest-params
        window.dataLayer?.push(arguments);
      };
    }
    window.gtag('js', new Date());
    window.gtag('config', this.measurementId, { send_page_view: false });
  }

  private injectScript(): void {
    const script = document.createElement('script');
    script.async = true;
    script.src = `${GTAG_SCRIPT_BASE}?id=${encodeURIComponent(this.measurementId)}`;
    script.addEventListener(
      'error',
      () => {
        // Ad blocker, school filter or plain network failure. `dataLayer`
        // would otherwise keep growing with commands nobody will ever read.
        this.enabled = false;
      },
      { once: true },
    );
    document.head.appendChild(script);
  }

  private displayMode(): 'standalone' | 'browser' {
    // `appinstalled` never fires on iOS, so an installed iOS student is only
    // visible as a session running standalone.
    return this.installEnvironment.isStandalone() ? 'standalone' : 'browser';
  }

  private pageReferrer(): string {
    const referrer = document.referrer;
    // An internal referrer is just the previous route of the same student —
    // it can carry a real ID. Cross-origin referrers stay: they are the
    // answer to "how do people arrive".
    return referrer.startsWith(window.location.origin) ? '' : referrer;
  }
}
