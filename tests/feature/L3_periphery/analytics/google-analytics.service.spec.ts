// Tests for the L3 GA4 adapter.
//
// The bootstrap (`window.dataLayer` + `window.gtag`) is our own bundled code,
// so in jsdom everything up to the external `gtag/js` request is real: the
// assertions read the commands the service pushed into `window.dataLayer`.
// The external script is never loaded — which is also the point, since a
// blocked or missing `gtag/js` must leave the app untouched.
//
// `vi.mock` does not work for relative imports under the Angular unit-test
// builder, so `environment` is mutated in `beforeEach` and the service is
// rebuilt per test (same approach as `cloudflare-turnstile-provider.spec.ts`).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { GoogleAnalyticsService } from '../../../../src/L3_periphery/analytics/google-analytics.service';
import { BrowserInstallEnvironmentProbe } from '../../../../src/L3_periphery/pwa/browser-install-environment-probe';
import { ExamActivity } from '../../../../src/L3_periphery/telemetry/exam-activity.service';
import { environment } from '../../../../src/environments/environment';

interface MutableEnv {
  gaMeasurementId: string;
}

const MEASUREMENT_ID = 'G-TEST12345';
const GTAG_SCRIPT_SELECTOR = 'script[src^="https://www.googletagmanager.com/gtag/js"]';

const originalGaMeasurementId = environment.gaMeasurementId;

function gtagScripts(): HTMLScriptElement[] {
  return Array.from(document.querySelectorAll<HTMLScriptElement>(GTAG_SCRIPT_SELECTOR));
}

// Every dataLayer entry is an `arguments` object, not an array — that is the
// shape gtag.js expects. Normalize it for assertions.
function commands(): unknown[][] {
  const dataLayer = (window as { dataLayer?: unknown[] }).dataLayer ?? [];
  return dataLayer.map((entry) => Array.from(entry as ArrayLike<unknown>));
}

function eventsNamed(name: string): Record<string, unknown>[] {
  return commands()
    .filter((command) => command[0] === 'event' && command[1] === name)
    .map((command) => (command[2] ?? {}) as Record<string, unknown>);
}

function setReferrer(value: string): void {
  Object.defineProperty(document, 'referrer', { value, configurable: true });
}

function cleanupDom(): void {
  gtagScripts().forEach((script) => script.remove());
  const w = window as { dataLayer?: unknown[]; gtag?: unknown };
  delete w.dataLayer;
  delete w.gtag;
  setReferrer('');
}

describe('GoogleAnalyticsService', () => {
  let analytics: GoogleAnalyticsService;
  let examActivity: ExamActivity;
  let installProbe: BrowserInstallEnvironmentProbe;

  function build(measurementId: string): void {
    (environment as MutableEnv).gaMeasurementId = measurementId;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    examActivity = TestBed.inject(ExamActivity);
    installProbe = TestBed.inject(BrowserInstallEnvironmentProbe);
    vi.spyOn(installProbe, 'isStandalone').mockReturnValue(false);
    analytics = TestBed.inject(GoogleAnalyticsService);
  }

  beforeEach(() => {
    cleanupDom();
    build(MEASUREMENT_ID);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanupDom();
    TestBed.resetTestingModule();
    (environment as MutableEnv).gaMeasurementId = originalGaMeasurementId;
  });

  describe('with an empty measurement ID', () => {
    beforeEach(() => {
      build('');
      analytics.start();
    });

    it('injects no script and defines neither dataLayer nor gtag', () => {
      expect(gtagScripts()).toHaveLength(0);
      expect((window as { gtag?: unknown }).gtag).toBeUndefined();
      expect((window as { dataLayer?: unknown }).dataLayer).toBeUndefined();
      expect(analytics.isEnabled()).toBe(false);
    });

    it('no-ops on trackPageView and trackPwaInstall without throwing', () => {
      expect(() => analytics.trackPageView('/student/home')).not.toThrow();
      expect(() => analytics.trackPwaInstall()).not.toThrow();
      expect((window as { dataLayer?: unknown }).dataLayer).toBeUndefined();
    });
  });

  describe('start()', () => {
    it('injects exactly one async gtag script pointing at the measurement ID', () => {
      analytics.start();

      const scripts = gtagScripts();
      expect(scripts).toHaveLength(1);
      expect(scripts[0].src).toBe(`https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`);
      expect(scripts[0].async).toBe(true);
      expect(analytics.isEnabled()).toBe(true);
    });

    it('is idempotent — calling it twice leaves a single script tag', () => {
      analytics.start();
      analytics.start();

      expect(gtagScripts()).toHaveLength(1);
    });

    it('configures the property with send_page_view: false and sends no page_view', () => {
      analytics.start();

      const config = commands().find(
        (command) => command[0] === 'config' && command[1] === MEASUREMENT_ID,
      );
      expect(config).toBeDefined();
      expect(config?.[2]).toMatchObject({ send_page_view: false });
      expect(eventsNamed('page_view')).toHaveLength(0);
    });

    it('defines gtag as a function that pushes an arguments object, not an array', () => {
      analytics.start();

      const gtag = (window as { gtag?: unknown }).gtag;
      expect(typeof gtag).toBe('function');
      const dataLayer = (window as { dataLayer?: unknown[] }).dataLayer ?? [];
      expect(dataLayer.length).toBeGreaterThan(0);
      expect(Array.isArray(dataLayer[0])).toBe(false);
    });
  });

  describe('when the gtag script fails to load', () => {
    it('stops emitting after the error event', () => {
      analytics.start();
      const pushedOnBootstrap = commands().length;

      gtagScripts()[0].dispatchEvent(new Event('error'));

      analytics.trackPageView('/student/home');
      analytics.trackPwaInstall();

      expect(analytics.isEnabled()).toBe(false);
      expect(commands()).toHaveLength(pushedOnBootstrap);
    });
  });

  describe('when gtag disappears after load (ad blocker)', () => {
    it('no-ops without throwing', () => {
      analytics.start();
      delete (window as { gtag?: unknown }).gtag;

      expect(() => analytics.trackPageView('/student/home')).not.toThrow();
      expect(() => analytics.trackPwaInstall()).not.toThrow();
    });
  });

  describe('trackPageView', () => {
    it('sends the route template as page_path and page_location', () => {
      analytics.start();
      analytics.trackPageView('/student/simulacro/:id');

      const [payload] = eventsNamed('page_view');
      expect(payload).toMatchObject({
        page_path: '/student/simulacro/:id',
        page_location: `${window.location.origin}/student/simulacro/:id`,
      });
    });

    it("reports display_mode 'standalone' when the app runs installed", () => {
      vi.spyOn(installProbe, 'isStandalone').mockReturnValue(true);
      analytics.start();
      analytics.trackPageView('/student/home');

      expect(eventsNamed('page_view')[0]).toMatchObject({ display_mode: 'standalone' });
    });

    it("reports display_mode 'browser' when the app runs in a tab", () => {
      analytics.start();
      analytics.trackPageView('/student/home');

      expect(eventsNamed('page_view')[0]).toMatchObject({ display_mode: 'browser' });
    });

    it('strips a same-origin referrer', () => {
      setReferrer(`${window.location.origin}/login`);
      analytics.start();
      analytics.trackPageView('/student/home');

      expect(eventsNamed('page_view')[0]).toMatchObject({ page_referrer: '' });
    });

    it('keeps a cross-origin referrer — that is how arrivals are measured', () => {
      setReferrer('https://www.google.com/');
      analytics.start();
      analytics.trackPageView('/student/home');

      expect(eventsNamed('page_view')[0]).toMatchObject({
        page_referrer: 'https://www.google.com/',
      });
    });
  });

  describe('trackPwaInstall', () => {
    it('emits a pwa_install event', () => {
      analytics.start();
      analytics.trackPwaInstall();

      expect(eventsNamed('pwa_install')).toHaveLength(1);
    });
  });

  describe('while an exam is in progress', () => {
    it('emits neither page_view nor pwa_install, and resumes once it ends', () => {
      analytics.start();
      examActivity.markStarted();

      analytics.trackPageView('/student/simulacro/:id');
      analytics.trackPwaInstall();

      expect(eventsNamed('page_view')).toHaveLength(0);
      expect(eventsNamed('pwa_install')).toHaveLength(0);

      examActivity.markEnded();
      analytics.trackPageView('/student/home');

      expect(eventsNamed('page_view')).toHaveLength(1);
    });
  });
});
