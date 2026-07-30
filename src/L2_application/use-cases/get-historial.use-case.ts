import { Exam } from '../../L1_domain/entities/exam';
import { MarkingsStorage } from '../../L1_domain/ports/markings-storage';

// Estado del examen desde la perspectiva del historial. Coincide con la
// matriz de composición usada en /home (serverStatus × ack), acotada a los
// casos que aparecen post-envío / post-finalización.
export type HistorialEstado = 'envio' | 'no-envio';

// Una entrada del historial local del alumno. Combina el ack persistido en
// IDB (siempre presente cuando el alumno envió) con la metadata del examen
// cuando está disponible (nombre + curso vienen de `getTodaysExams()` y
// desaparecen al día siguiente cuando el back archiva). Fecha y hash SÍ
// sobreviven porque viven en IDB.
export interface HistorialEntry {
  readonly examId: string;
  readonly examName: string | null;
  readonly courseName: string | null;
  readonly submittedAt: Date | null; // null solo en 'no-envio'
  readonly submissionHash: string | null; // null solo en 'no-envio'
  readonly ackId: string | null;
  readonly estado: HistorialEstado;
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
// NO hace fetch al back: `todaysExams` se pasa por argumento (el view-model
// ya lo tiene desde el home). Mantiene el use case desacoplado de ExamsApi.
export class GetHistorialUseCase {
  constructor(private readonly markings: MarkingsStorage) {}

  async execute(todaysExams: readonly Exam[]): Promise<HistorialEntry[]> {
    const acks = await this.markings.getAllSubmissionAcks();
    const examsById = new Map(todaysExams.map((e) => [e.id, e]));

    const entries: HistorialEntry[] = [];
    const seen = new Set<string>();

    // 1) Entradas con ack, filtradas por presencia en todaysExams.
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

    // 2) Exámenes finalized sin ack (alumno no envió — o envió desde otra
    // device y no tenemos ack local). Solo detectables mientras el back los
    // sigue devolviendo en "hoy".
    for (const exam of todaysExams) {
      if (seen.has(exam.id)) continue;
      if (!exam.serverStatus.is('finalized')) continue;
      if (exam.esTarea()) continue; // Las tareas viven en /student/tareas.
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
