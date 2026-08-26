// Tests del `authGuard`. Si hay identity activa → permite. Si no hay,
// intenta refresh: si refresca → permite; si falla → redirige a /login.

import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter, UrlTree } from '@angular/router';
import { Component } from '@angular/core';
import { authGuard } from '../../../../src/L3_periphery/guards/auth.guard';
import { GetIdentityUseCase } from '../../../../src/L2_application/use-cases/get-identity.use-case';
import { RefreshIdentityUseCase } from '../../../../src/L2_application/use-cases/refresh-identity.use-case';
import { Identity } from '../../../../src/L1_domain/entities/identity';

class FakeGetIdentityUseCase {
  private next: Identity | null = null;
  willReturn(i: Identity | null): void {
    this.next = i;
  }
  async execute(): Promise<Identity | null> {
    return this.next;
  }
}

class FakeRefreshIdentityUseCase {
  private shouldFail = false;
  private refreshed: Identity | null = null;
  willSucceedWith(i: Identity): void {
    this.shouldFail = false;
    this.refreshed = i;
  }
  willFail(): void {
    this.shouldFail = true;
  }
  async execute(): Promise<Identity> {
    if (this.shouldFail) throw new Error('refresh failed');
    return this.refreshed!;
  }
}

@Component({ standalone: true, template: '' })
class DummyComponent {}

function makeIdentity(role: 'student' | 'tutor' = 'student'): Identity {
  return new Identity(
    'user-id',
    'tenant-id',
    'vonex',
    'alumno@vonex.edu.pe',
    '79507732',
    [role],
    role,
    Date.now() + 900_000,
  );
}

describe('authGuard', () => {
  let fakeGet: FakeGetIdentityUseCase;
  let fakeRefresh: FakeRefreshIdentityUseCase;

  beforeEach(() => {
    fakeGet = new FakeGetIdentityUseCase();
    fakeRefresh = new FakeRefreshIdentityUseCase();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'login', component: DummyComponent },
          { path: 'student/home', component: DummyComponent },
          { path: 'tutor/home', component: DummyComponent },
        ]),
        { provide: GetIdentityUseCase, useValue: fakeGet },
        { provide: RefreshIdentityUseCase, useValue: fakeRefresh },
      ],
    });
  });

  it('permite la navegación si hay identity activa (student)', async () => {
    fakeGet.willReturn(makeIdentity('student'));
    const result = await TestBed.runInInjectionContext(() =>
      authGuard(null as never, null as never),
    );
    expect(result).toBe(true);
  });

  it('permite la navegación si hay identity activa (tutor)', async () => {
    fakeGet.willReturn(makeIdentity('tutor'));
    const result = await TestBed.runInInjectionContext(() =>
      authGuard(null as never, null as never),
    );
    expect(result).toBe(true);
  });

  it('refresca y permite si la identity venció pero la refresh-cookie sigue viva', async () => {
    fakeGet.willReturn(null);
    fakeRefresh.willSucceedWith(makeIdentity('student'));
    const result = await TestBed.runInInjectionContext(() =>
      authGuard(null as never, null as never),
    );
    expect(result).toBe(true);
  });

  it('redirige a /login si no hay identity y el refresh falla', async () => {
    fakeGet.willReturn(null);
    fakeRefresh.willFail();
    const result = (await TestBed.runInInjectionContext(() =>
      authGuard(null as never, null as never),
    )) as UrlTree;
    expect(result).toBeInstanceOf(UrlTree);
    expect(result.toString()).toBe('/login');
  });
});
