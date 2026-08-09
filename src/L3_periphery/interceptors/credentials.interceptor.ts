import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import {
  catchError,
  defer,
  finalize,
  from,
  map,
  Observable,
  shareReplay,
  switchMap,
  throwError,
} from 'rxjs';
import { environment } from '../../environments/environment';
import { LogoutUseCase } from '../../L2_application/use-cases/logout.use-case';
import { RefreshIdentityUseCase } from '../../L2_application/use-cases/refresh-identity.use-case';
import { RefreshFailedError } from '../../L1_domain/errors/refresh-failed.error';

// Único interceptor de auth para learnex. Hace dos cosas:
//
// 1. `withCredentials: true` en toda request al `apiBaseUrl` para que el
//    browser envíe/reciba cookies HttpOnly (`learnex_tenant_access` y
//    `learnex_tenant_refresh`).
//
// 2. Refresh reactivo ante 401 en endpoints protegidos. Lock módulo-level
//    con `shareReplay(1)` para que N requests paralelos con 401 simultáneo
//    solo disparen UN refresh — los demás esperan al mismo Observable.
//    Si el refresh falla con `RefreshFailedError`, dispara `LogoutUseCase`
//    (fire-and-forget, ya navega a /login) y propaga el error al caller.
//
// Sólo `/auth/{login,refresh,logout}` se excluyen del retry: refrescar el
// refresh es un loop; login/logout no requieren sesión previa. Los demás
// endpoints protegidos bajo `/auth/*` (ej. `/auth/me`, `/auth/me/password`)
// SÍ refrescan en 401 como cualquier request de negocio — así el boot de la
// app tras JWT expirado recupera con el refresh cookie en vez de expulsar
// al login (regresión pre-fix: el `me()` del arranque se propagaba como
// SessionExpiredError aunque el refresh de 7d siguiera vivo).
//
// Requests a hosts distintos de `apiBaseUrl` pasan sin tocarse (dev server,
// assets externos, integraciones futuras).
let refreshInFlight$: Observable<void> | null = null;

function ensureRefreshed(refreshUseCase: RefreshIdentityUseCase): Observable<void> {
  if (refreshInFlight$) {
    return refreshInFlight$;
  }
  refreshInFlight$ = defer(() => from(refreshUseCase.execute())).pipe(
    map(() => undefined),
    shareReplay(1),
    finalize(() => {
      refreshInFlight$ = null;
    }),
  );
  return refreshInFlight$;
}

export const credentialsInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiBaseUrl)) {
    return next(req);
  }

  const refreshUseCase = inject(RefreshIdentityUseCase);
  const logoutUseCase = inject(LogoutUseCase);
  const cloned = req.clone({ withCredentials: true });
  const path = req.url.split('?')[0];
  const isRefreshLoop =
    path.endsWith('/auth/refresh') || path.endsWith('/auth/login') || path.endsWith('/auth/logout');

  return next(cloned).pipe(
    catchError((err) => {
      const isUnauthorized = err instanceof HttpErrorResponse && err.status === 401;
      if (!isUnauthorized || isRefreshLoop) {
        return throwError(() => err);
      }
      return ensureRefreshed(refreshUseCase).pipe(
        switchMap(() => next(cloned)),
        catchError((refreshErr) => {
          if (refreshErr instanceof RefreshFailedError) {
            void logoutUseCase.execute();
          }
          return throwError(() => refreshErr);
        }),
      );
    }),
  );
};
