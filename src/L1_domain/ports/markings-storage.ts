import { AdmissionArea } from '../value-objects/admission-area';
import { SubmissionAck } from '../value-objects/submission-ack';

// Las marcaciones de un examen son un objeto plano: clave = número de
// pregunta como string ("1".."count"), valor = alternativa elegida o null
// para desmarcado. El use case reshape esto a `responses: { P<n>: letra }`
// con prefijo P y omitiendo las nulls antes de enviar.
export type AlternativaValue = 'A' | 'B' | 'C' | 'D' | 'E' | null;

export type AnswersMap = Record<string, AlternativaValue>;

// Envío encolado cuando el POST al backend falla por red. El cliente
// conserva el `clientFinishedAt` original (anclado al server-time del
// momento del intento), no la hora del retry. También conserva el `code`
// (DNI) y el `admissionArea` — el dispatcher reconstruye el body sin
// re-consultar IdentityStorage ni MarkingsStorage porque entre encolado
// y retry el alumno podría haber hecho logout/login o cambiar de área
// (casos patológicos, pero la defensa es trivial).
// `admissionArea` es opcional para tolerar entries legacy encoladas antes
// de este change; `RetomarEnviosPendientesUseCase` aplica el default.
export interface EnvioPendiente {
  examId: string;
  code: string;
  admissionArea?: AdmissionArea;
  answers: AnswersMap;
  clientFinishedAt: string;
}

// Puerto del dominio para persistencia local de marcaciones offline-first.
//
// Las operaciones operan implícitamente sobre el usuario actual: el adapter
// L3 deriva el `userEmail` de la sesión activa (NO se pasa como argumento).
// Esto mantiene las firmas limpias para los use cases.
//
// `wipeUserScope()` borra TODO lo del usuario actual (marcaciones + queue
// + acks) y se invoca en logout ANTES de `identityStorage.clear()` para
// que el adapter todavía pueda leer el email desde `IdentityStorage`
// internamente. Si no hay identity disponible → no-op.
//
// `setSubmissionAck` / `getSubmissionAck` persisten el comprobante
// criptográfico devuelto por el server. La presencia del ack es la señal
// "yo envié este examen" que alimenta el card-state `enviado` en /home y
// la posibilidad de mostrar el modal de comprobante.
//
// `setAdmissionArea` / `getAdmissionArea` persisten el área de POSTULACIÓN
// que el alumno eligió en la cartilla (NO confundir con `Exam.area` que es
// curso — ver design.md D1 de `add-admission-area`). `null` de get significa
// "el alumno nunca eligió expresamente"; el use case lo interpreta como
// `DEFAULT_ADMISSION_AREA` sin persistir (design.md D3). `clearMarcaciones`
// SHALL borrar también el area para no dejar estado stale entre exámenes.
//
// Cualquier operación SHALL rechazar con `OfflineStorageUnavailableError`
// si IndexedDB no está disponible en el browser.
//
// Implementación concreta vive en L3 (`IndexedDbMarkingsStorage`).
export interface MarkingsStorage {
  setMarcacion(examId: string, pregunta: number, alternativa: AlternativaValue): Promise<void>;
  getMarcaciones(examId: string): Promise<AnswersMap>;
  clearMarcaciones(examId: string): Promise<void>; // también borra el AdmissionArea persistido
  enqueueEnvio(envio: EnvioPendiente): Promise<void>;
  getEnviosPendientes(): Promise<EnvioPendiente[]>;
  dequeueEnvio(examId: string): Promise<void>;
  setSubmissionAck(examId: string, ack: SubmissionAck): Promise<void>;
  getSubmissionAck(examId: string): Promise<SubmissionAck | null>;
  setAdmissionArea(examId: string, area: AdmissionArea): Promise<void>;
  getAdmissionArea(examId: string): Promise<AdmissionArea | null>;
  wipeUserScope(): Promise<void>; // sin argumento — el adapter lee IdentityStorage internamente
}
