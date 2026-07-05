import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RetomarEnviosPendientesUseCase } from '../../../src/L2_application/use-cases/retomar-envios-pendientes.use-case';
import { SubmissionAck } from '../../../src/L1_domain/value-objects/submission-ack';
import { NetworkError } from '../../../src/L1_domain/errors/network.error';
import { SimulacroCerradoError } from '../../../src/L1_domain/errors/simulacro-cerrado.error';
import { SimulacroNoAsignadoError } from '../../../src/L1_domain/errors/simulacro-no-asignado.error';
import { InvalidSubmissionTimeError } from '../../../src/L1_domain/errors/invalid-submission-time.error';
import { InvalidPayloadError } from '../../../src/L1_domain/errors/invalid-payload.error';
import { FakeExamsApi, InMemoryMarkingsStorage } from './fakes';

// Cubre `RetomarEnviosPendientesUseCase` (L2):
// retry automático de envíos encolados cuando vuelve la red. En el cambio
// `fase-3-exam-submit-learnex` se agrega persistencia de ack tras éxito
// (antes de dequeue) y reconstrucción del body con `code` del payload.
describe('RetomarEnviosPendientesUseCase', () => {
  let api: FakeExamsApi;
  let storage: InMemoryMarkingsStorage;
  let useCase: RetomarEnviosPendientesUseCase;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  const VALID_HASH = 'a3f5c8d1b2e4f6a8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
  const VALID_CODIGO = '79507732';

  const buildAck = (id = 'ack-1', submittedIso = '2026-06-11T09:00:01.000Z'): SubmissionAck =>
    new SubmissionAck(id, VALID_HASH, new Date(submittedIso));

  beforeEach(() => {
    api = new FakeExamsApi();
    storage = new InMemoryMarkingsStorage();
    useCase = new RetomarEnviosPendientesUseCase(api, storage);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('cola vacía', () => {
    it('no invoca api.enviar cuando la cola está vacía', async () => {
      await useCase.execute();

      expect(api.getEnviarCalls()).toHaveLength(0);
      expect(storage.getOpsLog()).not.toContain('markings.dequeueEnvio');
      expect(storage.getOpsLog()).not.toContain('markings.clearMarcaciones');
    });
  });

  describe('1 envío en cola — éxito', () => {
    it('despacha con el envío exacto (preservando code, responses y clientFinishedAt original)', async () => {
      storage.seedMarcacion('sim-1', 1, 'A');
      storage.seedEnvio({
        examId: 'sim-1',
        code: VALID_CODIGO,
        answers: { '1': 'A' },
        clientFinishedAt: '2026-06-11T08:55:00.000Z',
      });
      api.willResolveEnviar({ ack: buildAck() });

      await useCase.execute();

      const calls = api.getEnviarCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        examId: 'sim-1',
        code: VALID_CODIGO,
        // Entry sembrada SIN admissionArea (legacy pre-rollout) →
        // el use case aplica DEFAULT_ADMISSION_AREA en el retry.
        admissionArea: 'GENERAL',
        responses: { P1: 'A' },
        clientFinishedAt: '2026-06-11T08:55:00.000Z',
      });
    });

    // SCENARIO crítico del spec exam-submission "Queue replay exitoso persiste
    // ack y dequeue": el orden es setSubmissionAck → dequeue → clearMarcaciones.
    // Si la app se cierra entre dequeue y setSubmissionAck, el ack se pierde.
    it('persiste ack ANTES de dequeue + clearMarcaciones', async () => {
      const ack = buildAck();
      storage.seedMarcacion('sim-1', 1, 'A');
      storage.seedEnvio({
        examId: 'sim-1',
        code: VALID_CODIGO,
        answers: { '1': 'A' },
        clientFinishedAt: '2026-06-11T08:55:00.000Z',
      });
      api.willResolveEnviar({ ack });

      await useCase.execute();

      // Ack persistido (la card de /home leerá esto al refrescar).
      const persisted = await storage.getSubmissionAck('sim-1');
      expect(persisted?.submissionHash).toBe(VALID_HASH);

      // Y el orden de ops respeta el invariante.
      const log = storage.getOpsLog();
      const setIdx = log.indexOf('markings.setSubmissionAck');
      const dequeueIdx = log.indexOf('markings.dequeueEnvio');
      const clearIdx = log.indexOf('markings.clearMarcaciones');
      expect(setIdx).toBeGreaterThanOrEqual(0);
      expect(dequeueIdx).toBeGreaterThan(setIdx);
      expect(clearIdx).toBeGreaterThan(setIdx);
    });

    it('dequeue + clearMarcaciones tras éxito', async () => {
      storage.seedMarcacion('sim-1', 1, 'A');
      storage.seedEnvio({
        examId: 'sim-1',
        code: VALID_CODIGO,
        answers: { '1': 'A' },
        clientFinishedAt: '2026-06-11T08:55:00.000Z',
      });
      api.willResolveEnviar({ ack: buildAck() });

      await useCase.execute();

      expect(await storage.getEnviosPendientes()).toEqual([]);
      expect(await storage.getMarcaciones('sim-1')).toEqual({});
      expect(storage.getOpsLog()).toContain('markings.dequeueEnvio');
      expect(storage.getOpsLog()).toContain('markings.clearMarcaciones');
    });
  });

  describe('3 envíos en cola — todos éxito', () => {
    it('procesa los 3 en orden, setSubmissionAck + dequeue + clearMarcaciones por cada uno', async () => {
      const ts = (suffix: string) => `2026-06-11T08:${suffix}.000Z`;
      storage.seedEnvio({
        examId: 'sim-1',
        code: VALID_CODIGO,
        answers: { '1': 'A' },
        clientFinishedAt: ts('50:00'),
      });
      storage.seedEnvio({
        examId: 'sim-2',
        code: VALID_CODIGO,
        answers: { '1': 'B' },
        clientFinishedAt: ts('52:00'),
      });
      storage.seedEnvio({
        examId: 'sim-3',
        code: VALID_CODIGO,
        answers: { '1': 'C' },
        clientFinishedAt: ts('54:00'),
      });
      api.willEnviarInSequence([
        { kind: 'resolve', result: { ack: buildAck('ack-1') } },
        { kind: 'resolve', result: { ack: buildAck('ack-2') } },
        { kind: 'resolve', result: { ack: buildAck('ack-3') } },
      ]);

      await useCase.execute();

      expect(api.getEnviarCalls()).toHaveLength(3);
      expect(await storage.getEnviosPendientes()).toEqual([]);
      const log = storage.getOpsLog();
      expect(log.filter((op) => op === 'markings.setSubmissionAck')).toHaveLength(3);
      expect(log.filter((op) => op === 'markings.dequeueEnvio')).toHaveLength(3);
      expect(log.filter((op) => op === 'markings.clearMarcaciones')).toHaveLength(3);
    });
  });

  describe('NetworkError durante el despacho', () => {
    it('deja en cola (NO dequeue ni clearMarcaciones ni setSubmissionAck) para retry futuro', async () => {
      storage.seedMarcacion('sim-1', 1, 'A');
      storage.seedEnvio({
        examId: 'sim-1',
        code: VALID_CODIGO,
        answers: { '1': 'A' },
        clientFinishedAt: '2026-06-11T08:55:00.000Z',
      });
      api.willRejectEnviar(new NetworkError());

      await useCase.execute();

      // La cola sigue intacta.
      expect(await storage.getEnviosPendientes()).toHaveLength(1);
      // Las marcaciones tampoco se borraron.
      expect(await storage.getMarcaciones('sim-1')).toEqual({ '1': 'A' });
      // Y no se persistió ack.
      expect(await storage.getSubmissionAck('sim-1')).toBeNull();
      expect(storage.getOpsLog()).not.toContain('markings.dequeueEnvio');
      expect(storage.getOpsLog()).not.toContain('markings.clearMarcaciones');
      expect(storage.getOpsLog()).not.toContain('markings.setSubmissionAck');
    });
  });

  describe('4xx no recuperables → descarta + warn', () => {
    const NO_RECUPERABLES: readonly [string, () => Error][] = [
      ['SimulacroCerradoError', () => new SimulacroCerradoError()],
      ['SimulacroNoAsignadoError', () => new SimulacroNoAsignadoError()],
      ['InvalidSubmissionTimeError', () => new InvalidSubmissionTimeError()],
      ['InvalidPayloadError', () => new InvalidPayloadError()],
    ];

    it.each(NO_RECUPERABLES)(
      '%s → dequeue + clearMarcaciones + console.warn (sin setSubmissionAck)',
      async (_name, build) => {
        storage.seedMarcacion('sim-1', 1, 'A');
        storage.seedEnvio({
          examId: 'sim-1',
          code: VALID_CODIGO,
          answers: { '1': 'A' },
          clientFinishedAt: '2026-06-11T08:55:00.000Z',
        });
        api.willRejectEnviar(build());

        await useCase.execute();

        expect(await storage.getEnviosPendientes()).toEqual([]);
        expect(await storage.getMarcaciones('sim-1')).toEqual({});
        expect(await storage.getSubmissionAck('sim-1')).toBeNull();
        expect(storage.getOpsLog()).toContain('markings.dequeueEnvio');
        expect(storage.getOpsLog()).toContain('markings.clearMarcaciones');
        expect(storage.getOpsLog()).not.toContain('markings.setSubmissionAck');
        expect(warnSpy).toHaveBeenCalled();
      },
    );
  });

  describe('admissionArea — preserva del EnvioPendiente + fallback legacy', () => {
    // Entries encoladas ANTES del rollout de `add-admission-area` no tienen
    // el campo (opcional en EnvioPendiente). El use case aplica
    // DEFAULT_ADMISSION_AREA como fallback sin persistir.
    it('entry sembrada con admissionArea → el adapter recibe ese mismo valor', async () => {
      storage.seedEnvio({
        examId: 'sim-1',
        code: VALID_CODIGO,
        admissionArea: 'MAT',
        answers: { '1': 'A' },
        clientFinishedAt: '2026-06-11T08:55:00.000Z',
      });
      api.willResolveEnviar({ ack: buildAck() });

      await useCase.execute();

      expect(api.getEnviarCalls()[0].admissionArea).toBe('MAT');
    });

    it('entry legacy sin admissionArea → el adapter recibe GENERAL (fallback)', async () => {
      storage.seedEnvio({
        examId: 'sim-1',
        code: VALID_CODIGO,
        // admissionArea intencionalmente omitido — simula una entry encolada
        // por una versión previa de la PWA (opcional en el shape del port).
        answers: { '1': 'A' },
        clientFinishedAt: '2026-06-11T08:55:00.000Z',
      });
      api.willResolveEnviar({ ack: buildAck() });

      await useCase.execute();

      expect(api.getEnviarCalls()[0].admissionArea).toBe('GENERAL');
    });
  });

  describe('mix de resultados', () => {
    it('NetworkError en el primer envío + éxito en el segundo → solo el segundo se dequeue y persiste ack', async () => {
      storage.seedMarcacion('sim-1', 1, 'A');
      storage.seedMarcacion('sim-2', 1, 'B');
      storage.seedEnvio({
        examId: 'sim-1',
        code: VALID_CODIGO,
        answers: { '1': 'A' },
        clientFinishedAt: '2026-06-11T08:55:00.000Z',
      });
      storage.seedEnvio({
        examId: 'sim-2',
        code: VALID_CODIGO,
        answers: { '1': 'B' },
        clientFinishedAt: '2026-06-11T08:56:00.000Z',
      });
      api.willEnviarInSequence([
        { kind: 'reject', error: new NetworkError() },
        { kind: 'resolve', result: { ack: buildAck('ack-2') } },
      ]);

      await useCase.execute();

      // sim-1 sigue en cola; sim-2 se procesó.
      const pendientes = await storage.getEnviosPendientes();
      expect(pendientes).toHaveLength(1);
      expect(pendientes[0].examId).toBe('sim-1');
      expect(await storage.getMarcaciones('sim-1')).toEqual({ '1': 'A' });
      expect(await storage.getMarcaciones('sim-2')).toEqual({});
      // Solo sim-2 tiene ack persistido.
      expect(await storage.getSubmissionAck('sim-1')).toBeNull();
      const sim2Ack = await storage.getSubmissionAck('sim-2');
      expect(sim2Ack?.id).toBe('ack-2');
    });
  });
});
