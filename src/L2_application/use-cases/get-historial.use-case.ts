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

// Lee todos los acks locales (envíos hechos en esta device / sesión) y los
// combina con `todaysExams` para enriquecer con nombre + curso cuando el
// examen todavía viene del back. Los acks de días anteriores quedan como
// "Examen del <fecha>" — la fecha basta para que el alumno recuerde.
//
// NO hace fetch al back: `todaysExams` se pasa por argumento (el view-model
// ya lo tiene desde el home). Mantiene el use case desacoplado de ExamsApi.
export class GetHistorialUseCase {
  constructor(private readonly markings: MarkingsStorage) {}

  async execute(todaysExams: readonly Exam[]): Promise<HistorialEntry[]> {
    const acks = await this.markings.getAllSubmissionAcks();
    const examsById = new Map(todaysExams.map((e) => [e.id, e]));

    const entries: HistorialEntry[] = [];
    for (const [examId, ack] of acks) {
      const exam = examsById.get(examId) ?? null;
      entries.push({
        examId,
        examName: exam?.name ?? null,
        courseName: exam?.course ?? null,
        submittedAt: ack.submittedAt,
        submissionHash: ack.submissionHash,
        ackId: ack.id,
        estado: 'envio',
      });
    }

    return entries.sort(byMostRecentFirst);
  }
}

function byMostRecentFirst(a: HistorialEntry, b: HistorialEntry): number {
  const ta = a.submittedAt?.getTime() ?? 0;
  const tb = b.submittedAt?.getTime() ?? 0;
  return tb - ta;
}
