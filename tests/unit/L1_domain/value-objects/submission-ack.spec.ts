import { describe, it, expect } from 'vitest';
import { SubmissionAck } from '../../../../src/L1_domain/value-objects/submission-ack';

// Cubre el VO `SubmissionAck` (L1) según los scenarios del spec
// `exam-submission` Requirement "SubmissionAck VO en L1":
// - construcción con datos válidos
// - validación de `id` (no vacío)
// - validación de `submissionHash` (64 chars hex)
// - validación de `submittedAt` (Date válido)
//
// El VO es la autoridad de "yo envié" persistida en IDB. Si su constructor
// no rechaza shapes inválidos, datos corruptos del back podrían contaminar
// el storage y romper la composición de cards "Enviado" en /home.
describe('SubmissionAck', () => {
  // 64 chars hex válidos para reutilizar en varios tests.
  const VALID_HASH = 'a3f5c8d1b2e4f6a8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
  const VALID_DATE = new Date('2026-06-17T15:29:54.531Z');
  const VALID_ID = '7620c18d-5b4d-4ef0-bf41-98352d21c2cf';

  describe('construcción válida', () => {
    it('acepta (id no vacío, hash 64 hex, Date válido) y expone los campos sin transformación', () => {
      const ack = new SubmissionAck(VALID_ID, VALID_HASH, VALID_DATE);
      expect(ack.id).toBe(VALID_ID);
      expect(ack.submissionHash).toBe(VALID_HASH);
      expect(ack.submittedAt).toBe(VALID_DATE);
    });

    it('los campos son readonly (escritura silenciosa en runtime, asegurada por TS)', () => {
      // La inmutabilidad de readonly es a nivel TS; verificamos al menos que
      // los valores no muten entre construcción y lectura.
      const ack = new SubmissionAck(VALID_ID, VALID_HASH, VALID_DATE);
      expect(ack.id).toBe(VALID_ID);
      expect(ack.submissionHash).toBe(VALID_HASH);
      expect(ack.submittedAt.getTime()).toBe(VALID_DATE.getTime());
    });
  });

  describe('validación de id', () => {
    it('rechaza string vacío', () => {
      expect(() => new SubmissionAck('', VALID_HASH, VALID_DATE)).toThrow(Error);
    });

    it('rechaza string con solo whitespace', () => {
      expect(() => new SubmissionAck('   ', VALID_HASH, VALID_DATE)).toThrow(Error);
    });
  });

  describe('validación de submissionHash', () => {
    it('rechaza hash más corto que 64 chars', () => {
      expect(() => new SubmissionAck(VALID_ID, 'abc', VALID_DATE)).toThrow(Error);
    });

    it('rechaza hash más largo que 64 chars', () => {
      const tooLong = VALID_HASH + '0';
      expect(() => new SubmissionAck(VALID_ID, tooLong, VALID_DATE)).toThrow(Error);
    });

    it('rechaza hash de 64 chars con caracteres no-hex (uppercase)', () => {
      // 64 chars exactos pero con uppercase → contrato es lowercase hex.
      const uppercase = 'A3F5C8D1B2E4F6A8C9D0E1F2A3B4C5D6E7F8A9B0C1D2E3F4A5B6C7D8E9F0A1B2';
      expect(() => new SubmissionAck(VALID_ID, uppercase, VALID_DATE)).toThrow(Error);
    });

    it('rechaza hash de 64 chars con caracteres no-hex (símbolos)', () => {
      // 64 chars con un símbolo no-hex en el medio.
      const withSymbol = 'a3f5c8d1b2e4f6a8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b!';
      expect(() => new SubmissionAck(VALID_ID, withSymbol, VALID_DATE)).toThrow(Error);
    });

    it('rechaza string vacío como hash', () => {
      expect(() => new SubmissionAck(VALID_ID, '', VALID_DATE)).toThrow(Error);
    });
  });

  describe('validación de submittedAt', () => {
    it('rechaza Date inválido (NaN)', () => {
      expect(() => new SubmissionAck(VALID_ID, VALID_HASH, new Date('no-es-fecha'))).toThrow(Error);
    });

    it('rechaza algo que no es Date (string)', () => {
      // Defensa contra adapters que olviden new Date(...) antes de construir el VO.
      expect(
        () => new SubmissionAck(VALID_ID, VALID_HASH, '2026-06-17T15:29:54Z' as unknown as Date),
      ).toThrow(Error);
    });

    it('acepta Date construido desde ISO string del server', () => {
      const fromIso = new Date('2026-06-17T15:29:54.531Z');
      const ack = new SubmissionAck(VALID_ID, VALID_HASH, fromIso);
      expect(ack.submittedAt.getTime()).toBe(fromIso.getTime());
    });
  });
});
