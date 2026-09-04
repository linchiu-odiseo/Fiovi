import { HttpContextToken } from '@angular/common/http';
import type { AlternativaCode } from './audit-log-event';

// Tokens de HttpContext consumidos por el audit-log interceptor.
//
// Cada adapter HTTP marca sus requests con context: new HttpContext().set(...)
// para que el interceptor pueda emitir el evento H con el endpoint ID correcto,
// el sessionId (cuando aplica) y la marks count (para drafts/submits).
//
// Default 0 en ENDPOINT_ID_TOKEN es una senal util: los H|u:0 en el log
// dicen "aca hay un endpoint sin catalogar", visible al inspeccionar sin
// necesidad de leer cada adapter.
//
// DRAFT_VERSION_TOKEN / DRAFT_DELTA_TOKEN (Sub-bloque C, design.md Revision
// Log 2026-09-04): seteados solo por HttpExamsApi.guardarDraft, leidos por
// el interceptor para poblar HEvent.v / HEvent.chg.

export const ENDPOINT_ID_TOKEN = new HttpContextToken<number>(() => 0);
export const MARKS_COUNT_TOKEN = new HttpContextToken<number | undefined>(() => undefined);
export const SESSION_ID_TOKEN = new HttpContextToken<string | undefined>(() => undefined);
export const DRAFT_VERSION_TOKEN = new HttpContextToken<number | undefined>(() => undefined);
export const DRAFT_DELTA_TOKEN = new HttpContextToken<
  readonly [number, AlternativaCode][] | undefined
>(() => undefined);
