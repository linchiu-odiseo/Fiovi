// Tests for the SPA page_view bridge.
//
// The privacy case is the reason this class exists: `app.routes.ts` carries
// real exam, classroom, period and record IDs in the URL, so the tracker must
// report the DECLARED route path and never `router.url`. A fake analytics
// service records what it was asked to send.

import { beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { Router, provideRouter } from '@angular/router';

import { AnalyticsRouteTracker } from '../../../../src/L3_periphery/analytics/analytics-route-tracker';
import { GoogleAnalyticsService } from '../../../../src/L3_periphery/analytics/google-analytics.service';

@Component({ standalone: true, template: '' })
class DummyComponent {}

class FakeGoogleAnalyticsService {
  enabled = true;
  readonly pageViews: string[] = [];

  isEnabled(): boolean {
    return this.enabled;
  }

  trackPageView(routeTemplate: string): void {
    this.pageViews.push(routeTemplate);
  }
}

describe('AnalyticsRouteTracker', () => {
  let analytics: FakeGoogleAnalyticsService;
  let tracker: AnalyticsRouteTracker;
  let router: Router;

  function setUp(enabled: boolean): void {
    analytics = new FakeGoogleAnalyticsService();
    analytics.enabled = enabled;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'student/home', component: DummyComponent },
          { path: 'student/simulacro/:id', component: DummyComponent },
          {
            path: 'tutor/aulas/:classroomId/semanas/:periodId',
            component: DummyComponent,
          },
          { path: 'home', pathMatch: 'full', redirectTo: '/student/home' },
        ]),
        { provide: GoogleAnalyticsService, useValue: analytics },
      ],
    });
    router = TestBed.inject(Router);
    tracker = TestBed.inject(AnalyticsRouteTracker);
  }

  beforeEach(() => {
    setUp(true);
  });

  it('does not subscribe when analytics is disabled', async () => {
    setUp(false);
    tracker.start();

    await router.navigateByUrl('/student/home');

    expect(analytics.pageViews).toEqual([]);
  });

  it('reports a static route as itself', async () => {
    tracker.start();

    await router.navigateByUrl('/student/home');

    expect(analytics.pageViews).toEqual(['/student/home']);
  });

  it('reports the route template of an ID-bearing route, never the ID', async () => {
    tracker.start();

    await router.navigateByUrl('/student/simulacro/abc-123');

    expect(analytics.pageViews).toEqual(['/student/simulacro/:id']);
    expect(analytics.pageViews[0]).not.toContain('abc-123');
  });

  it('reports every segment of a multi-ID route as templates', async () => {
    tracker.start();

    await router.navigateByUrl('/tutor/aulas/c1/semanas/p2');

    expect(analytics.pageViews).toEqual(['/tutor/aulas/:classroomId/semanas/:periodId']);
    expect(analytics.pageViews[0]).not.toContain('c1');
  });

  it('reports the resolved route after a redirect', async () => {
    tracker.start();

    await router.navigateByUrl('/home');

    expect(analytics.pageViews).toEqual(['/student/home']);
  });

  it('is idempotent — calling start() twice sends one page_view per navigation', async () => {
    tracker.start();
    tracker.start();

    await router.navigateByUrl('/student/home');

    expect(analytics.pageViews).toEqual(['/student/home']);
  });
});
