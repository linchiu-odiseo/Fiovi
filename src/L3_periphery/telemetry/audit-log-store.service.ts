import { Injectable } from '@angular/core';
import { AuditLogEvent } from './audit-log-event';
import { startOfTodayLocalMs, todayLocalKey } from './day-key';

// AuditLogStore — captura local de eventos audit-log.
//
// Retención = "hasta que se suban", con un techo de MAX_AGE_DAYS.
//
// El modelo anterior (Fase 0) borraba TODO el store en el primer append de
// cada día. Eso era correcto mientras la única salida era el botón de
// descarga manual ("los logs de hoy"), pero rompe Fase 1 de la peor forma:
// el alumno que cierra la app a las 6pm y la abre a las 8am del día
// siguiente perdía lo no subido ANTES de que el dispatcher pudiera correr,
// porque los listeners emiten un AO en el arranque y ese append disparaba
// la rotación. La pérdida no era una carrera improbable: era segura.
//
// Ahora el evento vive hasta que alguien confirme que llegó al back
// (`clearRange`), y el techo de edad existe solo para que el store no
// crezca sin límite si las subidas nunca prosperan. La poda se dispara con
// el mismo mecanismo barato de antes — el cambio de day-key en meta — así
// que sigue corriendo como mucho una vez por día, sin scheduler.
//
// `append` es fire-and-forget async: el llamador no espera IDB, las
// excepciones (incluso QuotaExceededError) se cachan silenciosamente.
// La telemetría es best-effort por diseño (design Decision 8).

const DB_NAME = 'fiovi-audit-log';
const DB_VERSION = 2;
const STORE_EVENTS = 'events';
const STORE_META = 'meta';
const STORE_PACKAGES = 'packages';
const META_DAY_KEY = 'dayKey';

// Un paquete sellado: el payload ya serializado y (normalmente) comprimido,
// listo para subir, con su `batchId` definitivo.
//
// El id se asigna al SELLAR, no al intentar subir. Antes se generaba uno
// nuevo en cada intento, así que un reintento mandaba los mismos eventos con
// otro id y el dedup del back — que es por batchId — no servía de nada: un
// POST que llegaba pero cuya respuesta se perdía terminaba en dos filas.
export interface AuditLogPackage {
  readonly batchId: string;
  /** base64 de gzip, o del NDJSON crudo cuando `enc` es 'none'. */
  readonly payload: string;
  readonly enc: 'gzip' | 'none';
  readonly eventCount: number;
  readonly sealedAt: number;
}

// Techo de retención local. Un evento que no se pudo subir en una semana ya
// no le sirve a nadie: los reclamos que esto respalda aparecen el mismo día
// o al siguiente. Existe para acotar el IndexedDB del alumno cuando las
// subidas fallan de forma sostenida (sin conexión, backend caído, cliente
// sin soporte de compresión), no como política de negocio.
const MAX_AGE_DAYS = 7;
const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class AuditLogStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  // Cola serial de appends. Sin esto, varios `append` disparados de corrido
  // (el arranque emite AO + DP + AI casi en el mismo tick) corren en paralelo,
  // todos leen el day-key ANTES de que el primero lo actualice, y todos creen
  // que les toca podar — con lo que una poda puede pasar por encima de un
  // evento que otro append ya escribió. Encadenarlos también es lo que hace
  // que el orden de inserción sea el cronológico y no el del scheduler.
  private tail: Promise<void> = Promise.resolve();

  // Fire-and-forget. No retorna Promise: el llamador (view-model, interceptor,
  // listener) no debe esperar IDB. Excepciones cachadas silenciosamente.
  append(event: AuditLogEvent): void {
    this.tail = this.tail.then(() =>
      this.doAppend(event).catch(() => {
        // Silenciamos QuotaExceededError, VersionError, y cualquier fallo de IDB.
        // La telemetría es best-effort por diseño — perder un evento no rompe la app.
        // El catch va acá adentro para que un fallo no corte la cola.
      }),
    );
  }

  // Eventos de HOY (desde las 00:00 locales), en orden cronológico ascendente.
  //
  // Filtra de verdad por día: desde que el store retiene varios días, no
  // alcanza con devolver todo y confiar en que la rotación dejó solo lo de
  // hoy. Sin este filtro, la descarga manual mezclaría días y el chequeo de
  // "¿ya emití DP hoy?" de los listeners daría true para siempre, apagando
  // esos eventos a partir del segundo día.
  async currentDayBatch(): Promise<AuditLogEvent[]> {
    const startOfToday = startOfTodayLocalMs();
    return this.readEvents((ev) => ev.t >= startOfToday);
  }

  // Eventos en [sinceMs, untilMs) — half-open, simétrico con `clearRange`.
  // Es lo que consume el camino de subida, que necesita mirar más atrás del
  // día actual (justamente el caso "cerró a las 6pm, abre al día siguiente").
  async eventsInRange(sinceMs: number, untilMs: number): Promise<AuditLogEvent[]> {
    return this.readEvents((ev) => ev.t >= sinceMs && ev.t < untilMs);
  }

  // Eventos pendientes de sellar, con su clave primaria de IDB.
  //
  // La clave importa: al sellar borramos exactamente estos registros por id,
  // no un rango de tiempo. Un evento que aterrice mientras se serializa o se
  // sube simplemente no entra en este paquete y queda para el siguiente — con
  // borrado por rango, en cambio, se lo llevaba puesto sin haberlo subido.
  async pendingEvents(): Promise<{ key: IDBValidKey; event: AuditLogEvent }[]> {
    try {
      const db = await this.db();
      return await new Promise<{ key: IDBValidKey; event: AuditLogEvent }[]>((resolve, reject) => {
        const tx = db.transaction(STORE_EVENTS, 'readonly');
        const req = tx.objectStore(STORE_EVENTS).openCursor();
        const out: { key: IDBValidKey; event: AuditLogEvent }[] = [];
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) {
            resolve(out);
            return;
          }
          out.push({ key: cursor.primaryKey, event: cursor.value as AuditLogEvent });
          cursor.continue();
        };
        req.onerror = () => reject(req.error ?? new Error('IDB cursor error'));
      });
    } catch {
      return [];
    }
  }

  // Sella un paquete: guarda el payload listo para subir y borra en el MISMO
  // tick de IDB los eventos que lo componen. Una sola transacción sobre los
  // dos object stores, así que o queda todo o no queda nada — nunca un
  // paquete sin sus eventos borrados (duplicaría) ni eventos borrados sin
  // paquete (los perdería).
  //
  // La compresión NO puede ir acá adentro: una transacción de IDB se cierra
  // sola en cuanto el microtask queue se vacía sin pedidos pendientes, y
  // `CompressionStream` es asíncrono. Por eso el caller comprime antes y esta
  // función solo escribe.
  async sealPackage(pkg: AuditLogPackage, eventKeys: readonly IDBValidKey[]): Promise<void> {
    const db = await this.db();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_EVENTS, STORE_PACKAGES], 'readwrite');
      tx.objectStore(STORE_PACKAGES).put(pkg);
      const events = tx.objectStore(STORE_EVENTS);
      for (const key of eventKeys) events.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IDB seal error'));
      tx.onabort = () => reject(tx.error ?? new Error('IDB tx aborted'));
    });
  }

  // Paquetes sellados esperando subida, del más viejo al más nuevo.
  async pendingPackages(): Promise<AuditLogPackage[]> {
    try {
      const db = await this.db();
      const all = await new Promise<AuditLogPackage[]>((resolve, reject) => {
        const tx = db.transaction(STORE_PACKAGES, 'readonly');
        const req = tx.objectStore(STORE_PACKAGES).getAll();
        req.onsuccess = () => resolve((req.result ?? []) as AuditLogPackage[]);
        req.onerror = () => reject(req.error ?? new Error('IDB getAll error'));
      });
      return all.sort((a, b) => a.sealedAt - b.sealedAt);
    } catch {
      return [];
    }
  }

  // Se invoca tras un 2xx, o cuando el back rechaza el paquete de forma
  // definitiva (un 4xx que ningún reintento va a arreglar).
  async deletePackage(batchId: string): Promise<void> {
    try {
      const db = await this.db();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_PACKAGES, 'readwrite');
        tx.objectStore(STORE_PACKAGES).delete(batchId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IDB delete package error'));
        tx.onabort = () => reject(tx.error ?? new Error('IDB tx aborted'));
      });
    } catch {
      // Silencioso -- no propagamos errores de IDB.
    }
  }

  // Borra eventos y paquetes más viejos que MAX_AGE_DAYS. Público para que un
  // test pueda dispararlo sin depender del cambio de día; en runtime lo invoca
  // `doAppend` cuando detecta que rotó el day-key.
  async pruneExpired(now: number = Date.now()): Promise<void> {
    const cutoff = now - MAX_AGE_MS;
    await this.deleteEvents((ev) => ev.t < cutoff);
    // Los paquetes también caducan: si no, un alumno que nunca logra subir
    // (sin conexión crónica, alumno no vinculado en el back) los acumularía
    // para siempre aunque sus eventos originales ya se hayan podado.
    for (const pkg of await this.pendingPackages()) {
      if (pkg.sealedAt < cutoff) await this.deletePackage(pkg.batchId);
    }
  }

  // --- privados ---

  private async doAppend(event: AuditLogEvent): Promise<void> {
    const db = await this.db();
    const currentKey = todayLocalKey();
    const storedKey = await this.readMetaDayKey(db);
    if (storedKey !== currentKey) {
      // Cambió el día (o es el primer append de la instalación). Único
      // momento en que se poda: barato, como mucho una vez por día.
      await this.writeMetaDayKey(db, currentKey);
      try {
        await this.pruneExpired();
      } catch {
        // Una poda fallida NO puede costarnos el evento que veníamos a
        // guardar — el put sigue igual abajo.
      }
    }
    await this.putEvent(db, event);
  }

  private async readEvents(keep: (ev: AuditLogEvent) => boolean): Promise<AuditLogEvent[]> {
    try {
      const db = await this.db();
      return await new Promise<AuditLogEvent[]>((resolve, reject) => {
        const tx = db.transaction(STORE_EVENTS, 'readonly');
        const store = tx.objectStore(STORE_EVENTS);
        const req = store.openCursor();
        const out: AuditLogEvent[] = [];
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) {
            resolve(out);
            return;
          }
          const ev = cursor.value as AuditLogEvent;
          if (keep(ev)) out.push(ev);
          cursor.continue();
        };
        req.onerror = () => reject(req.error ?? new Error('IDB cursor error'));
      });
    } catch {
      return [];
    }
  }

  private async deleteEvents(matches: (ev: AuditLogEvent) => boolean): Promise<void> {
    try {
      const db = await this.db();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_EVENTS, 'readwrite');
        const store = tx.objectStore(STORE_EVENTS);
        const req = store.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return;
          if (matches(cursor.value as AuditLogEvent)) {
            cursor.delete();
          }
          cursor.continue();
        };
        req.onerror = () => reject(req.error ?? new Error('IDB cursor error'));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IDB delete error'));
        tx.onabort = () => reject(tx.error ?? new Error('IDB tx aborted'));
      });
    } catch {
      // Silencioso -- no propagamos errores de IDB.
    }
  }

  private async db(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    if (typeof indexedDB === 'undefined') {
      throw new TypeError('IndexedDB no está disponible');
    }
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_EVENTS)) {
          db.createObjectStore(STORE_EVENTS, { autoIncrement: true });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META);
        }
        // v2. `keyPath: 'batchId'` para poder borrar el paquete por su id
        // cuando el back lo confirma, sin tener que buscarlo antes.
        if (!db.objectStoreNames.contains(STORE_PACKAGES)) {
          db.createObjectStore(STORE_PACKAGES, { keyPath: 'batchId' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IDB open error'));
    });
    // No cachear el rechazo: reintentar en el próximo append.
    this.dbPromise.catch(() => {
      this.dbPromise = null;
    });
    return this.dbPromise;
  }

  private putEvent(db: IDBDatabase, event: AuditLogEvent): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_EVENTS, 'readwrite');
      const store = tx.objectStore(STORE_EVENTS);
      store.add(event);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IDB put error'));
      tx.onabort = () => reject(tx.error ?? new Error('IDB tx aborted'));
    });
  }

  private readMetaDayKey(db: IDBDatabase): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readonly');
      const store = tx.objectStore(STORE_META);
      const req = store.get(META_DAY_KEY);
      req.onsuccess = () => {
        const v = req.result;
        resolve(typeof v === 'string' ? v : null);
      };
      req.onerror = () => reject(req.error ?? new Error('IDB meta read error'));
    });
  }

  private writeMetaDayKey(db: IDBDatabase, dayKey: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readwrite');
      const store = tx.objectStore(STORE_META);
      store.put(dayKey, META_DAY_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IDB meta write error'));
      tx.onabort = () => reject(tx.error ?? new Error('IDB tx aborted'));
    });
  }
}
