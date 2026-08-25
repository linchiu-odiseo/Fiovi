import { Injectable, inject } from '@angular/core';
import { AuditLogStore } from './audit-log-store.service';
import { todayLocalKey } from './day-key';
import type { AuditLogEvent } from './audit-log-event';

// AuditLogSerializer — serializa el batch del día actual a NDJSON y dispara
// la descarga en el navegador. Consumido por el item "Descargar logs" del
// menú de /profile (Fase 0).
//
// Formato: una línea JSON por evento, terminada en `\n`. Sin JSON array
// wrapping (spec REQ-AL-05). Archivo `fiovi-audit-YYYY-MM-DD.ndjson`.
//
// Sin dependencia a un ToastService — usa alert() nativo. Es dev-only en
// Fase 0; cuando el item se promueva a UI de tutor real (si aplica), se
// reemplaza por el sistema de toasts.

@Injectable({ providedIn: 'root' })
export class AuditLogSerializer {
  private readonly store = inject(AuditLogStore);

  async downloadCurrentDay(): Promise<void> {
    const batch = await this.store.currentDayBatch();
    if (batch.length === 0) {
      alert('Sin logs para hoy');
      return;
    }
    const ndjson = serializeToNdjson(batch);
    const filename = `fiovi-audit-${todayLocalKey()}.ndjson`;
    triggerDownload(ndjson, filename);
  }
}

export function serializeToNdjson(events: readonly AuditLogEvent[]): string {
  if (events.length === 0) return '';
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n';
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
