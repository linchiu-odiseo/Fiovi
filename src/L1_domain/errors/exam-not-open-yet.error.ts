// El backend rechaza el submit/draft porque el examen aún no llegó a su
// fecha de apertura programada (422 exam_not_open_yet). El adapter L3 mapea
// la fecha del servidor a `startedAt` para que el VM pueda mostrar cuándo
// abre. Si el body no trae `startedAt` o el parseo da Invalid Date,
// `startedAt` es null — el VM muestra el fallback "aún no abre" sin fecha.
export class ExamNotOpenYetError extends Error {
  readonly startedAt: Date | null;

  constructor(params: { startedAt: Date | null }) {
    super('exam_not_open_yet');
    this.name = 'ExamNotOpenYetError';
    this.startedAt = params.startedAt;
  }
}
