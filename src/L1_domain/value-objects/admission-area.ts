// Área de POSTULACIÓN del alumno (la carrera a la que aplica).
//
// ⚠️  NO CONFUNDIR con `Exam.area` (entities/exam.ts), que es el ÁREA DEL
// CURSO (Letras, Ciencias, Números) y viene del back en el GET de
// exam-sessions. Este `AdmissionArea` es la selección del alumno en la
// cartilla, que viaja en el body de POST /submit y POST /draft como
// `admission_area` (snake_case).
// Ver design.md D1 de `add-admission-area`.
//
// Set fijo de 16 valores del sistema académico del tenant. Si en el futuro
// crece → change explícito, no diseño dinámico (design.md D2).
export type AdmissionArea =
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

// Orden de renderizado del picker (3 filas × 6 columnas):
//   Fila 1: A   A1  B   C   D   E
//   Fila 2: I   II  III IV  V   G
//   Fila 3: APT CIE MAT GENERAL(span 3)
export const ADMISSION_AREAS: readonly AdmissionArea[] = [
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
// Ver design.md D3.
export const DEFAULT_ADMISSION_AREA: AdmissionArea = 'GENERAL';

const ADMISSION_AREA_SET: ReadonlySet<string> = new Set(ADMISSION_AREAS);

// Guard function para validación en boundaries (input de UI, payload
// del back). Comparación por igualdad estricta contra el set cerrado.
export function isAdmissionArea(v: unknown): v is AdmissionArea {
  return typeof v === 'string' && ADMISSION_AREA_SET.has(v);
}
