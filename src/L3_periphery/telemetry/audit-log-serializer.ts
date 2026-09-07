import { Injectable, inject } from '@angular/core';
import { AuditLogStore } from './audit-log-store.service';
import { todayLocalKey } from './day-key';
import type { AuditLogEvent } from './audit-log-event';

// AuditLogSerializer -- serializa el batch del dia actual a NDJSON y dispara
// la descarga en el navegador. Consumido por el item "Descargar logs" del
// menu de /profile.
//
// El armado del payload que se SUBE no vive aca: lo hace el dispatcher al
// sellar cada paquete, porque el batchId tiene que quedar pegado al paquete
// sellado y no regenerarse en cada intento. Lo que comparten es
// `serializeBatchedNdjson`, que es una funcion pura.
//
// Formato flat (serializeToNdjson): una linea JSON por evento, terminada en
// newline. Sin JSON array wrapping (spec REQ-AL-05). Se mantiene exportado
// como forma pura/plana util para debug -- el consumo real (descarga + Fase
// 1) usa el formato batcheado (serializeBatchedNdjson).
//
// Batching (Sub-bloque F, design.md Revision Log 2026-09-04 iteration 2 --
// "senior format"): agrupa TODOS los eventos del batch por (e, s?, u?) --
// sin ventana de tiempo. s entra a la key solo cuando el evento la trae
// (H, SS, AS, NW); u entra a la key solo cuando el evento la trae (H, NW).
// Cada grupo emite una sola linea NDJSON con t0 (minimo t del grupo) y dt
// (delta en ms desde t0) por entrada. Auto-hoist: cualquier campo cuyo
// valor sea identico (deep-equal) en TODAS las entradas del grupo se
// promueve al nivel del grupo. Grupos de 1 entrada TAMBIEN emiten forma
// batcheada -- decision deliberada, ver design.md.
//
// Archivo fiovi-audit-YYYY-MM-DD.ndjson.
//
// Sin dependencia a un ToastService -- usa alert() nativo. Es dev-only en
// Fase 0.

@Injectable({ providedIn: 'root' })
export class AuditLogSerializer {
  private readonly store = inject(AuditLogStore);

  async downloadCurrentDay(): Promise<void> {
    const batch = await this.store.currentDayBatch();
    if (batch.length === 0) {
      alert('Sin logs para hoy');
      return;
    }
    const ndjson = serializeBatchedNdjson(batch);
    const filename = `fiovi-audit-${todayLocalKey()}.ndjson`;
    triggerDownload(ndjson, filename);
  }
}

export function serializeToNdjson(events: readonly AuditLogEvent[]): string {
  if (events.length === 0) return '';
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

// Batcheo del NDJSON de salida (read-side only). AuditLogStore.append no
// cambia: sigue escribiendo 1 registro por evento.
export function serializeBatchedNdjson(events: readonly AuditLogEvent[]): string {
  if (events.length === 0) return '';
  const groups = groupIntoBatches(events);
  return groups.map((g) => JSON.stringify(g)).join('\n') + '\n';
}

// Inversa exacta de serializeBatchedNdjson -- reconstruye la lista plana de
// eventos original a partir del NDJSON batcheado. Reversibilidad 100% es un
// requisito duro (design.md Revision Log iteration 2).
export function parseBatchedNdjson(ndjson: string): AuditLogEvent[] {
  if (!ndjson) return [];
  const lines = ndjson.split('\n').filter((line) => line.length > 0);
  const events: AuditLogEvent[] = [];

  for (const line of lines) {
    const group = JSON.parse(line) as Record<string, unknown>;
    const { x, t0, ...groupFields } = group;
    const entries = (x as Record<string, unknown>[] | undefined) ?? [];

    for (const entry of entries) {
      const { dt, ...entryFields } = entry;
      const t = (t0 as number) + (dt as number);
      const merged: Record<string, unknown> = {
        ...groupFields,
        ...entryFields,
        t,
      };
      events.push(merged as unknown as AuditLogEvent);
    }
  }

  events.sort((a, b) => a.t - b.t);
  return events;
}

// --- batching interno ---

interface BatchGroup {
  readonly e: string;
  readonly s?: string;
  readonly u?: number;
  readonly t0: number;
  readonly x: readonly Record<string, unknown>[];
  readonly [hoisted: string]: unknown;
}

// Agrupa TODOS los eventos por (e, s?, u?) -- sin ventana de tiempo (Sub-
// bloque F). s/u participan de la key solo cuando la INSTANCIA del evento
// los trae.
function groupIntoBatches(events: readonly AuditLogEvent[]): BatchGroup[] {
  const sorted = [...events].sort((a, b) => a.t - b.t);

  const groups = new Map<string, AuditLogEvent[]>();
  for (const ev of sorted) {
    const key = groupKey(ev);
    const existing = groups.get(key);
    if (existing) existing.push(ev);
    else groups.set(key, [ev]);
  }

  const result = [...groups.values()].map(toGroup);
  result.sort((a, b) => a.t0 - b.t0);
  return result;
}

function groupKey(ev: AuditLogEvent): string {
  const rec = fieldsOf(ev);
  const hasS = 's' in rec;
  const hasU = 'u' in rec;
  return JSON.stringify([ev.e, hasS ? rec['s'] : undefined, hasU ? rec['u'] : undefined]);
}

function toGroup(group: readonly AuditLogEvent[]): BatchGroup {
  const t0 = Math.min(...group.map((ev) => ev.t));
  const s = sessionIdOf(group[0]);
  const u = endpointIdOf(group[0]);

  const stripped: Record<string, unknown>[] = group.map((ev) => ({
    dt: ev.t - t0,
    ...withoutFields(ev, ['t', 'e', 's', 'u']),
  }));

  const hoisted = computeHoistedFields(stripped);

  const entries = stripped.map((entry) => {
    const out: Record<string, unknown> = { dt: entry['dt'] };
    for (const key of Object.keys(entry)) {
      if (key === 'dt') continue;
      if (key in hoisted) continue;
      out[key] = entry[key];
    }
    return out;
  });

  return {
    e: group[0].e,
    ...(s !== undefined ? { s } : {}),
    ...(u !== undefined ? { u } : {}),
    t0,
    ...hoisted,
    x: entries,
  };
}

// Auto-hoist: un campo (que no sea dt) se promueve al nivel del grupo
// cuando esta presente en TODAS las entradas con el MISMO valor (deep-equal
// -- cubre chg, arrays de tuplas).
function computeHoistedFields(
  entries: readonly Record<string, unknown>[],
): Record<string, unknown> {
  const keysUnion = new Set<string>();
  for (const entry of entries) {
    for (const key of Object.keys(entry)) {
      if (key !== 'dt') keysUnion.add(key);
    }
  }

  const hoisted: Record<string, unknown> = {};
  for (const key of keysUnion) {
    const presentInAll = entries.every((entry) => key in entry);
    if (!presentInAll) continue;
    const [first, ...rest] = entries.map((entry) => entry[key]);
    if (rest.every((v) => deepEqual(v, first))) {
      hoisted[key] = first;
    }
  }
  return hoisted;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const aRec = a as Record<string, unknown>;
  const bRec = b as Record<string, unknown>;
  const aKeys = Object.keys(aRec);
  const bKeys = Object.keys(bRec);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => deepEqual(aRec[k], bRec[k]));
}

function fieldsOf(ev: AuditLogEvent): Record<string, unknown> {
  return ev as unknown as Record<string, unknown>;
}

function sessionIdOf(ev: AuditLogEvent): string | undefined {
  const s = fieldsOf(ev)['s'];
  return typeof s === 'string' ? s : undefined;
}

function endpointIdOf(ev: AuditLogEvent): number | undefined {
  const u = fieldsOf(ev)['u'];
  return typeof u === 'number' ? u : undefined;
}

function withoutFields(ev: AuditLogEvent, excluded: readonly string[]): Record<string, unknown> {
  const record = fieldsOf(ev);
  const rest: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    if ((excluded as string[]).includes(key)) continue;
    rest[key] = record[key];
  }
  return rest;
}

function triggerDownload(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'application/x-ndjson' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Revoke async para dar tiempo a que el navegador procese el click.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
