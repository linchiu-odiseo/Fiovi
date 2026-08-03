// Tests del `authGuard` actualizado. Consume `GetIdentityUseCase`
// (renombrado de `GetActiveSessionUseCase`). Sin identity → `/login`,
// con identity → permite navegación.

import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter, UrlTree } from '@angular/router';
import { Component } from '@angular/core';
import { authGuard } from '../../../../src/L3_periphery/guards/auth.guard';
import { GetIdentityUseCase } from '../../../../src/L2_application/use-cases/get-identity.use-case';
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
  let fake: FakeGetIdentityUseCase;

  beforeEach(() => {
    fake = new FakeGetIdentityUseCase();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'login', component: DummyComponent },
          { path: 'student/home', component: DummyComponent },
          { path: 'tutor/home', component: DummyComponent },
        ]),
        { provide: GetIdentityUseCase, useValue: fake },
      ],
    });
  });

  it('permite la navegación si hay identity activa (student)', async () => {
    fake.willReturn(makeIdentity('student'));
    const result = await TestBed.runInInjectionContext(() =>
      authGuard(null as never, null as never),
    );
    expect(result).toBe(true);
  });

  it('permite la navegación si hay identity activa (tutor)', async () => {
    fake.willReturn(makeIdentity('tutor'));
    const result = await TestBed.runInInjectionContext(() =>
      authGuard(null as never, null as never),
    );
    expect(result).toBe(true);
  });

  it('redirige a /login si no hay identity', async () => {
    fake.willReturn(null);
    const result = (await TestBed.runInInjectionContext(() =>
      authGuard(null as never, null as never),
    )) as UrlTree;
    expect(result).toBeInstanceOf(UrlTree);
    expect(result.toString()).toBe('/login');
  });
});
