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
import { PWA_COOKIE_MODE_STORE } from '../tokens';

// Único interceptor de auth para learnex. Hace tres cosas:
//
// 1. `withCredentials: true` en toda request al `apiBaseUrl` para que el
//    browser envíe/reciba cookies HttpOnly.
//
// 2. Header `X-Client-App: pwa` para separar las cookies de Fiovi de las de
//    web-tenant en el mismo browser (`.learnex.pe`). Backend decide el nombre
//    de cookie a leer/setear (`learnex_tenant_*` vs `learnex_pwa_*`) según
//    este header. Reglas:
//      - `/auth/login` y `/auth/select-tenant` — SIEMPRE mandan el header.
//        Estos endpoints EMITEN cookies en su response (no LEEN cookies para
//        auth), así que el header sirve para que backend emita las cookies
//        `learnex_pwa_*` desde el arranque. Si el login falla, backend NO
//        setea cookies — sin efectos colaterales.
//      - Todos los demás — mandan el header solo si `PwaCookieModeStore.isEnabled()`
//        es true. El flag se prende tras un login/SSO exitoso post-migración,
//        así sesiones vivas al momento del deploy (flag=false) siguen leyendo
//        `learnex_tenant_*` como siempre y NO se desloguean.
//
// 3. Refresh reactivo ante 401 en endpoints protegidos. Lock módulo-level
//    con `shareReplay(1)` para que N requests paralelos con 401 simultáneo
//    solo disparen UN refresh — los demás esperan al mismo Observable.
//    Si el refresh falla con `RefreshFailedError`, dispara `LogoutUseCase`
//    (fire-and-forget, ya navega a /login) y propaga el error al caller.
//
// Sólo `/auth/{login,refresh,logout}` se excluyen del retry: refrescar el
// refresh es un loop; login/logout no requieren sesión previa. Los demás
// endpoints protegidos bajo `/auth/*` (ej. `/auth/me`, `/auth/me/password`)
// SÍ refrescan en 401 como cualquier request de negocio.
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
  const pwaCookieMode = inject(PWA_COOKIE_MODE_STORE);

  const path = req.url.split('?')[0];
  const isRefreshLoop =
    path.endsWith('/auth/refresh') || path.endsWith('/auth/login') || path.endsWith('/auth/logout');
  // Endpoints que EMITEN cookies (no leen para auth): fuerzan el header
  // para que backend emita cookies pwa desde el vamos. Si el login falla,
  // backend no setea cookies y la sesión previa (si la hubiera) queda intacta.
  const isFreshCookieEndpoint =
    path.endsWith('/auth/login') || path.endsWith('/auth/select-tenant');
  const shouldSendPwaHeader = isFreshCookieEndpoint || pwaCookieMode.isEnabled();

  const cloned = req.clone(
    shouldSendPwaHeader
      ? { withCredentials: true, setHeaders: { 'X-Client-App': 'pwa' } }
      : { withCredentials: true },
  );

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
