import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Subscription, filter } from 'rxjs';

import { GoogleAnalyticsService } from './google-analytics.service';

// Turns Angular navigations into GA `page_view` hits.
//
// It reads the route TEMPLATE from the snapshot instead of `router.url`
// because the real routes carry identifiers (`student/simulacro/:id`,
// `tutor/aulas/:classroomId/semanas/:periodId`) and none of them may reach
// Google. Reading the snapshot after `NavigationEnd` also means redirects are
// already resolved, so the legacy `/home` reports `/student/home`.
@Injectable({ providedIn: 'root' })
export class AnalyticsRouteTracker {
  private readonly router = inject(Router);
  private readonly analytics = inject(GoogleAnalyticsService);

  private subscription: Subscription | null = null;

  start(): void {
    if (this.subscription !== null) return;
    if (!this.analytics.isEnabled()) return;

    this.subscription = this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => this.analytics.trackPageView(this.routeTemplate()));
  }

  stop(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }

  private routeTemplate(): string {
    let node = this.router.routerState.snapshot.root;
    const segments: string[] = [];
    // Written as a descent even though the routes are flat today, so adding
    // children later does not silently truncate the template.
    while (node.firstChild) {
      node = node.firstChild;
      const path = node.routeConfig?.path ?? '';
      if (path.length > 0) segments.push(path);
    }
    return `/${segments.join('/')}`;
  }
}
