// Tests del `publicOnlyGuard` actualizado.
// - Sin identity → permite (`true`).
// - Con identity → redirige a `/{role}/home` según `identity.role()`.

import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter, UrlTree } from '@angular/router';
import { Component } from '@angular/core';
import { publicOnlyGuard } from '../../../../src/L3_periphery/guards/public-only.guard';
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

function makeIdentity(role: 'student' | 'tutor'): Identity {
  return new Identity(
    'user-id',
    'tenant-id',
    'vonex',
    role === 'student' ? '79507732@vonex.edu.pe' : 'tutor1@vonex.pe',
    role === 'student' ? '79507732' : null,
    [role],
    role,
    Date.now() + 900_000,
  );
}

describe('publicOnlyGuard', () => {
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

  it('permite la navegación si no hay identity (login usable)', async () => {
    fake.willReturn(null);
    const result = await TestBed.runInInjectionContext(() =>
      publicOnlyGuard(null as never, null as never),
    );
    expect(result).toBe(true);
  });

  it('redirige a /student/home si hay identity con rol student', async () => {
    fake.willReturn(makeIdentity('student'));
    const result = (await TestBed.runInInjectionContext(() =>
      publicOnlyGuard(null as never, null as never),
    )) as UrlTree;
    expect(result).toBeInstanceOf(UrlTree);
    expect(result.toString()).toBe('/student/home');
  });

  it('redirige a /tutor/home si hay identity con rol tutor', async () => {
    fake.willReturn(makeIdentity('tutor'));
    const result = (await TestBed.runInInjectionContext(() =>
      publicOnlyGuard(null as never, null as never),
    )) as UrlTree;
    expect(result).toBeInstanceOf(UrlTree);
    expect(result.toString()).toBe('/tutor/home');
  });
});
