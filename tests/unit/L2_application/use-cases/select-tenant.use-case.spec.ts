import { describe, it, expect, beforeEach } from 'vitest';
import { SelectTenantUseCase } from '../../../../src/L2_application/use-cases/select-tenant.use-case';
import { Identity } from '../../../../src/L1_domain/entities/identity';
import { NetworkError } from '../../../../src/L1_domain/errors/network.error';
import { SelectionInvalidError } from '../../../../src/L1_domain/errors/selection-invalid.error';
import { FakeAuthRepository } from '../../fixtures/auth-repository.fake';
import { FakeIdentityStorage } from '../../fixtures/identity-storage.fake';
import { FakeProfileStorage } from '../../fixtures/profile-storage.fake';
import { FakeTenantSlugCache } from '../../fixtures/tenant-slug-cache.fake';
import { GetProfileUseCase } from '../../../../src/L2_application/use-cases/get-profile.use-case';

const NOW = 1_700_000_000_000;

const makeIdentity = () =>
  new Identity(
    '766aac21-71f9-4f48-a14a-5c2bcebc7d0b',
    '5fff5eec-34dc-40a2-b15e-10e503e7c2dc',
    'pitagoras',
    '79507732@vonex.edu.pe',
    '79507732',
    ['student'],
    [],
    NOW + 900_000,
  );

describe('SelectTenantUseCase', () => {
  let repo: FakeAuthRepository;
  let identityStorage: FakeIdentityStorage;
  let profileStorage: FakeProfileStorage;
  let slugCache: FakeTenantSlugCache;
  let useCase: SelectTenantUseCase;

  const input = { selectionToken: 'jwt.token', slug: 'pitagoras' };

  beforeEach(() => {
    repo = new FakeAuthRepository();
    identityStorage = new FakeIdentityStorage();
    profileStorage = new FakeProfileStorage();
    slugCache = new FakeTenantSlugCache();
    const getProfile = new GetProfileUseCase(profileStorage, repo);
    useCase = new SelectTenantUseCase(repo, identityStorage, slugCache, getProfile);
  });

  it('selección exitosa persiste identity, hidrata slugCache con el slug elegido y devuelve Identity', async () => {
    const identity = makeIdentity();
    repo.willResolveSelectTenant(identity);
    repo.willRejectProfile(new Error('no profile needed'));

    const result = await useCase.execute(input);

    expect(result).toBe(identity);
    expect(await identityStorage.read()).toBe(identity);
    expect(slugCache.current()).toBe('pitagoras');
    expect(repo.getSelectTenantCalls()).toEqual([input]);
  });

  it('SelectionInvalidError propaga y NO toca storage ni slugCache', async () => {
    repo.willRejectSelectTenant(new SelectionInvalidError());
    await expect(useCase.execute(input)).rejects.toBeInstanceOf(SelectionInvalidError);
    expect(await identityStorage.read()).toBeNull();
    expect(slugCache.current()).toBeNull();
  });

  it('NetworkError propaga sin tocar storage', async () => {
    repo.willRejectSelectTenant(new NetworkError());
    await expect(useCase.execute(input)).rejects.toBeInstanceOf(NetworkError);
    expect(await identityStorage.read()).toBeNull();
  });

  it('fire-and-forget: profile fetch fallido no bloquea', async () => {
    const identity = makeIdentity();
    repo.willResolveSelectTenant(identity);
    repo.willRejectProfile(new NetworkError('profile fetch failed'));

    const result = await useCase.execute(input);
    expect(result).toBe(identity);
  });
});
