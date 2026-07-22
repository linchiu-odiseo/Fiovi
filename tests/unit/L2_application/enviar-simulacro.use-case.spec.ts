import { describe, it, expect, beforeEach } from 'vitest';
import {
  EnviarSimulacroUseCase,
  responsesFromAnswers,
} from '../../../src/L2_application/use-cases/enviar-simulacro.use-case';
import { Identity } from '../../../src/L1_domain/entities/identity';
import { ServerTime } from '../../../src/L1_domain/value-objects/server-time';
import { SubmissionAck } from '../../../src/L1_domain/value-objects/submission-ack';
import { NetworkError } from '../../../src/L1_domain/errors/network.error';
import { SessionExpiredError } from '../../../src/L1_domain/errors/session-expired.error';
import { SimulacroCerradoError } from '../../../src/L1_domain/errors/simulacro-cerrado.error';
import { SimulacroNoAsignadoError } from '../../../src/L1_domain/errors/simulacro-no-asignado.error';
import { InvalidSubmissionTimeError } from '../../../src/L1_domain/errors/invalid-submission-time.error';
import { InvalidPayloadError } from '../../../src/L1_domain/errors/invalid-payload.error';
import { StudentNotEnrolledError } from '../../../src/L1_domain/errors/student-not-enrolled.error';
import { FakeClock, FakeExamsApi, FakeIdentityStorage, InMemoryMarkingsStorage } from './fakes';

// Cubre `EnviarSimulacroUseCase` (L2) según los scenarios del spec
// `exam-submission` del cambio `fase-3-exam-submit-learnex`:
// - Lectura de identidad para resolver `code` (DNI)
// - Reshape de AnswersMap → responses con prefijo P y filtro de null
// - Persistencia del ack tras éxito + limpieza de marcaciones
// - Encolado del payload completo (incluyendo code) en NetworkError
// - Propagación de errores no-recuperables sin tocar storage
// - SessionExpiredError defensivo cuando identity es null o codigo es null
describe('EnviarSimulacroUseCase', () => {
  let api: FakeExamsApi;
  let storage: InMemoryMarkingsStorage;
  let clock: FakeClock;
  let identityStorage: FakeIdentityStorage;
  let useCase: EnviarSimulacroUseCase;

  // ServerTime anclado para que clock.now() sea predecible en el test.
  const SERVER_NOW_ISO = '2026-06-11T08:47:05.000Z';
  // DNI seed coincide con el del alumno de dev.
  const VALID_CODIGO = '79507732';
  const VALID_EMAIL = '79507732@vonex.edu.pe';
  // Hash válido (64 hex chars) para construir SubmissionAck en tests.
  const VALID_HASH = 'a3f5c8d1b2e4f6a8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

  const validAck = (): SubmissionAck =>
    new SubmissionAck('ack-1', VALID_HASH, new Date('2026-06-11T08:47:06.000Z'));

  const studentIdentity = (codigo: string | null = VALID_CODIGO): Identity =>
    new Identity(
      'user-id',
      'tenant-id',
      'vonex',
      VALID_EMAIL,
      codigo,
      ['student'],
      Date.now() + 900_000,
    );

  beforeEach(async () => {
    api = new FakeExamsApi();
    storage = new InMemoryMarkingsStorage();
    clock = new FakeClock();
    clock.setServerTime(new ServerTime(SERVER_NOW_ISO));
    identityStorage = new FakeIdentityStorage();
    await identityStorage.write(studentIdentity());
    useCase = new EnviarSimulacroUseCase(api, storage, clock, identityStorage);
  });

  describe('happy path — éxito 201', () => {
    it('POST incluye code (DNI), responses derivadas de answers, y clientFinishedAt = clock.now()', async () => {
      storage.seedMarcacion('exam-1', 1, 'A');
      storage.seedMarcacion('exam-1', 2, 'C');
      api.willResolveEnviar({ ack: validAck() });

      const result = await useCase.execute({ examId: 'exam-1' });

      const calls = api.getEnviarCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].examId).toBe('exam-1');
      expect(calls[0].code).toBe(VALID_CODIGO);
      expect(calls[0].responses).toEqual({ P1: 'A', P2: 'C' });
      expect(calls[0].clientFinishedAt).toBe(SERVER_NOW_ISO);
      expect(result.status).toBe('enviado');
      expect(result.ack).not.toBeNull();
      expect(result.ack?.submissionHash).toBe(VALID_HASH);
    });

    it('persiste el ack en storage tras éxito (setSubmissionAck antes de clearMarcaciones)', async () => {
      const ack = validAck();
      storage.seedMarcacion('exam-1', 1, 'A');
      api.willResolveEnviar({ ack });

      await useCase.execute({ examId: 'exam-1' });

      const persisted = await storage.getSubmissionAck('exam-1');
      expect(persisted).not.toBeNull();
      expect(persisted?.submissionHash).toBe(ack.submissionHash);
      expect(persisted?.id).toBe(ack.id);

      // Orden importa: setSubmissionAck debe ocurrir ANTES de clearMarcaciones
      // (si el clear corre primero y el set falla, perderíamos el ack pero
      // ya no tendríamos las marcaciones para recuperarlo).
      const log = storage.getOpsLog();
      const setIdx = log.indexOf('markings.setSubmissionAck');
      const clearIdx = log.indexOf('markings.clearMarcaciones');
      expect(setIdx).toBeGreaterThanOrEqual(0);
      expect(clearIdx).toBeGreaterThan(setIdx);
    });

    it('tras éxito, las marcaciones del examen se borran del storage', async () => {
      storage.seedMarcacion('exam-1', 1, 'A');
      storage.seedMarcacion('exam-1', 2, 'C');
      api.willResolveEnviar({ ack: validAck() });

      await useCase.execute({ examId: 'exam-1' });

      expect(await storage.getMarcaciones('exam-1')).toEqual({});
      expect(storage.getOpsLog()).toContain('markings.clearMarcaciones');
    });

    it('marcaciones de OTRO examen NO se borran tras éxito en exam-1', async () => {
      storage.seedMarcacion('exam-1', 1, 'A');
      storage.seedMarcacion('exam-2', 1, 'B');
      api.willResolveEnviar({ ack: validAck() });

      await useCase.execute({ examId: 'exam-1' });

      expect(await storage.getMarcaciones('exam-2')).toEqual({ '1': 'B' });
    });
  });

  describe('reshape de AnswersMap → responses con prefijo P y filtro de null', () => {
    it('AnswersMap con nulls produce responses solo con marcadas, keys con prefijo P', async () => {
      storage.seedMarcacion('exam-1', 1, 'A');
      storage.seedMarcacion('exam-1', 2, null);
      storage.seedMarcacion('exam-1', 5, 'D');
      api.willResolveEnviar({ ack: validAck() });

      await useCase.execute({ examId: 'exam-1' });

      expect(api.getEnviarCalls()[0].responses).toEqual({ P1: 'A', P5: 'D' });
    });

    it('AnswersMap vacío produce responses vacío (entrega en blanco válida)', async () => {
      api.willResolveEnviar({ ack: validAck() });

      await useCase.execute({ examId: 'exam-1' });

      expect(api.getEnviarCalls()[0].responses).toEqual({});
    });

    it('helper exportado `responsesFromAnswers` aplica la misma transformación', () => {
      // RetomarEnviosPendientesUseCase reusa este helper. Garantizamos que
      // la convención se respeta sin pasar por el use case.
      expect(responsesFromAnswers({ '1': 'A', '2': null, '3': 'E' })).toEqual({
        P1: 'A',
        P3: 'E',
      });
      expect(responsesFromAnswers({})).toEqual({});
      expect(responsesFromAnswers({ '1': null, '2': null })).toEqual({});
    });
  });

  describe('clientFinishedAtOverride (auto-envío)', () => {
    it('cuando se pasa override, POST usa esa Date.toISOString() — NO clock.now()', async () => {
      const FIN_ISO = '2026-06-11T09:00:00.000Z';
      const fin = new Date(FIN_ISO);
      api.willResolveEnviar({ ack: validAck() });

      await useCase.execute({
        examId: 'exam-1',
        clientFinishedAtOverride: fin,
      });

      const calls = api.getEnviarCalls();
      expect(calls).toHaveLength(1);
      // Crítico: clientFinishedAt == fin del examen, NO clock.now()
      // (que estaría en SERVER_NOW_ISO 8:47:05).
      expect(calls[0].clientFinishedAt).toBe(FIN_ISO);
      expect(calls[0].clientFinishedAt).not.toBe(SERVER_NOW_ISO);
    });
  });

  describe('admissionArea — propagación al EnvioRequest + encolado', () => {
    // El use case lee `MarkingsStorage.getAdmissionArea(examId)` con
    // fallback DEFAULT_ADMISSION_AREA (design.md D3 de `add-admission-area`).
    // El default NO se persiste — el fake refleja eso (nunca setAdmissionArea).
    it('area sembrada con seedAdmissionArea se propaga al EnvioRequest', async () => {
      storage.seedMarcacion('exam-1', 1, 'A');
      storage.seedAdmissionArea('exam-1', 'MAT');
      api.willResolveEnviar({ ack: validAck() });

      await useCase.execute({ examId: 'exam-1' });

      expect(api.getEnviarCalls()[0].admissionArea).toBe('MAT');
    });

    it('sin sembrar (storage retorna null) → EnvioRequest recibe GENERAL', async () => {
      storage.seedMarcacion('exam-1', 1, 'A');
      // NO se llama seedAdmissionArea → getAdmissionArea() retorna null.
      api.willResolveEnviar({ ack: validAck() });

      await useCase.execute({ examId: 'exam-1' });

      expect(api.getEnviarCalls()[0].admissionArea).toBe('GENERAL');
    });

    it('el use case NUNCA invoca setAdmissionArea (default NO se persiste)', async () => {
      storage.seedMarcacion('exam-1', 1, 'A');
      // Sin sembrar: el use case resuelve GENERAL en memoria y lo pasa al
      // adapter, pero NO llama setAdmissionArea. Esto preserva la distinción
      // "eligió GENERAL" vs "todavía no eligió" (D3).
      api.willResolveEnviar({ ack: validAck() });

      await useCase.execute({ examId: 'exam-1' });

      expect(storage.getOpsLog()).not.toContain('markings.setAdmissionArea');
    });

    it('en NetworkError, el EnvioPendiente guardado incluye el admissionArea resuelto', async () => {
      storage.seedMarcacion('exam-1', 1, 'A');
      storage.seedAdmissionArea('exam-1', 'CIE');
      api.willRejectEnviar(new NetworkError());

      const result = await useCase.execute({ examId: 'exam-1' });

      expect(result.status).toBe('queued');
      const pendientes = await storage.getEnviosPendientes();
      expect(pendientes).toHaveLength(1);
      // El area encolada es la misma que fue al adapter (aunque el adapter
      // no llegó a recibirla por el NetworkError). El dispatcher del retry
      // usa esta area sin re-consultar storage (design.md `admission-area`
      // spec: "el cliente conserva el admissionArea original entre intento,
      // encolado y retry").
      expect(pendientes[0].admissionArea).toBe('CIE');
    });
  });

  describe('identity ausente → SessionExpiredError defensivo', () => {
    it('IdentityStorage.read() === null → SessionExpiredError sin tocar el adapter', async () => {
      await identityStorage.clear();
      storage.seedMarcacion('exam-1', 1, 'A');
      // Configuramos el api también para detectar invocación accidental.
      api.willResolveEnviar({ ack: validAck() });

      await expect(useCase.execute({ examId: 'exam-1' })).rejects.toBeInstanceOf(
        SessionExpiredError,
      );

      // El adapter NUNCA fue invocado.
      expect(api.getEnviarCalls()).toEqual([]);
      // Y el storage no fue mutado.
      expect(await storage.getMarcaciones('exam-1')).toEqual({ '1': 'A' });
      expect(storage.getOpsLog()).not.toContain('markings.setSubmissionAck');
      expect(storage.getOpsLog()).not.toContain('markings.clearMarcaciones');
    });

    it('identity con codigo === null (caso tutor stub) → SessionExpiredError defensivo', async () => {
      // El tutor stub tiene codigo null. Bajo guard de student no debería
      // llegar acá, pero el use case defiende igual: sin codigo no hay POST.
      await identityStorage.write(studentIdentity(null));
      api.willResolveEnviar({ ack: validAck() });

      await expect(useCase.execute({ examId: 'exam-1' })).rejects.toBeInstanceOf(
        SessionExpiredError,
      );

      expect(api.getEnviarCalls()).toEqual([]);
    });
  });

  describe('NetworkError → encolado del payload completo', () => {
    it('encola con el code, responses, clientFinishedAt y examId originales', async () => {
      storage.seedMarcacion('exam-1', 1, 'A');
      storage.seedMarcacion('exam-1', 2, 'B');
      api.willRejectEnviar(new NetworkError());

      const result = await useCase.execute({ examId: 'exam-1' });

      expect(result.status).toBe('queued');
      expect(result.ack).toBeNull();

      const pendientes = await storage.getEnviosPendientes();
      expect(pendientes).toHaveLength(1);
      expect(pendientes[0]).toEqual({
        examId: 'exam-1',
        code: VALID_CODIGO,
        // Sin seedAdmissionArea, el use case usa DEFAULT_ADMISSION_AREA
        // (design.md D3 de `add-admission-area`).
        admissionArea: 'GENERAL',
        answers: { '1': 'A', '2': 'B' },
        clientFinishedAt: SERVER_NOW_ISO,
      });
      expect(storage.getOpsLog()).toContain('markings.enqueueEnvio');
    });

    it('NO borra las marcaciones del storage cuando queda en cola', async () => {
      storage.seedMarcacion('exam-1', 1, 'A');
      api.willRejectEnviar(new NetworkError());

      await useCase.execute({ examId: 'exam-1' });

      expect(await storage.getMarcaciones('exam-1')).toEqual({ '1': 'A' });
      expect(storage.getOpsLog()).not.toContain('markings.clearMarcaciones');
    });

    it('NO persiste ack cuando queda en cola', async () => {
      api.willRejectEnviar(new NetworkError());

      await useCase.execute({ examId: 'exam-1' });

      expect(await storage.getSubmissionAck('exam-1')).toBeNull();
      expect(storage.getOpsLog()).not.toContain('markings.setSubmissionAck');
    });

    it('con override, encola preservando el override como clientFinishedAt', async () => {
      const FIN_ISO = '2026-06-11T09:00:00.000Z';
      storage.seedMarcacion('exam-1', 1, 'A');
      api.willRejectEnviar(new NetworkError());

      const result = await useCase.execute({
        examId: 'exam-1',
        clientFinishedAtOverride: new Date(FIN_ISO),
      });

      expect(result.status).toBe('queued');
      const pendientes = await storage.getEnviosPendientes();
      expect(pendientes[0].clientFinishedAt).toBe(FIN_ISO);
    });
  });

  describe('errores de dominio propagados (no encolan, no borran, no persisten ack)', () => {
    const ESCENARIOS: readonly [string, () => Error][] = [
      ['SimulacroCerradoError', () => new SimulacroCerradoError()],
      ['SimulacroNoAsignadoError', () => new SimulacroNoAsignadoError()],
      ['InvalidSubmissionTimeError', () => new InvalidSubmissionTimeError()],
      ['InvalidPayloadError', () => new InvalidPayloadError()],
      ['StudentNotEnrolledError', () => new StudentNotEnrolledError()],
      ['SessionExpiredError', () => new SessionExpiredError()],
    ];

    it.each(ESCENARIOS)('propaga %s sin tocar storage', async (_name, build) => {
      storage.seedMarcacion('exam-1', 1, 'A');
      const error = build();
      api.willRejectEnviar(error);

      await expect(useCase.execute({ examId: 'exam-1' })).rejects.toBe(error);

      // Marcaciones intactas.
      expect(await storage.getMarcaciones('exam-1')).toEqual({ '1': 'A' });
      // No se encoló.
      expect(await storage.getEnviosPendientes()).toEqual([]);
      // No se persistió ack.
      expect(await storage.getSubmissionAck('exam-1')).toBeNull();
      // No se hizo set/clear ni enqueue (solo getMarcaciones está permitido en el path).
      expect(storage.getOpsLog()).not.toContain('markings.clearMarcaciones');
      expect(storage.getOpsLog()).not.toContain('markings.enqueueEnvio');
      expect(storage.getOpsLog()).not.toContain('markings.setSubmissionAck');
    });
  });
});
