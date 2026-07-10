// Dobles manuales de los puertos L1 para tests de L2.
// Convención: clases reales (no vi.fn()) para forzar que la interface se respete
// y para que el reader vea el contrato del puerto en el doble.
//
// AuthRepository, IdentityStorage, ProfileStorage → ver tests/unit/fixtures/
// (centralizados allí para reutilización entre use cases de auth). Reexportamos
// FakeIdentityStorage acá para no tener que cruzar rutas de import desde los
// specs de L2/use cases que ya viven en este directorio.

import {
  AlternativaValue,
  AnswersMap,
  EnvioPendiente,
  MarkingsStorage,
} from '../../../src/L1_domain/ports/markings-storage';
import { Clock } from '../../../src/L1_domain/ports/clock';
import {
  DraftRequest,
  EnvioRequest,
  EnvioResult,
  ExamsApi,
  ExamsListResult,
} from '../../../src/L1_domain/ports/exams-api';
import { AdmissionArea } from '../../../src/L1_domain/value-objects/admission-area';
import { ServerTime } from '../../../src/L1_domain/value-objects/server-time';
import { SubmissionAck } from '../../../src/L1_domain/value-objects/submission-ack';

export { FakeIdentityStorage } from '../fixtures/identity-storage.fake';

// Doble manual de `MarkingsStorage` para tests de L2.
// Mantiene marcaciones en un Map keyed por `examId|pregunta` y la cola
// de envíos en otro Map keyed por `examId`. NO necesita simular scope
// por usuario — eso es responsabilidad del adapter L3; este fake opera
// como si estuviera en el scope del usuario actual.
//
// Adicionalmente registra el ORDEN de invocaciones de ops mutativas
// para que los tests puedan verificar secuencias (ej: wipe antes que clear
// de sesión). `getOpsLog()` y `getWipeCalls()` exponen ese registro.
//
// `setSubmissionAck`/`getSubmissionAck` reemplazan al viejo `hasSubmittedAck`:
// el ack persiste como `SubmissionAck` (no como boolean), y los tests pueden
// sembrarlo con `seedAck()` para verificar el seam que activa el card-state
// `enviado` en /home.
export class InMemoryMarkingsStorage implements MarkingsStorage {
  private marcaciones = new Map<string, AlternativaValue>();
  private queue = new Map<string, EnvioPendiente>();
  private acks = new Map<string, SubmissionAck>();
  // Área de POSTULACIÓN por examId (ver AdmissionArea VO). null en get =
  // "el alumno nunca eligió expresamente"; el use case resuelve el default
  // sin persistir (design.md D3 de `add-admission-area`).
  private admissionAreas = new Map<string, AdmissionArea>();
  private wipeShouldFail = false;
  private wipeCalls = 0;
  private opsLog: string[] = [];

  // Si se conecta a un log compartido (vía `bindOpsLog`), las ops se
  // registran ahí para que los tests puedan assertear secuencias que
  // crucen este fake y otros (ej: FakeIdentityStorage).
  bindOpsLog(log: string[]): void {
    this.opsLog = log;
  }

  // Hooks de control para tests.
  willRejectWipe(): void {
    this.wipeShouldFail = true;
  }

  getWipeCalls(): number {
    return this.wipeCalls;
  }

  getOpsLog(): readonly string[] {
    return this.opsLog;
  }

  // Helpers para sembrar estado en tests.
  seedMarcacion(examId: string, pregunta: number, alternativa: AlternativaValue): void {
    this.marcaciones.set(`${examId}|${pregunta}`, alternativa);
  }

  seedEnvio(envio: EnvioPendiente): void {
    this.queue.set(envio.examId, envio);
  }

  // Sembrar un ack persistido para verificar el seam del card-state `enviado`.
  seedAck(examId: string, ack: SubmissionAck): void {
    this.acks.set(examId, ack);
  }

  // Sembrar un AdmissionArea para verificar propagación al EnvioRequest/DraftRequest
  // sin pasar por SeleccionarAdmissionAreaUseCase.
  seedAdmissionArea(examId: string, area: AdmissionArea): void {
    this.admissionAreas.set(examId, area);
  }

  hasAnyState(): boolean {
    return (
      this.marcaciones.size > 0 ||
      this.queue.size > 0 ||
      this.acks.size > 0 ||
      this.admissionAreas.size > 0
    );
  }

  // --- Puerto MarkingsStorage ---

  async setMarcacion(
    examId: string,
    pregunta: number,
    alternativa: AlternativaValue,
  ): Promise<void> {
    this.opsLog.push('markings.setMarcacion');
    this.marcaciones.set(`${examId}|${pregunta}`, alternativa);
  }

  async getMarcaciones(examId: string): Promise<AnswersMap> {
    const prefix = `${examId}|`;
    const out: AnswersMap = {};
    for (const [key, val] of this.marcaciones.entries()) {
      if (key.startsWith(prefix)) {
        out[key.slice(prefix.length)] = val;
      }
    }
    return out;
  }

  async clearMarcaciones(examId: string): Promise<void> {
    this.opsLog.push('markings.clearMarcaciones');
    const prefix = `${examId}|`;
    for (const key of [...this.marcaciones.keys()]) {
      if (key.startsWith(prefix)) this.marcaciones.delete(key);
    }
    // El adapter L3 también borra el AdmissionArea del examen (design D3
    // + spec `admission-area`: "clearMarcaciones SHALL borrar también el
    // area para no dejar estado stale post-envío").
    this.admissionAreas.delete(examId);
  }

  async enqueueEnvio(envio: EnvioPendiente): Promise<void> {
    this.opsLog.push('markings.enqueueEnvio');
    this.queue.set(envio.examId, envio);
  }

  async getEnviosPendientes(): Promise<EnvioPendiente[]> {
    return [...this.queue.values()];
  }

  async dequeueEnvio(examId: string): Promise<void> {
    this.opsLog.push('markings.dequeueEnvio');
    this.queue.delete(examId);
  }

  async setSubmissionAck(examId: string, ack: SubmissionAck): Promise<void> {
    this.opsLog.push('markings.setSubmissionAck');
    this.acks.set(examId, ack);
  }

  async getSubmissionAck(examId: string): Promise<SubmissionAck | null> {
    return this.acks.get(examId) ?? null;
  }

  async setAdmissionArea(examId: string, area: AdmissionArea): Promise<void> {
    this.opsLog.push('markings.setAdmissionArea');
    this.admissionAreas.set(examId, area);
  }

  async getAdmissionArea(examId: string): Promise<AdmissionArea | null> {
    return this.admissionAreas.get(examId) ?? null;
  }

  async wipeUserScope(): Promise<void> {
    this.opsLog.push('markings.wipeUserScope');
    this.wipeCalls++;
    if (this.wipeShouldFail) {
      throw new Error('IndexedDB wipe falló en runtime');
    }
    this.marcaciones.clear();
    this.queue.clear();
    this.acks.clear();
    this.admissionAreas.clear();
  }
}

// Doble manual del puerto `ExamsApi`. Permite preconfigurar el próximo
// resultado/rejection de `getTodaysExams()` y `enviar()`, y registra todas
// las llamadas a `enviar()` (con su payload exacto) para que los tests
// puedan verificar que se preservó `clientFinishedAt` original entre
// intento, encolado y retry.
//
// La cola interna `enviarPlan` soporta dos modos:
//   - "scalar": el mismo resultado/error se devuelve para cada llamada
//   - "sequence": uno por llamada en orden, útil para tests del retomar
//     use case con mezcla de éxito + NetworkError.
export class FakeExamsApi implements ExamsApi {
  private nextObtener:
    | { kind: 'resolve'; result: ExamsListResult }
    | { kind: 'reject'; error: Error }
    | null = null;
  private obtenerCalls = 0;

  private enviarScalar:
    | { kind: 'resolve'; result: EnvioResult }
    | { kind: 'reject'; error: Error }
    | null = null;
  private enviarSequence: (
    | { kind: 'resolve'; result: EnvioResult }
    | { kind: 'reject'; error: Error }
  )[] = [];
  private enviarCalls: EnvioRequest[] = [];

  willResolveGetTodaysExams(result: ExamsListResult): void {
    this.nextObtener = { kind: 'resolve', result };
  }

  willRejectGetTodaysExams(error: Error): void {
    this.nextObtener = { kind: 'reject', error };
  }

  getObtenerCalls(): number {
    return this.obtenerCalls;
  }

  willResolveEnviar(result: EnvioResult): void {
    this.enviarScalar = { kind: 'resolve', result };
  }

  willRejectEnviar(error: Error): void {
    this.enviarScalar = { kind: 'reject', error };
  }

  // Sembrar una secuencia: 1 entry por cada llamada esperada a enviar().
  // Útil para RetomarEnviosPendientesUseCase con N envíos en cola.
  willEnviarInSequence(
    plan: readonly ({ kind: 'resolve'; result: EnvioResult } | { kind: 'reject'; error: Error })[],
  ): void {
    this.enviarSequence = [...plan];
  }

  getEnviarCalls(): readonly EnvioRequest[] {
    return this.enviarCalls;
  }

  async getTodaysExams(): Promise<ExamsListResult> {
    this.obtenerCalls++;
    if (!this.nextObtener) {
      throw new Error(
        'FakeExamsApi: configurar willResolveGetTodaysExams o willRejectGetTodaysExams antes de llamar getTodaysExams()',
      );
    }
    if (this.nextObtener.kind === 'reject') throw this.nextObtener.error;
    return this.nextObtener.result;
  }

  async enviar(req: EnvioRequest): Promise<EnvioResult> {
    this.enviarCalls.push(req);
    if (this.enviarSequence.length > 0) {
      const next = this.enviarSequence.shift();
      if (!next) {
        throw new Error('FakeExamsApi: enviarSequence agotada.');
      }
      if (next.kind === 'reject') throw next.error;
      return next.result;
    }
    if (this.enviarScalar) {
      if (this.enviarScalar.kind === 'reject') throw this.enviarScalar.error;
      return this.enviarScalar.result;
    }
    throw new Error(
      'FakeExamsApi: configurar willResolveEnviar / willRejectEnviar / willEnviarInSequence antes de llamar enviar()',
    );
  }

  // Stub no-op para guardarDraft — no usado por los use cases existentes.
  // Los tests de GuardarDraftUseCase usan su propio FakeDraftExamsApi
  // (definido en guardar-draft.use-case.spec.ts) para control más fino.
  async guardarDraft(_req: DraftRequest): Promise<void> {
    // no-op — los tests de EnviarSimulacroUseCase no tocan este método.
  }
}

// ---------------------------------------------------------------------------
// Doble manual del puerto `TutorExamsApi`. Patrón idéntico a FakeExamsApi:
// control programático resolve/reject por método, call recording.
// ---------------------------------------------------------------------------

import {
  TutorExamsApi,
  FinalizeResult,
} from '../../../src/L1_domain/ports/tutor-exams-api';
import { TutorExam } from '../../../src/L1_domain/entities/tutor-exam';
import { TutorExamDetail } from '../../../src/L1_domain/value-objects/tutor-exam-detail';
import { ClassroomStudent } from '../../../src/L1_domain/value-objects/classroom-student';

export class FakeTutorExamsApi implements TutorExamsApi {
  // --- getTutorExams ---
  private nextGetTutorExams:
    | { kind: 'resolve'; result: readonly TutorExam[] }
    | { kind: 'reject'; error: Error }
    | null = null;
  private getTutorExamsCalls = 0;

  willResolveGetTutorExams(result: readonly TutorExam[]): void {
    this.nextGetTutorExams = { kind: 'resolve', result };
  }

  willRejectGetTutorExams(error: Error): void {
    this.nextGetTutorExams = { kind: 'reject', error };
  }

  getGetTutorExamsCallCount(): number {
    return this.getTutorExamsCalls;
  }

  async getTutorExams(): Promise<readonly TutorExam[]> {
    this.getTutorExamsCalls++;
    if (!this.nextGetTutorExams) {
      throw new Error('FakeTutorExamsApi: configurar willResolveGetTutorExams o willRejectGetTutorExams antes de llamar getTutorExams()');
    }
    if (this.nextGetTutorExams.kind === 'reject') throw this.nextGetTutorExams.error;
    return this.nextGetTutorExams.result;
  }

  // --- getExamDetail ---
  private nextGetExamDetail:
    | { kind: 'resolve'; result: TutorExamDetail }
    | { kind: 'reject'; error: Error }
    | null = null;
  private getExamDetailCalls: string[] = [];

  willResolveGetExamDetail(result: TutorExamDetail): void {
    this.nextGetExamDetail = { kind: 'resolve', result };
  }

  willRejectGetExamDetail(error: Error): void {
    this.nextGetExamDetail = { kind: 'reject', error };
  }

  getGetExamDetailCalls(): readonly string[] {
    return this.getExamDetailCalls;
  }

  async getExamDetail(recordId: string): Promise<TutorExamDetail> {
    this.getExamDetailCalls.push(recordId);
    if (!this.nextGetExamDetail) {
      throw new Error('FakeTutorExamsApi: configurar willResolveGetExamDetail o willRejectGetExamDetail antes de llamar getExamDetail()');
    }
    if (this.nextGetExamDetail.kind === 'reject') throw this.nextGetExamDetail.error;
    return this.nextGetExamDetail.result;
  }

  // --- listClassroomStudents ---
  private nextListClassroomStudents:
    | { kind: 'resolve'; result: readonly ClassroomStudent[] }
    | { kind: 'reject'; error: Error }
    | null = null;
  private listClassroomStudentsCalls: { classroomId: string; virtualExamDetailId: string }[] = [];

  willResolveListClassroomStudents(result: readonly ClassroomStudent[]): void {
    this.nextListClassroomStudents = { kind: 'resolve', result };
  }

  willRejectListClassroomStudents(error: Error): void {
    this.nextListClassroomStudents = { kind: 'reject', error };
  }

  getListClassroomStudentsCalls(): readonly { classroomId: string; virtualExamDetailId: string }[] {
    return this.listClassroomStudentsCalls;
  }

  async listClassroomStudents(req: { classroomId: string; virtualExamDetailId: string }): Promise<readonly ClassroomStudent[]> {
    this.listClassroomStudentsCalls.push(req);
    if (!this.nextListClassroomStudents) {
      throw new Error('FakeTutorExamsApi: configurar willResolveListClassroomStudents o willRejectListClassroomStudents antes de llamar listClassroomStudents()');
    }
    if (this.nextListClassroomStudents.kind === 'reject') throw this.nextListClassroomStudents.error;
    return this.nextListClassroomStudents.result;
  }

  // --- updateEnabledStudents ---
  private nextUpdateEnabledStudents:
    | { kind: 'resolve' }
    | { kind: 'reject'; error: Error }
    | null = null;
  private updateEnabledStudentsCalls: { recordId: string; enabledStudentIds: readonly string[] }[] = [];

  willResolveUpdateEnabledStudents(): void {
    this.nextUpdateEnabledStudents = { kind: 'resolve' };
  }

  willRejectUpdateEnabledStudents(error: Error): void {
    this.nextUpdateEnabledStudents = { kind: 'reject', error };
  }

  getUpdateEnabledStudentsCalls(): readonly { recordId: string; enabledStudentIds: readonly string[] }[] {
    return this.updateEnabledStudentsCalls;
  }

  async updateEnabledStudents(req: { recordId: string; enabledStudentIds: readonly string[] }): Promise<void> {
    this.updateEnabledStudentsCalls.push(req);
    if (!this.nextUpdateEnabledStudents) {
      throw new Error('FakeTutorExamsApi: configurar willResolveUpdateEnabledStudents o willRejectUpdateEnabledStudents antes de llamar updateEnabledStudents()');
    }
    if (this.nextUpdateEnabledStudents.kind === 'reject') throw this.nextUpdateEnabledStudents.error;
  }

  // --- iniciar ---
  private nextIniciar:
    | { kind: 'resolve' }
    | { kind: 'reject'; error: Error }
    | null = null;
  // `iniciarCalls` conserva la firma histórica (solo recordId) para no romper
  // los tests existentes; `iniciarCallsFull` registra también el duration para
  // los tests nuevos del override al iniciar.
  private iniciarCalls: string[] = [];
  private iniciarCallsFull: { recordId: string; duration?: number }[] = [];

  willResolveIniciar(): void {
    this.nextIniciar = { kind: 'resolve' };
  }

  willRejectIniciar(error: Error): void {
    this.nextIniciar = { kind: 'reject', error };
  }

  getIniciarCalls(): readonly string[] {
    return this.iniciarCalls;
  }

  getIniciarCallsFull(): readonly { recordId: string; duration?: number }[] {
    return this.iniciarCallsFull;
  }

  async iniciar(recordId: string, duration?: number): Promise<void> {
    this.iniciarCalls.push(recordId);
    this.iniciarCallsFull.push({ recordId, duration });
    if (!this.nextIniciar) {
      throw new Error('FakeTutorExamsApi: configurar willResolveIniciar o willRejectIniciar antes de llamar iniciar()');
    }
    if (this.nextIniciar.kind === 'reject') throw this.nextIniciar.error;
  }

  // --- finalizar ---
  private nextFinalizar:
    | { kind: 'resolve'; result: FinalizeResult }
    | { kind: 'reject'; error: Error }
    | null = null;
  private finalizarCalls: string[] = [];

  willResolveFinalizar(result: FinalizeResult): void {
    this.nextFinalizar = { kind: 'resolve', result };
  }

  willRejectFinalizar(error: Error): void {
    this.nextFinalizar = { kind: 'reject', error };
  }

  getFinalizarCalls(): readonly string[] {
    return this.finalizarCalls;
  }

  async finalizar(recordId: string): Promise<FinalizeResult> {
    this.finalizarCalls.push(recordId);
    if (!this.nextFinalizar) {
      throw new Error('FakeTutorExamsApi: configurar willResolveFinalizar o willRejectFinalizar antes de llamar finalizar()');
    }
    if (this.nextFinalizar.kind === 'reject') throw this.nextFinalizar.error;
    return this.nextFinalizar.result;
  }
}

// ---------------------------------------------------------------------------
// Doble manual del puerto `Clock`. Registra las llamadas a setServerTime
// para que los tests del use case puedan assertear que el side-effect ocurrió.
// `now()` devuelve el último ServerTime seteado, o new Date() como fallback.
export class FakeClock implements Clock {
  private currentServerTime: ServerTime | null = null;
  private setServerTimeCalls: ServerTime[] = [];

  now(): Date {
    return this.currentServerTime ? this.currentServerTime.value : new Date();
  }

  setServerTime(serverTime: ServerTime): void {
    this.currentServerTime = serverTime;
    this.setServerTimeCalls.push(serverTime);
  }

  getSetServerTimeCalls(): readonly ServerTime[] {
    return this.setServerTimeCalls;
  }
}
