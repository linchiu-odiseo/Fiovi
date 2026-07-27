// Helpers de formato para countdowns del alumno y tutor. Antes vivían como
// funciones locales dentro de `tutor-exam-detail.view-model.ts`; se extrajeron
// acá cuando aparecieron `home.view-model.ts` y la página de tareas del alumno
// necesitando el mismo escalado humano para tarea. Un solo helper = una sola
// regla de formato (evita drift entre pantallas).
//
// Convención:
//   - `formatRestante`         → reloj digital MM:SS o HH:MM:SS. Para exámenes
//                                (siempre cortos ≤ 3h). El tutor/alumno están
//                                observando en vivo.
//   - `formatRestanteTarea`    → formato humano escalonado. Para tareas que
//                                pueden durar días. Cae a MM:SS solo en los
//                                últimos 5 min.

export function formatRestante(ms: number): string {
  if (ms <= 0) return '00:00';
  const totalSeconds = Math.ceil(ms / 1_000);
  const hh = Math.floor(totalSeconds / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = totalSeconds % 60;
  const pad = (n: number): string => n.toString().padStart(2, '0');
  // Solo mostramos las horas cuando aportan — un examen de 15 min no debería
  // ver "00:15:00", pero uno de 90 min sí "01:30:00" (más natural que 90:00).
  if (hh > 0) return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
  return `${pad(mm)}:${pad(ss)}`;
}

// Formato humano para el countdown de tarea (puede durar días). Escalona:
//   > 24h        → "1 día 5 h" / "3 días"
//   1h – 24h     → "5 h 32 min" / "12 h"
//   5min – 1h    → "32 min"
//   < 5min       → cae a MM:SS (mismo reloj que examen — momento de acción).
// Mostrar segundos cuando faltan días es ruido puro (2 días 5 h 12 min 43 s
// no da información accionable), por eso solo aparecen en el último tramo.
export function formatRestanteTarea(ms: number): string {
  if (ms <= 0) return '00:00';
  const totalSeconds = Math.ceil(ms / 1_000);
  if (totalSeconds < 5 * 60) return formatRestante(ms);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) {
    const dLabel = days === 1 ? 'día' : 'días';
    return hours > 0 ? `${days} ${dLabel} ${hours} h` : `${days} ${dLabel}`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  }
  return `${minutes} min`;
}
