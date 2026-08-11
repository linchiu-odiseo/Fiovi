import { describe, it, expect } from 'vitest';
import { AccountNotActiveError } from '../../../../src/L1_domain/errors/account-not-active.error';
import { InvalidCredentialsError } from '../../../../src/L1_domain/errors/invalid-credentials.error';
import { NetworkError } from '../../../../src/L1_domain/errors/network.error';
import { InvalidIdentityError } from '../../../../src/L1_domain/errors/invalid-identity.error';
import { RefreshFailedError } from '../../../../src/L1_domain/errors/refresh-failed.error';
import { RateLimitError } from '../../../../src/L1_domain/errors/rate-limit.error';
import { ProfileNotAvailableError } from '../../../../src/L1_domain/errors/profile-not-available.error';
import { UnsupportedRoleError } from '../../../../src/L1_domain/errors/unsupported-role.error';
import { ExamsPermissionRevokedError } from '../../../../src/L1_domain/errors/exams-permission-revoked.error';
import { StudentNotLinkedError } from '../../../../src/L1_domain/errors/student-not-linked.error';
import { StudentNotEnrolledError } from '../../../../src/L1_domain/errors/student-not-enrolled.error';
import { InvalidExamError } from '../../../../src/L1_domain/errors/invalid-exam.error';
import { InvalidAdmissionAreaError } from '../../../../src/L1_domain/errors/invalid-admission-area.error';

describe('Errores de dominio', () => {
  describe('InvalidCredentialsError', () => {
    it('es instanceof Error', () => {
      expect(new InvalidCredentialsError()).toBeInstanceOf(Error);
    });

    it('es instanceof InvalidCredentialsError', () => {
      expect(new InvalidCredentialsError()).toBeInstanceOf(InvalidCredentialsError);
    });

    it('tiene name correcto', () => {
      expect(new InvalidCredentialsError().name).toBe('InvalidCredentialsError');
    });

    it('expone message por defecto en español', () => {
      expect(new InvalidCredentialsError().message).toBe('Credenciales inválidas.');
    });

    it('acepta message custom', () => {
      expect(new InvalidCredentialsError('foo').message).toBe('foo');
    });
  });

  describe('AccountNotActiveError', () => {
    it('es instanceof Error y AccountNotActiveError', () => {
      const err = new AccountNotActiveError();
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(AccountNotActiveError);
    });

    it('tiene name correcto', () => {
      expect(new AccountNotActiveError().name).toBe('AccountNotActiveError');
    });

    it('expone message por defecto en español', () => {
      expect(new AccountNotActiveError().message).toBe(
        'Tu cuenta no está activa. Contacta a tu institución para activarla.',
      );
    });

    it('acepta message custom', () => {
      expect(new AccountNotActiveError('foo').message).toBe('foo');
    });

    it('NO es instanceof InvalidCredentialsError (discriminable por instanceof)', () => {
      expect(new AccountNotActiveError()).not.toBeInstanceOf(InvalidCredentialsError);
    });
  });

  describe('NetworkError', () => {
    it('es instanceof Error y NetworkError', () => {
      const err = new NetworkError();
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(NetworkError);
    });

    it('tiene name correcto', () => {
      expect(new NetworkError().name).toBe('NetworkError');
    });

    it('expone message por defecto en español', () => {
      expect(new NetworkError().message).toBe(
        'No se pudo conectar al servidor. Inténtalo de nuevo.',
      );
    });
  });

  describe('InvalidIdentityError', () => {
    it('es instanceof Error e InvalidIdentityError', () => {
      const err = new InvalidIdentityError();
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(InvalidIdentityError);
    });

    it('tiene name correcto', () => {
      expect(new InvalidIdentityError().name).toBe('InvalidIdentityError');
    });
  });

  describe('RefreshFailedError', () => {
    it('es instanceof Error y RefreshFailedError', () => {
      const err = new RefreshFailedError();
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(RefreshFailedError);
    });

    it('tiene name correcto', () => {
      expect(new RefreshFailedError().name).toBe('RefreshFailedError');
    });
  });

  describe('RateLimitError', () => {
    it('es instanceof Error y RateLimitError', () => {
      const err = new RateLimitError();
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(RateLimitError);
    });

    it('tiene name correcto', () => {
      expect(new RateLimitError().name).toBe('RateLimitError');
    });
  });

  describe('ProfileNotAvailableError', () => {
    it('es instanceof Error y ProfileNotAvailableError', () => {
      const err = new ProfileNotAvailableError();
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ProfileNotAvailableError);
    });

    it('tiene name correcto', () => {
      expect(new ProfileNotAvailableError().name).toBe('ProfileNotAvailableError');
    });
  });

  describe('UnsupportedRoleError', () => {
    it('es instanceof Error y UnsupportedRoleError', () => {
      const err = new UnsupportedRoleError('admin');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(UnsupportedRoleError);
    });

    it('tiene name correcto', () => {
      expect(new UnsupportedRoleError('admin').name).toBe('UnsupportedRoleError');
    });

    it('expone el rol no soportado en la propiedad `role`', () => {
      expect(new UnsupportedRoleError('admin').role).toBe('admin');
      expect(new UnsupportedRoleError('teacher').role).toBe('teacher');
    });

    it('arma un message por defecto con el rol', () => {
      expect(new UnsupportedRoleError('admin').message).toBe(
        'Role "admin" is not supported by this client',
      );
    });

    it('acepta message custom', () => {
      expect(new UnsupportedRoleError('admin', 'foo').message).toBe('foo');
    });
  });

  describe('ExamsPermissionRevokedError', () => {
    it('es instanceof Error y ExamsPermissionRevokedError', () => {
      const err = new ExamsPermissionRevokedError();
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ExamsPermissionRevokedError);
    });

    it('tiene name correcto', () => {
      expect(new ExamsPermissionRevokedError().name).toBe('ExamsPermissionRevokedError');
    });
  });

  describe('StudentNotLinkedError', () => {
    it('es instanceof Error y StudentNotLinkedError', () => {
      const err = new StudentNotLinkedError();
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(StudentNotLinkedError);
    });

    it('tiene name correcto', () => {
      expect(new StudentNotLinkedError().name).toBe('StudentNotLinkedError');
    });
  });

  describe('StudentNotEnrolledError', () => {
    it('es instanceof Error y StudentNotEnrolledError', () => {
      const err = new StudentNotEnrolledError();
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(StudentNotEnrolledError);
    });

    it('tiene name correcto', () => {
      expect(new StudentNotEnrolledError().name).toBe('StudentNotEnrolledError');
    });

    // Defensa contra clasificación accidental como NetworkError:
    // EnviarSimulacroUseCase encola NetworkError. Si esta jerarquía cambiara,
    // el outbox crecería con envíos que nunca van a tener éxito.
    it('NO es instanceof NetworkError', () => {
      expect(new StudentNotEnrolledError() instanceof NetworkError).toBe(false);
    });
  });

  describe('InvalidExamError', () => {
    it('es instanceof Error y InvalidExamError', () => {
      const err = new InvalidExamError('algo');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(InvalidExamError);
    });

    it('tiene name correcto', () => {
      expect(new InvalidExamError('algo').name).toBe('InvalidExamError');
    });
  });

  describe('InvalidAdmissionAreaError', () => {
    it('es instanceof Error y InvalidAdmissionAreaError', () => {
      const err = new InvalidAdmissionAreaError();
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(InvalidAdmissionAreaError);
    });

    it('tiene name correcto', () => {
      expect(new InvalidAdmissionAreaError().name).toBe('InvalidAdmissionAreaError');
    });
  });

  describe('discriminación entre errores', () => {
    it('un InvalidCredentialsError NO es instanceof NetworkError ni InvalidIdentityError', () => {
      const err = new InvalidCredentialsError();
      expect(err).not.toBeInstanceOf(NetworkError);
      expect(err).not.toBeInstanceOf(InvalidIdentityError);
    });

    it('un RefreshFailedError NO es instanceof InvalidCredentialsError', () => {
      expect(new RefreshFailedError()).not.toBeInstanceOf(InvalidCredentialsError);
    });

    it('ExamsPermissionRevokedError NO es instanceof NetworkError', () => {
      expect(new ExamsPermissionRevokedError()).not.toBeInstanceOf(NetworkError);
    });

    it('StudentNotLinkedError NO es instanceof NetworkError', () => {
      expect(new StudentNotLinkedError()).not.toBeInstanceOf(NetworkError);
    });
  });
});
