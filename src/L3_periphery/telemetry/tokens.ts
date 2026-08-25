import { HttpContextToken } from '@angular/common/http';

// Tokens de HttpContext consumidos por el audit-log interceptor.
//
// Cada adapter HTTP marca sus requests con `context: new HttpContext().set(...)`
// para que el interceptor pueda emitir el evento H con el endpoint ID correcto,
// el sessionId (cuando aplica) y la marks count (para drafts/submits).
//
// Default `0` en ENDPOINT_ID_TOKEN es una señal útil: los `H|u:0` en el log
// dicen "acá hay un endpoint sin catalogar", visible al inspeccionar sin
// necesidad de leer cada adapter.

export const ENDPOINT_ID_TOKEN = new HttpContextToken<number>(() => 0);
export const MARKS_COUNT_TOKEN = new HttpContextToken<number | undefined>(() => undefined);
export const SESSION_ID_TOKEN = new HttpContextToken<string | undefined>(() => undefined);
