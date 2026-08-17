import { TutorExamsApi } from '../../L1_domain/ports/tutor-exams-api';

// Inicia un virtual exam (scheduled → in_progress).
// Online-only (D3): no hay outbox. Una NetworkError le llega al VM que
// muestra el error + botón reintentar.
// El backend rechazará con 422 si 0 alumnos habilitados o claves no
// configuradas; el VM también lo previene con el guard D5.
//
// `duration` opcional: cuando el tutor edita el tiempo antes de iniciar,
// el use case lo pasa al puerto; el back lo persiste atómicamente con la
// transición scheduled → in_progress, así el polling siguiente (tutor y
// alumnos) ve el nuevo valor. En segundos.
//
// `openUntil` opcional: presencia = modo "tarea" (ventana global hasta esa
// fecha; countdown por alumno lo maneja el cliente). Ausencia = modo "examen"
// (contador server-side de duration, heredado). En modo tarea `duration`
// sigue significando "tiempo por alumno una vez que arranca localmente" —
// el server no lo usa para cerrar; sí lo consume el PWA como cap del countdown.
//
// `startedAt` opcional: cuando se pasa, el examen arranca en modo programado —
// el back no abre la sesión a los alumnos hasta que `now >= startedAt`. El
// server valida la ventana (now-5min .. now+15d, y startedAt < openUntil).
// El adapter serializa el Date a ISO 8601 en el payload.
export class IniciarExamenUseCase {
  constructor(private readonly api: TutorExamsApi) {}

  async execute(req: {
    recordId: string;
    duration?: number;
    openUntil?: Date;
    startedAt?: Date;
  }): Promise<void> {
    return this.api.iniciar(req.recordId, {
      duration: req.duration,
      openUntil: req.openUntil,
      startedAt: req.startedAt,
    });
  }
}
