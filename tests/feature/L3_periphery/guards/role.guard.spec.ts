// Tests del factory `roleGuard(role)`.
//
// - rol match → `true`.
// - rol mismatch → redirect a `/{identity.role()}/home` (no /login).
// - sin identity → redirect a `/login`.

import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter, UrlTree } from '@angular/router';
import { Component } from '@angular/core';
import { roleGuard } from '../../../../src/L3_periphery/guards/role.guard';
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

describe('roleGuard', () => {
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

  describe("roleGuard('student')", () => {
    it('permite la navegación si identity.role() === "student"', async () => {
      fake.willReturn(makeIdentity('student'));
      const guard = roleGuard('student');
      const result = await TestBed.runInInjectionContext(() => guard(null as never, null as never));
      expect(result).toBe(true);
    });

    it('redirige a /tutor/home si identity es tutor (mismatch)', async () => {
      fake.willReturn(makeIdentity('tutor'));
      const guard = roleGuard('student');
      const result = (await TestBed.runInInjectionContext(() =>
        guard(null as never, null as never),
      )) as UrlTree;
      expect(result).toBeInstanceOf(UrlTree);
      expect(result.toString()).toBe('/tutor/home');
    });

    it('redirige a /login si no hay identity', async () => {
      fake.willReturn(null);
      const guard = roleGuard('student');
      const result = (await TestBed.runInInjectionContext(() =>
        guard(null as never, null as never),
      )) as UrlTree;
      expect(result).toBeInstanceOf(UrlTree);
      expect(result.toString()).toBe('/login');
    });
  });

  describe("roleGuard('tutor')", () => {
    it('permite la navegación si identity.role() === "tutor"', async () => {
      fake.willReturn(makeIdentity('tutor'));
      const guard = roleGuard('tutor');
      const result = await TestBed.runInInjectionContext(() => guard(null as never, null as never));
      expect(result).toBe(true);
    });

    it('redirige a /student/home si identity es student (mismatch)', async () => {
      fake.willReturn(makeIdentity('student'));
      const guard = roleGuard('tutor');
      const result = (await TestBed.runInInjectionContext(() =>
        guard(null as never, null as never),
      )) as UrlTree;
      expect(result).toBeInstanceOf(UrlTree);
      expect(result.toString()).toBe('/student/home');
    });
  });
});
