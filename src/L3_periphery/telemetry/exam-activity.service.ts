import { Injectable, signal } from '@angular/core';

// ExamActivity — marca si el alumno está rindiendo en este momento.
//
// Existe para que la subida de logs se calle durante un examen. La subida no
// tiene ninguna urgencia (cadencia de horas, uso forense), mientras que el
// auto-guardado del borrador es lo que protege las respuestas del alumno:
// ante una conexión móvil mala, no queremos que un POST de telemetría le
// robe ancho de banda, ni que el gzip le coma CPU en un equipo lento.
//
// Lo prende y apaga el view-model del simulacro. Vive en L3 y no en el
// view-model porque el consumidor (el scheduler de subida) también es L3 y
// no puede mirar hacia LR.
@Injectable({ providedIn: 'root' })
export class ExamActivity {
  private readonly active = signal(false);

  readonly isActive = this.active.asReadonly();

  // Se llama donde realmente arranca el examen (cuando se arma el cronómetro
  // y el auto-envío), no cuando se abre la pantalla: en modo tarea la sesión
  // puede quedar esperando que el alumno confirme el inicio.
  markStarted(): void {
    this.active.set(true);
  }

  markEnded(): void {
    this.active.set(false);
  }
}
