import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GetIdentityUseCase } from '../../../../src/L2_application/use-cases/get-identity.use-case';
import { Identity } from '../../../../src/L1_domain/entities/identity';
import { ServerTime } from '../../../../src/L1_domain/value-objects/server-time';
import { FakeIdentityStorage } from '../../fixtures/identity-storage.fake';
import { FakeClock } from '../fakes';

const NOW = 1_700_000_000_000;

const makeIdentity = (expiresAt: number) =>
  new Identity(
    'uid',
    'tid',
    'vonex',
    'alumno@vonex.edu.pe',
    '79507732',
    ['student'],
    'student',
    expiresAt,
  );

describe('GetIdentityUseCase', () => {
  let storage: FakeIdentityStorage;
  let clock: FakeClock;
  let useCase: GetIdentityUseCase;

  beforeEach(() => {
    storage = new FakeIdentityStorage();
    clock = new FakeClock();
    useCase = new GetIdentityUseCase(storage, clock);
  });

  it('devuelve la Identity si existe y no está expirada', async () => {
    clock.setServerTime(new ServerTime(new Date(NOW).toISOString()));
    const identity = makeIdentity(NOW + 60_000); // expira en el futuro
    await storage.write(identity);
    expect(await useCase.execute()).toBe(identity);
  });

  it('devuelve null si el storage está vacío', async () => {
    expect(await useCase.execute()).toBeNull();
  });

  it('devuelve null si la identity está expirada', async () => {
    clock.setServerTime(new ServerTime(new Date(NOW).toISOString()));
    const identity = makeIdentity(NOW - 1000); // ya expiró
    await storage.write(identity);
    expect(await useCase.execute()).toBeNull();
  });

  describe('desvío del reloj local del dispositivo', () => {
    const SERVER_NOW = NOW;
    const DEVICE_SKEW_MS = 30 * 60_000;

    beforeEach(() => {
      vi.useFakeTimers();
      // Reloj local del dispositivo adelantado 30 minutos respecto del server.
      vi.setSystemTime(SERVER_NOW + DEVICE_SKEW_MS);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('Clock calibrado con el serverTime real: identity se evalúa como válida', async () => {
      // expiresAt es un timestamp real y futuro del servidor (5 min desde
      // SERVER_NOW), pero ya estaría "vencido" si se evaluara contra el
      // reloj adelantado del dispositivo.
      const identity = makeIdentity(SERVER_NOW + 5 * 60_000);
      await storage.write(identity);
      clock.setServerTime(new ServerTime(new Date(SERVER_NOW).toISOString()));

      expect(await useCase.execute()).toBe(identity);
    });

    it('Clock NO calibrado (offset 0, igual a Date.now()): identity se evalúa como expirada', async () => {
      const identity = makeIdentity(SERVER_NOW + 5 * 60_000);
      await storage.write(identity);
      // Sin setServerTime: FakeClock.now() cae al fallback `new Date()`,
      // que lee el reloj del sistema (adelantado por vi.setSystemTime) —
      // reproduce el bug que este change corrige para el caso calibrado.

      expect(await useCase.execute()).toBeNull();
    });
  });
});
