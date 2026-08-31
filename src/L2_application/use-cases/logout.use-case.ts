import { AuthRepository } from '../../L1_domain/ports/auth-repository';
import { IdentityStorage } from '../../L1_domain/ports/identity-storage';
import { SessionRefreshScheduler } from '../../L1_domain/ports/session-refresh-scheduler';
import { TenantSlugCache } from '../../L1_domain/ports/tenant-slug-cache';
import { ProfileStorage } from '../../L1_domain/ports/profile-storage';
import { DraftDispatcher } from '../../L1_domain/ports/draft-dispatcher';
import { RouterPort } from '../../L1_domain/ports/router-port';
import { SwMessengerPort } from '../../L1_domain/ports/sw-messenger.port';

// Use case de logout con pasos ordenados estrictamente.
//
// POLÍTICA DE PERSISTENCIA (robustez ante logout accidental):
//
// El logout NO borra IDB del alumno. Las marcaciones activas, la cola de
// envíos pendientes, el área de postulación, los acks y los snapshots
// sobreviven scoped por email (`cartilla.<email>.*`). Si el mismo alumno
// vuelve a loguear, recupera todo. Si loguea otro alumno, ve solo su propio
// scope. Multi-usuario en el mismo device sigue aislado.
//
// Sí se limpia el dispatcher de drafts en memoria: sin esto, un draft que
// falló durante el logout (identity limpia → SessionExpiredError) queda
// marcado como `stopped=true` en el state global y bloquea drafts para
// cualquier alumno siguiente en el mismo sessionId.
//
// Sí se limpia el perfil cacheado y la identity — son datos volátiles de
// sesión que se re-obtienen al reloguear.
//
// Todos los pasos de limpieza local son best-effort: un error en uno no
// detiene los siguientes. El logout del repo también es best-effort
// (errores de red se ignoran con console.warn).
//
// Si no hay identity activa al inicio: solo navega a /login y retorna (no-op).
export class LogoutUseCase {
  constructor(
    private readonly authRepo: AuthRepository,
    private readonly identityStorage: IdentityStorage,
    private readonly slugCache: TenantSlugCache,
    private readonly profileStorage: ProfileStorage,
    private readonly draftDispatcher: DraftDispatcher,
    private readonly router: RouterPort,
    private readonly refreshScheduler: SessionRefreshScheduler,
    private readonly swMessenger?: SwMessengerPort,
  ) {}

  async execute(): Promise<void> {
    // Paso 0: cancelar cualquier refresh proactivo pendiente. Va PRIMERO
    // porque si el timer se dispara despues del logout, `RefreshIdentityUseCase`
    // volveria a hidratar storage e intentaria un refresh contra un backend
    // que ya invalido las cookies — ruido innecesario en logs. Idempotente,
    // sin efecto si no habia timer agendado.
    this.refreshScheduler.cancel();

    // Paso 1: verificar si hay identity activa. Si no → solo navegar.
    const identity = await this.identityStorage.read();
    if (!identity) {
      this.router.navigate(['/login']);
      return;
    }

    // Paso 2: best-effort logout server-side (limpia cookies HttpOnly).
    try {
      await this.authRepo.logout();
    } catch (err) {
      console.warn('logout endpoint failed; local cleanup continues', err);
    }

    // Paso 3: limpiar state in-memory del dispatcher de drafts. Corta la
    // cadena de bugs donde un draft pendiente muere con SessionExpiredError
    // al perder identity, deja el sessionId como stopped=true y bloquea
    // drafts para el próximo alumno logueado.
    try {
      this.draftDispatcher.wipeAll();
    } catch (err) {
      console.warn('draft dispatcher wipe failed during logout', err);
    }

    // Paso 4: limpiar caché de perfil.
    try {
      await this.profileStorage.clear();
    } catch (err) {
      console.warn('profile storage clear failed during logout', err);
    }

    // Paso 5: limpiar identity. Después de este paso, cualquier lectura del
    // IDB scoped por email fallará hasta el próximo login — por eso los
    // pasos previos que necesitaban leer identity ya corrieron.
    try {
      await this.identityStorage.clear();
    } catch (err) {
      console.warn('identity storage clear failed during logout', err);
    }

    // Paso 6: limpiar el cache del slug. Sin esto, el próximo request a
    // /t/{slug}/... armaría el path con un slug fantasma.
    this.slugCache.clear();

    // Paso 7: notificar al SW (opcional).
    this.swMessenger?.post({ type: 'LOGOUT' });

    // Paso 8: navegar a login.
    this.router.navigate(['/login']);
  }
}
