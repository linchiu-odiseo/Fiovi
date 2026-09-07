import { Injectable, inject } from '@angular/core';
import {
  AuditLogUploadDispatcherService,
  type UploadOutcome,
} from './audit-log-upload-dispatcher.service';
import { ExamActivity } from './exam-activity.service';

// Cadencia base entre subidas. Alta a propósito: los logs son forenses, no
// hay ninguna urgencia en que lleguen ya. A 10 000 alumnos esto da ~0.23 rps
// promedio contra el back — ruido al lado del tráfico normal.
const UPLOAD_INTERVAL_MS = 5 * 60 * 60 * 1000;

// Ventana de dispersión. Cuando le toca subir a un alumno, no sube en ese
// instante: sortea un momento dentro de los próximos 30 minutos.
//
// Es lo que evita que todos coincidan. El caso que importa es la mañana:
// miles de alumnos abren la app a la misma hora y a casi todos les quedó
// pendiente una subida de la noche anterior. Sin esto, todos POSTean en el
// mismo segundo.
const JITTER_WINDOW_MS = 30 * 60 * 1000;

// Cada cuánto se revisa el reloj. Es una lectura de localStorage y dos
// comparaciones — no toca IndexedDB ni la red, así que puede ser frecuente.
// Cuanto más fino, mejor se reparte el disparo dentro de la ventana.
const HEARTBEAT_MS = 60 * 1000;

// A partir de cuánto se considera que una cita "venció con la app cerrada".
// Ver `tick` para por qué la diferencia importa.
const STALE_APPOINTMENT_MS = 2 * HEARTBEAT_MS;

// Cita agendada (timestamp absoluto). Absoluto y persistido, no un
// `setTimeout`: un timer en memoria muere cuando el alumno cierra la app, y
// si la próxima apertura volviera a sortear desde cero, alguien que entra y
// sale seguido podría no subir nunca.
const NEXT_ATTEMPT_KEY = 'fiovi-audit-log-next-attempt-at';
// Última subida exitosa — de acá sale cuándo vuelve a tocar.
const LAST_UPLOAD_KEY = 'fiovi-audit-log-last-upload-at';

@Injectable({ providedIn: 'root' })
export class AuditLogUploadScheduler {
  private readonly dispatcher = inject(AuditLogUploadDispatcherService);
  private readonly examActivity = inject(ExamActivity);
  private timer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.timer !== null) return;
    this.installFlushOnHide();
    void this.tick();
    this.timer = setInterval(() => void this.tick(), HEARTBEAT_MS);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(now: number = Date.now()): Promise<void> {
    // Durante un examen no se sube nada. Lo pendiente queda en IndexedDB y
    // sale después; el alumno rindiendo no ve un solo request de telemetría.
    if (this.examActivity.isActive()) return;

    const fireAt = readStamp(NEXT_ATTEMPT_KEY);

    if (fireAt === null) {
      // Sin cita. Si ya pasó la cadencia desde la última subida, se saca una
      // dentro de la ventana de dispersión.
      if (now >= this.dueAt(now)) {
        writeStamp(NEXT_ATTEMPT_KEY, now + jitter());
      }
      return;
    }

    if (now < fireAt) return; // todavía falta.

    if (now - fireAt > STALE_APPOINTMENT_MS) {
      // La cita venció mientras la app estaba cerrada. Ojo acá: subir en este
      // momento sería subir en el instante en que el alumno abrió la app — y
      // como todos abren a la misma hora, volveríamos a tener a todo el mundo
      // POSTeando junto, que es exactamente lo que la dispersión evita.
      // Se saca una cita nueva, repartida a partir de ahora.
      writeStamp(NEXT_ATTEMPT_KEY, now + jitter());
      return;
    }

    // Llegó la hora con la app abierta: se sube.
    clearStamp(NEXT_ATTEMPT_KEY);
    await this.run(now);
  }

  // Se invoca al ocultarse la app y desde el botón de Soporte. Devuelve el
  // resultado para que la UI pueda decirle al alumno si su paquete llegó.
  async flushNow(now: number = Date.now()): Promise<UploadOutcome> {
    clearStamp(NEXT_ATTEMPT_KEY);
    return this.run(now);
  }

  private async run(now: number): Promise<UploadOutcome> {
    const outcome = await this.dispatcher.uploadPending();
    // El reloj se reancla incluso si quedó algo pendiente: si no, un alumno
    // sin conexión quedaría permanentemente vencido y reintentando en cada
    // heartbeat. Lo que no salió sigue en la cola para el próximo ciclo.
    writeStamp(LAST_UPLOAD_KEY, now);
    return outcome;
  }

  private dueAt(now: number): number {
    const last = readStamp(LAST_UPLOAD_KEY);
    if (last === null) {
      // Primera vez en este dispositivo: se ancla ahora, así una instalación
      // nueva no sube apenas se abre.
      writeStamp(LAST_UPLOAD_KEY, now);
      return now + UPLOAD_INTERVAL_MS;
    }
    return last + UPLOAD_INTERVAL_MS;
  }

  // Aprovecha el momento en que el alumno deja la app para mandar lo que ya
  // estaba vencido, en vez de esperar una ventana que quizá no llegue si las
  // sesiones son cortas.
  //
  // Se engancha a `visibilitychange` y no a `pagehide`: en un móvil la app
  // casi siempre se va a segundo plano en vez de cerrarse del todo, iOS
  // dispara `pagehide` de forma poco confiable, y con `visibilitychange` la
  // página sigue viva — así el POST usa el camino normal y conserva el
  // refresh de sesión ante un 401.
  //
  // Solo dispara si ya estaba vencido: ocultar la app es algo que pasa todo
  // el tiempo y no queremos una subida cada vez.
  private installFlushOnHide(): void {
    if (typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden') return;
      if (this.examActivity.isActive()) return;
      const now = Date.now();
      if (now < this.dueAt(now)) return;
      void this.flushNow(now);
    });
  }
}

function jitter(): number {
  return Math.floor(Math.random() * JITTER_WINDOW_MS);
}

function readStamp(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStamp(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Best-effort: en modo privado o sin cuota, el scheduler se comporta
    // como si fuera la primera vez en cada arranque. No rompe nada.
  }
}

function clearStamp(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Idem writeStamp.
  }
}
