// Área de POSTULACIÓN del alumno (la carrera a la que aplica).
//
// ⚠️  NO CONFUNDIR con `Exam.area` (entities/exam.ts), que es el ÁREA DEL
// CURSO (Letras, Ciencias, Números) y viene del back en el GET de
// exam-sessions. Este `AdmissionArea` es la selección del alumno en la
// cartilla, que viaja en el body de POST /submit y POST /draft como
// `admission_area` (snake_case).
// Ver design.md D1 de `add-admission-area`.
//
// Set fijo de 16 valores del sistema académico del tenant. Estos son los
// KNOWN — los que Fiovi entiende con autocomplete y aplican el layout
// especial `GENERAL span-3` en el grid del picker.
export type KnownAdmissionArea =
  | 'A'
  | 'A1'
  | 'B'
  | 'C'
  | 'D'
  | 'E'
  | 'I'
  | 'II'
  | 'III'
  | 'IV'
  | 'V'
  | 'G'
  | 'APT'
  | 'CIE'
  | 'MAT'
  | 'GENERAL';

// Alias abierto. Con `add-exam-admission-areas-picker` (2026-08-15), el back
// learnex empezó a emitir `admission_areas: string[]` snapshot desde
// `ExamStructureArea.name` (VARCHAR 80 libre). Un examen puede traer labels
// que NO están en las 16 conocidas — en ese caso el picker renderiza una
// pastilla con ese string tal cual y el alumno puede seleccionarlo. El truco
// `(string & {})` preserva autocomplete de las 16 conocidas en el IDE mientras
// acepta cualquier otro string en runtime.
export type AdmissionArea = KnownAdmissionArea | (string & {});

// Orden de renderizado del picker cuando NO hay subset del back (FICHAS y
// legacy). 3 filas × 6 columnas:
//   Fila 1: A   A1  B   C   D   E
//   Fila 2: I   II  III IV  V   G
//   Fila 3: APT CIE MAT GENERAL(span 3)
// Cuando el back envía `allowedAdmissionAreas`, el picker renderiza EL orden
// del back (learnex ordena por `ExamStructureArea.order asc`) — no éste.
export const ADMISSION_AREAS: readonly KnownAdmissionArea[] = [
  'A',
  'A1',
  'B',
  'C',
  'D',
  'E',
  'I',
  'II',
  'III',
  'IV',
  'V',
  'G',
  'APT',
  'CIE',
  'MAT',
  'GENERAL',
];

// Default si el alumno nunca eligió expresamente. Se resuelve en el use case
// al construir EnvioRequest/DraftRequest — NO se persiste en storage para
// mantener distinguibles "eligió GENERAL" y "todavía no eligió nada".
// Sigue siendo `KnownAdmissionArea` (no el abierto) — el default nunca es un
// string del back.
// Ver design.md D3.
export const DEFAULT_ADMISSION_AREA: KnownAdmissionArea = 'GENERAL';

const KNOWN_ADMISSION_AREA_SET: ReadonlySet<string> = new Set(ADMISSION_AREAS);

// Guard relajado: acepta cualquier string no vacío. Con el union abierto
// desde `add-exam-admission-areas-picker`, el back es autoridad sobre qué
// áreas existen; Fiovi solo valida shape mínimo (string no vacío tras trim).
export function isAdmissionArea(v: unknown): v is AdmissionArea {
  return typeof v === 'string' && v.trim().length > 0;
}

// Narrower: acepta solo las 16 conocidas. Útil para call sites que necesitan
// distinguir (ej. el picker aplica el layout `GENERAL span-3` solo cuando el
// label es exactamente uno de los conocidos).
export function isKnownAdmissionArea(v: unknown): v is KnownAdmissionArea {
  return typeof v === 'string' && KNOWN_ADMISSION_AREA_SET.has(v);
}
