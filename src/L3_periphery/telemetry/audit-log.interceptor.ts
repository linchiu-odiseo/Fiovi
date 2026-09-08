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
import {
  DRAFT_DELTA_TOKEN,
  DRAFT_VERSION_TOKEN,
  ENDPOINT_ID_TOKEN,
  MARKS_COUNT_TOKEN,
  SESSION_ID_TOKEN,
} from './tokens';
import type { AlternativaCode, HEvent, NWEvent } from './audit-log-event';

// audit-log.interceptor -- emite evento H por cada request HTTP.
//
// Chained DESPUES de credentialsInterceptor (design Decision 2): asi ve el
// flujo final (200 tras refresh exitoso o 401 final si refresh fallo),
// evita duplicar el request de refresh como si fuera independiente.
//
// El tap sobre la observable NO transforma nada -- solo observa. Si el
// store crashea, el usuario del HttpClient no lo nota.
//
// Endpoints no marcados con ENDPOINT_ID_TOKEN caen en u:0 (unknown).
// Codigos de error no catalogados caen en c:0. Ambos son senales utiles
// en el log crudo (indican "aca falta instrumentar / catalogar").
//
// v/chg (Sub-bloque C, design.md Revision Log 2026-09-04): DRAFT_VERSION_TOKEN
// y DRAFT_DELTA_TOKEN solo los setea HttpExamsApi.guardarDraft -- el
// interceptor unicamente los lee y los propaga al evento H cuando estan
// presentes en el context.

interface ErrorBody {
  code?: unknown;
}

// Lo que el interceptor lee del HttpContext una sola vez, al entrar. Se pasa
// entero a los builders en vez de reenviar cinco parametros sueltos: las dos
// ramas (respuesta y error) arman el mismo evento salvo por el status y el
// codigo, y tener el armado en un solo lugar evita que se desincronicen
// cuando se agregue un campo nuevo.
interface RequestContext {
  readonly endpointId: number;
  readonly marksCount: number | undefined;
  readonly sessionId: string | undefined;
  readonly draftVersion: number | undefined;
  readonly draftDelta: readonly [number, AlternativaCode][] | undefined;
  readonly methodId: number;
}

export const auditLogInterceptor: HttpInterceptorFn = (req, next) => {
  const store = inject(AuditLogStore);
  const start = Date.now();
  const ctx: RequestContext = {
    endpointId: req.context.get(ENDPOINT_ID_TOKEN),
    marksCount: req.context.get(MARKS_COUNT_TOKEN),
    sessionId: req.context.get(SESSION_ID_TOKEN),
    draftVersion: req.context.get(DRAFT_VERSION_TOKEN),
    draftDelta: req.context.get(DRAFT_DELTA_TOKEN),
    methodId: lookupMethod(req.method),
  };

  return next(req).pipe(
    tap((event) => {
      if (event.type !== HttpEventType.Response) return;
      const response = event as HttpResponse<unknown>;
      store.append(buildHEvent(ctx, response.status, start));
    }),
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse) {
        store.append(buildHEvent(ctx, err.status, start, extractCodeId(err.error)));

        if (err.status === 0) {
          // NetworkError -- la request nunca llego al back. Se emite un NW
          // adicional para simplificar deteccion server-side.
          store.append(buildNWEvent(ctx));
        }
      }
      return throwError(() => err);
    }),
  );
};

function buildHEvent(ctx: RequestContext, status: number, start: number, codeId = 0): HEvent {
  return {
    t: Date.now(),
    e: 'H',
    m: ctx.methodId,
    u: ctx.endpointId,
    st: status,
    dur: Date.now() - start,
    ...(codeId !== 0 ? { c: codeId } : {}),
    ...(ctx.marksCount !== undefined ? { d: ctx.marksCount } : {}),
    ...(ctx.sessionId !== undefined ? { s: ctx.sessionId } : {}),
    ...(ctx.draftVersion !== undefined ? { v: ctx.draftVersion } : {}),
    ...(ctx.draftDelta !== undefined ? { chg: ctx.draftDelta } : {}),
  };
}

function buildNWEvent(ctx: RequestContext): NWEvent {
  return {
    t: Date.now(),
    e: 'NW',
    u: ctx.endpointId,
    ...(ctx.sessionId !== undefined ? { s: ctx.sessionId } : {}),
  };
}

function extractCodeId(body: unknown): number {
  if (body === null || typeof body !== 'object') return 0;
  const code = (body as ErrorBody).code;
  return typeof code === 'string' ? lookupErrorCode(code) : 0;
}
