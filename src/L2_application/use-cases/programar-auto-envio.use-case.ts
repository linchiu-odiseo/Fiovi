import { Clock } from '../../L1_domain/ports/clock';
import { Exam } from '../../L1_domain/entities/exam';
import { EnviarSimulacroOutput, EnviarSimulacroUseCase } from './enviar-simulacro.use-case';

// Jitter máximo en ms a sumar/restar del `setTimeout` para evitar
// thundering herd cuando 20k alumnos auto-envían al mismo segundo.
// El `clientFinishedAt` que se envía al backend SIEMPRE es exactamente
// `exam.effectiveCloseAt()`, NO el momento en que el timer dispara — así
// dos disparos a 9:00:02 vs 9:00:00 quedan ambos registrados como envío
// a las 9:00:00.
const JITTER_MAX_MS = 3000;

export interface ProgramarAutoEnvioInput {
  exam: Exam;
  onResult?: (result: EnviarSimulacroOutput) => void;
  onError?: (err: unknown) => void;
  // Callback invocado JUSTO ANTES de disparar el POST del auto-envío.
  // Sync, sin efectos observables al resultado. Consumido por el view-model
  // para emitir el evento `AS` del audit-log (distinguir auto vs manual).
  // El use case no depende de audit-log — solo expone el hook opcional.
  onFire?: () => void;
}

export interface AutoEnvioHandle {
  cancel(): void;
}

// Programa el envío automático del examen para cuando el reloj
// server-anchored cruce el cierre efectivo de la ventana. El caller
// (view-model) cancela el handle si el alumno envía manualmente antes.
//
// El cierre lo decide el dominio (`Exam.effectiveCloseAt()`): prioriza
// `finished` si el back ya emitió cierre, sino cae a `started + duration`.
export class ProgramarAutoEnvioUseCase {
  constructor(
    private readonly enviar: EnviarSimulacroUseCase,
    private readonly clock: Clock,
  ) {}

  execute(input: ProgramarAutoEnvioInput): AutoEnvioHandle {
    const finDate = input.exam.effectiveCloseAt();
    if (finDate === null) {
      // Examen aún no activado (started y finished ambos null): no hay
      // cierre determinable. NO programamos timer. El polling de /home
      // refrescará la lista cuando el tutor active y el caller volverá a
      // invocar este use case con un cierre real.
      return { cancel: () => undefined };
    }
    const ahoraMs = this.clock.now().getTime();
    const finMs = finDate.getTime();
    if (finMs <= ahoraMs) {
      // El cierre ya pasó al momento de programar (alumno entró tarde con
      // el reloj cliente más allá del closeAt). NO disparamos auto-envío
      // inmediato — si quedó pendiente, lo decide el server cuando vuelva
      // a contactarse; mientras tanto el banner "tiempo agotado" del
      // view-model comunica el estado y el botón Enviar queda disabled.
      return { cancel: () => undefined };
    }
    const jitter = (Math.random() * 2 - 1) * JITTER_MAX_MS;
    const delay = Math.max(0, finMs - ahoraMs + jitter);

    const timeout = setTimeout(async () => {
      try {
        input.onFire?.();
        const result = await this.enviar.execute({
          examId: input.exam.id,
          clientFinishedAtOverride: finDate,
        });
        input.onResult?.(result);
      } catch (err) {
        input.onError?.(err);
      }
    }, delay);

    return {
      cancel: () => clearTimeout(timeout),
    };
  }
}
