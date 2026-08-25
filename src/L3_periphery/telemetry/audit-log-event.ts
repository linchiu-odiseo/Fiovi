// Schema de eventos capturados por el audit-log de Fiovi (Fase 0).
//
// Los tipos están discriminados por `e` (event code) para permitir narrowing
// en el switch del serializer y del rollup futuro.
//
// Todos los campos usan keys de 1-3 chars para minimizar peso crudo (spec
// REQ-AL-05). No hay strings de dominio libres ni PII — solo IDs numéricos,
// timestamps, códigos alfanuméricos cortos y valores enum controlados.

export type AlternativaCode = 'A' | 'B' | 'C' | 'D' | 'E' | '0';

// SS — session start. Emitido cuando el alumno abre una sesión de examen.
export interface SSEvent {
  readonly t: number;
  readonly e: 'SS';
  readonly s: string;
}

// MK — mark. Emitido en cada marcación/desmarcación de pregunta.
export interface MKEvent {
  readonly t: number;
  readonly e: 'MK';
  readonly s: string;
  readonly q: number;
  readonly a: AlternativaCode;
}

// H — HTTP request. Emitido por el interceptor para toda request saliente.
// `c` opcional: código de error numérico (solo cuando st >= 400 y body trae `code`).
// `d` opcional: marks count al momento del fire (solo draft/submit).
// `s` opcional: sessionId (solo endpoints session-scoped).
export interface HEvent {
  readonly t: number;
  readonly e: 'H';
  readonly m: number;
  readonly u: number;
  readonly st: number;
  readonly dur: number;
  readonly c?: number;
  readonly d?: number;
  readonly s?: string;
}

// NW — network error. Emitido cuando la request falla sin llegar al back
// (status === 0). Se emite ADEMÁS del H con st:0, para simplificar detección
// server-side del caso "el back nunca lo vio".
export interface NWEvent {
  readonly t: number;
  readonly e: 'NW';
  readonly u: number;
  readonly s?: string;
}

// VC — visibility change. v:0 hidden, v:1 visible.
export interface VCEvent {
  readonly t: number;
  readonly e: 'VC';
  readonly v: 0 | 1;
}

// OF — offline/online toggle. o:0 offline, o:1 online.
export interface OFEvent {
  readonly t: number;
  readonly e: 'OF';
  readonly o: 0 | 1;
}

// RT — refresh token attempt. Emitido cuando credentialsInterceptor dispara refresh en 401.
export interface RTEvent {
  readonly t: number;
  readonly e: 'RT';
  readonly st: number;
  readonly c?: number;
}

// AO — app open. cold:1 cold-start, cold:0 warm (reload).
export interface AOEvent {
  readonly t: number;
  readonly e: 'AO';
  readonly cold: 0 | 1;
}

// AI — app install. mode "standalone" (se está corriendo instalada) o
// "prompt-accepted" (acaba de aceptar el prompt de instalación).
export interface AIEvent {
  readonly t: number;
  readonly e: 'AI';
  readonly mode: 'standalone' | 'prompt-accepted';
}

// DP — device profile. Emitido 1× por día junto al primer AO.
export interface DPEvent {
  readonly t: number;
  readonly e: 'DP';
  readonly ram: number | null;
  readonly cores: number | null;
  readonly screen: string;
  readonly dpr: number;
}

// AS — auto-submit fired. Emitido cuando el timer de auto-envío dispara
// el submit (por tiempo cumplido), inmediatamente antes del POST. Permite
// distinguir en el análisis "el alumno envió manualmente" (SB después de
// click) de "el timer envió por vencimiento" (AS + H u:21 consecutivos).
// Sin este evento, ambos flujos producen el mismo H de submit y no se
// puede diferenciar en reclamos post-facto.
export interface ASEvent {
  readonly t: number;
  readonly e: 'AS';
  readonly s: string;
}

export type AuditLogEvent =
  | SSEvent
  | MKEvent
  | HEvent
  | NWEvent
  | VCEvent
  | OFEvent
  | RTEvent
  | AOEvent
  | AIEvent
  | DPEvent
  | ASEvent;

export type EventCode = AuditLogEvent['e'];
