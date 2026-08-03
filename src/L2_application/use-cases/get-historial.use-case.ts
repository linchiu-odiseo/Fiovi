import { Exam } from '../../L1_domain/entities/exam';
import { MarkingsStorage } from '../../L1_domain/ports/markings-storage';
import { GetMySubmissionUseCase } from './get-my-submission.use-case';

// Estado del examen desde la perspectiva del historial. Coincide con la
// matriz de composición usada en /home (serverStatus × ack), acotada a los
// casos que aparecen post-envío / post-finalización.
export type HistorialEstado = 'envio' | 'no-envio';

// Una entrada del historial local del alumno. Combina el ack persistido en
// IDB (siempre presente cuando el alumno envió) con la metadata del examen
// cuando está disponible (nombre + curso vienen de `getTodaysExams()` y
// desaparecen al día siguiente cuando el back archiva). Fecha y hash SÍ
// sobreviven porque viven en IDB.
//
// `source` diferencia el envío manual del alumno del auto-guardado por el
// finalize del tutor (draft promovido a submission). Solo presente en el
// estado 'envio'.
export interface HistorialEntry {
  readonly examId: string;
  readonly examName: string | null;
  readonly courseName: string | null;
  readonly submittedAt: Date | null; // null solo en 'no-envio'
  readonly submissionHash: string | null; // null solo en 'no-envio'
  readonly ackId: string | null;
  readonly estado: HistorialEstado;
  readonly source?: 'manual' | 'auto_saved';
}

// Lee los acks locales y los combina con `todaysExams` para armar la lista
// del historial. Casos:
//
//   1. Ack local + examen en `todaysExams` → estado 'envio', con fecha +
//      hash + nombre + curso del back.
//   2. Examen `finalized` en `todaysExams` sin ack → estado 'no-envio' —
//      el examen cerró y el alumno no envió (o envió desde otra device).
//
// Filtro clave: los acks solo aparecen si su `examId` está en `todaysExams`.
// Así, cuando el back archiva a las 00 hs, tanto los envíos como los
// no-envíos desaparecen del historial en la próxima carga — el back es el
// TTL implícito. Sin este filtro, quedarían "acks huérfanos" con nombre
// null que confunden al alumno.
//
// Auto-envío server-side (TODO): hoy Fiovi NO puede distinguir "el back
// auto-envió al vencerse el tiempo" de "el alumno no envió". Ambos casos
// llegan como `finalized + ack === null`. Cuando learnex marque el
// auto-envío con un flag propio, se agrega un tercer estado 'auto-envio'.
//
// Fetch al back en la rama "no-envio": cuando el back devuelve un examen
// finalized y no hay ack local, consultamos /my-submission para saber si hay
// fila en BD (envío desde otro device o auto-guardado por el finalize del
// tutor). Si 200 → convertimos a 'envio' con `source`. Si 404 → 'no-envio'
// verdadero. El use case persiste el ack + snapshot vía `GetMySubmissionUseCase`.
export class GetHistorialUseCase {
  constructor(
    private readonly markings: MarkingsStorage,
    private readonly getMySubmission: GetMySubmissionUseCase,
  ) {}

  async execute(todaysExams: readonly Exam[]): Promise<HistorialEntry[]> {
    const acks = await this.markings.getAllSubmissionAcks();
    const examsById = new Map(todaysExams.map((e) => [e.id, e]));

    const entries: HistorialEntry[] = [];
    const seen = new Set<string>();

    // 1) Entradas con ack local, filtradas por presencia en todaysExams.
    for (const [examId, ack] of acks) {
      const exam = examsById.get(examId);
      if (!exam) continue; // Ack huérfano (examen archivado por el back).
      entries.push({
        examId,
        examName: exam.name,
        courseName: exam.course,
        submittedAt: ack.submittedAt,
        submissionHash: ack.submissionHash,
        ackId: ack.id,
        estado: 'envio',
      });
      seen.add(examId);
    }

    // 2) Exámenes finalized sin ack local: consultamos al back para cerrar el
    // hueco de auto-guardado / envío desde otro device.
    const finalizedSinAck = todaysExams.filter(
      (exam) => !seen.has(exam.id) && exam.serverStatus.is('finalized') && !exam.esTarea(),
    );
    const backfills = await Promise.all(
      finalizedSinAck.map(async (exam) => {
        try {
          const my = await this.getMySubmission.execute(exam.id);
          return { exam, my };
        } catch {
          // Network/timeout: caemos a 'no-envio' silencioso. Próxima carga
          // reintenta.
          return { exam, my: null };
        }
      }),
    );

    for (const { exam, my } of backfills) {
      if (my !== null) {
        entries.push({
          examId: exam.id,
          examName: exam.name,
          courseName: exam.course,
          submittedAt: my.ack.submittedAt,
          submissionHash: my.ack.submissionHash,
          ackId: my.ack.id,
          estado: 'envio',
          source: my.source,
        });
      } else {
        entries.push({
          examId: exam.id,
          examName: exam.name,
          courseName: exam.course,
          submittedAt: null,
          submissionHash: null,
          ackId: null,
          estado: 'no-envio',
        });
      }
    }

    return entries.sort(byMostRecentFirst);
  }
}

// Ordena por submittedAt desc. Las entradas 'no-envio' tienen submittedAt
// null → caen al final (los envíos con hora quedan arriba, los no-envíos
// abajo). Alternativa considerada: usar `exam.effectiveCloseAt()` como
// timestamp para los no-envíos; se descartó por simplicidad, el alumno lee
// la fecha absoluta en el copy y no depende del orden.
function byMostRecentFirst(a: HistorialEntry, b: HistorialEntry): number {
  const ta = a.submittedAt?.getTime() ?? 0;
  const tb = b.submittedAt?.getTime() ?? 0;
  return tb - ta;
}
