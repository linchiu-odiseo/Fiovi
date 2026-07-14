import { describe, it, expect } from 'vitest';
import { ProcessSsoCallbackUseCase } from '../../../../src/L2_application/use-cases/process-sso-callback.use-case';

describe('ProcessSsoCallbackUseCase', () => {
  const useCase = new ProcessSsoCallbackUseCase();
  const encodeTenants = (tenants: { slug: string; name: string }[]) =>
    btoa(JSON.stringify(tenants));

  describe('kind: auto (`?slug=<slug>` — caso 1 tenant post-callback SSO)', () => {
    it('devuelve el slug cuando el query param es válido', () => {
      const outcome = useCase.execute('?slug=vonex');
      expect(outcome).toEqual({ kind: 'auto', slug: 'vonex' });
    });

    it('acepta slugs con guiones, underscores y números', () => {
      const outcome = useCase.execute('?slug=academia-01_pitagoras');
      expect(outcome).toEqual({ kind: 'auto', slug: 'academia-01_pitagoras' });
    });

    it('rechaza slugs con caracteres inválidos (`.` no permitido)', () => {
      const outcome = useCase.execute('?slug=evil.com');
      expect(outcome).toEqual({ kind: 'none' });
    });

    it('rechaza slugs con `/` (defensa contra path traversal)', () => {
      const outcome = useCase.execute('?slug=vonex/admin');
      expect(outcome).toEqual({ kind: 'none' });
    });
  });

  describe('kind: selection (`?selectionToken=&tenants=<b64>` — caso N tenants)', () => {
    it('devuelve challenge cuando token + tenants están presentes y válidos', () => {
      const b64 = encodeTenants([
        { slug: 'vonex', name: 'Academia Vonex' },
        { slug: 'pitagoras', name: 'Academia Pitágoras' },
      ]);
      const outcome = useCase.execute(`?selectionToken=jwt.abc&tenants=${b64}`);
      expect(outcome.kind).toBe('selection');
      if (outcome.kind === 'selection') {
        expect(outcome.challenge.selectionToken).toBe('jwt.abc');
        expect(outcome.challenge.tenants).toHaveLength(2);
        expect(outcome.challenge.tenants[0].slug).toBe('vonex');
        expect(outcome.challenge.selectionExpiresAt).toBeGreaterThan(Date.now());
      }
    });

    it('rechaza tenants con base64 corrupto → error `state_invalid`', () => {
      const outcome = useCase.execute('?selectionToken=jwt.abc&tenants=@@@no-es-b64@@@');
      expect(outcome).toEqual({ kind: 'error', code: 'state_invalid' });
    });

    it('rechaza tenants con JSON malformado dentro del base64', () => {
      const b64 = btoa('no soy json');
      const outcome = useCase.execute(`?selectionToken=jwt.abc&tenants=${b64}`);
      expect(outcome).toEqual({ kind: 'error', code: 'state_invalid' });
    });

    it('rechaza tenants array vacío', () => {
      const b64 = encodeTenants([]);
      const outcome = useCase.execute(`?selectionToken=jwt.abc&tenants=${b64}`);
      expect(outcome).toEqual({ kind: 'error', code: 'state_invalid' });
    });

    it('rechaza tenants con shape inválido (falta name)', () => {
      const b64 = btoa(JSON.stringify([{ slug: 'vonex' }]));
      const outcome = useCase.execute(`?selectionToken=jwt.abc&tenants=${b64}`);
      expect(outcome).toEqual({ kind: 'error', code: 'state_invalid' });
    });

    it('rechaza tenants con slug inválido (path traversal)', () => {
      const b64 = encodeTenants([{ slug: '../evil', name: 'evil' }]);
      const outcome = useCase.execute(`?selectionToken=jwt.abc&tenants=${b64}`);
      expect(outcome).toEqual({ kind: 'error', code: 'state_invalid' });
    });
  });

  describe('kind: error (`?ssoError=<code>`)', () => {
    it('devuelve el código sin validación (LoginPage lo mapea)', () => {
      const outcome = useCase.execute('?ssoError=sso_disabled');
      expect(outcome).toEqual({ kind: 'error', code: 'sso_disabled' });
    });

    it('gana sobre ?slug y ?selectionToken si viene junto', () => {
      const outcome = useCase.execute('?ssoError=state_invalid&slug=vonex');
      expect(outcome).toEqual({ kind: 'error', code: 'state_invalid' });
    });
  });

  describe('kind: none (URL sin params relevantes)', () => {
    it('devuelve none cuando la URL está vacía', () => {
      expect(useCase.execute('')).toEqual({ kind: 'none' });
    });

    it('devuelve none para query params irrelevantes', () => {
      expect(useCase.execute('?returnTo=/exam/1&utm_source=x')).toEqual({ kind: 'none' });
    });

    it('devuelve none cuando falta tenants aunque haya selectionToken', () => {
      expect(useCase.execute('?selectionToken=jwt.abc')).toEqual({ kind: 'none' });
    });
  });
});
