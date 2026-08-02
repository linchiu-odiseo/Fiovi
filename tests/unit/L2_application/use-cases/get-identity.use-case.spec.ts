import { describe, it, expect, beforeEach } from 'vitest';
import { GetIdentityUseCase } from '../../../../src/L2_application/use-cases/get-identity.use-case';
import { Identity } from '../../../../src/L1_domain/entities/identity';
import { FakeIdentityStorage } from '../../fixtures/identity-storage.fake';

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
  let nowMs: () => number;
  let useCase: GetIdentityUseCase;

  beforeEach(() => {
    storage = new FakeIdentityStorage();
    nowMs = () => NOW;
    useCase = new GetIdentityUseCase(storage, nowMs);
  });

  it('devuelve la Identity si existe y no está expirada', async () => {
    const identity = makeIdentity(NOW + 60_000); // expira en el futuro
    await storage.write(identity);
    expect(await useCase.execute()).toBe(identity);
  });

  it('devuelve null si el storage está vacío', async () => {
    expect(await useCase.execute()).toBeNull();
  });

  it('devuelve null si la identity está expirada', async () => {
    const identity = makeIdentity(NOW - 1000); // ya expiró
    await storage.write(identity);
    expect(await useCase.execute()).toBeNull();
  });

  it('nowMs inyectado permite control del tiempo', async () => {
    const identity = makeIdentity(NOW + 60_000);
    await storage.write(identity);
    // Simular que el tiempo avanzó más allá de expiresAt
    const futureNow = () => NOW + 120_000;
    const ucFuture = new GetIdentityUseCase(storage, futureNow);
    expect(await ucFuture.execute()).toBeNull();
  });
});
