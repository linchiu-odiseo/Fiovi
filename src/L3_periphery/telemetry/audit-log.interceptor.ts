import {
  HttpErrorResponse,
  HttpEventType,
  HttpInterceptorFn,
  HttpResponse,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, tap, throwError } from 'rxjs';
import { AuditLogStore } from './audit-log-store.service';
import { lookupErrorCode, lookupMethod } from './audit-log-dictionaries';
import { ENDPOINT_ID_TOKEN, MARKS_COUNT_TOKEN, SESSION_ID_TOKEN } from './tokens';
import type { HEvent, NWEvent } from './audit-log-event';

// audit-log.interceptor — emite evento H por cada request HTTP.
//
// Chained DESPUÉS de credentialsInterceptor (design Decision 2): así ve el
// flujo final (200 tras refresh exitoso o 401 final si refresh falló),
// evita duplicar el request de refresh como si fuera independiente.
//
// El `tap` sobre la observable NO transforma nada — solo observa. Si el
// store crashea, el usuario del HttpClient no lo nota.
//
// Endpoints no marcados con ENDPOINT_ID_TOKEN caen en u:0 (unknown).
// Códigos de error no catalogados caen en c:0. Ambos son señales útiles
// en el log crudo (indican "acá falta instrumentar / catalogar").

interface ErrorBody {
  code?: unknown;
}

export const auditLogInterceptor: HttpInterceptorFn = (req, next) => {
  const store = inject(AuditLogStore);
  const start = Date.now();
  const endpointId = req.context.get(ENDPOINT_ID_TOKEN);
  const marksCount = req.context.get(MARKS_COUNT_TOKEN);
  const sessionId = req.context.get(SESSION_ID_TOKEN);
  const methodId = lookupMethod(req.method);

  return next(req).pipe(
    tap((event) => {
      if (event.type !== HttpEventType.Response) return;
      const response = event as HttpResponse<unknown>;
      const h: HEvent = {
        t: Date.now(),
        e: 'H',
        m: methodId,
        u: endpointId,
        st: response.status,
        dur: Date.now() - start,
        ...(marksCount !== undefined ? { d: marksCount } : {}),
        ...(sessionId !== undefined ? { s: sessionId } : {}),
      };
      store.append(h);
    }),
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse) {
        const codeId = extractCodeId(err.error);
        const h: HEvent = {
          t: Date.now(),
          e: 'H',
          m: methodId,
          u: endpointId,
          st: err.status,
          dur: Date.now() - start,
          ...(codeId !== 0 ? { c: codeId } : {}),
          ...(marksCount !== undefined ? { d: marksCount } : {}),
          ...(sessionId !== undefined ? { s: sessionId } : {}),
        };
        store.append(h);

        if (err.status === 0) {
          // NetworkError — la request nunca llegó al back. Se emite un NW
          // adicional para simplificar detección server-side.
          const nw: NWEvent = {
            t: Date.now(),
            e: 'NW',
            u: endpointId,
            ...(sessionId !== undefined ? { s: sessionId } : {}),
          };
          store.append(nw);
        }
      }
      return throwError(() => err);
    }),
  );
};

function extractCodeId(body: unknown): number {
  if (body === null || typeof body !== 'object') return 0;
  const code = (body as ErrorBody).code;
  return typeof code === 'string' ? lookupErrorCode(code) : 0;
}
