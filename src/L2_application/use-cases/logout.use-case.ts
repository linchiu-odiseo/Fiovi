import { AuthRepository } from '../../L1_domain/ports/auth-repository';
import { IdentityStorage } from '../../L1_domain/ports/identity-storage';
import { TenantSlugCache } from '../../L1_domain/ports/tenant-slug-cache';
import { ProfileStorage } from '../../L1_domain/ports/profile-storage';
import { MarkingsStorage } from '../../L1_domain/ports/markings-storage';
import { OutboxStoragePort } from '../../L1_domain/ports/outbox-storage.port';
import { RouterPort } from '../../L1_domain/ports/router-port';
import { SwMessengerPort } from '../../L1_domain/ports/sw-messenger.port';
import { TutorActivityStorage } from '../../L1_domain/ports/tutor-activity-storage';

// Use case de logout con 8 pasos ordenados estrictamente.
//
// CRÍTICO: `markingsStorage.wipeUserScope()` se invoca ANTES de `identityStorage.clear()`
// para que el adapter (`IndexedDbMarkingsStorage`) todavía pueda leer el email del usuario
// desde `IdentityStorage` internamente y determinar el scope a borrar.
//
// Todos los pasos de limpieza local son best-effort: un error en uno no detiene los siguientes.
// El logout del repo también es best-effort (errores de red se ignoran con console.warn).
//
// Si no hay identity activa al inicio: solo navega a /login y retorna (no-op).
export class LogoutUseCase {
  constructor(
    private readonly authRepo: AuthRepository,
    private readonly identityStorage: IdentityStorage,
    private readonly slugCache: TenantSlugCache,
    private readonly profileStorage: ProfileStorage,
    private readonly markingsStorage: MarkingsStorage,
    private readonly outboxStorage: OutboxStoragePort,
    private readonly router: RouterPort,
    private readonly tutorActivityStorage: TutorActivityStorage,
    private readonly swMessenger?: SwMessengerPort,
  ) {}

  async execute(): Promise<void> {
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

    // Paso 3: limpiar marcaciones del usuario.
    // El adapter lee IdentityStorage internamente para resolver el scope.
    // Se invoca ANTES de identityStorage.clear() (paso 6).
    try {
      await this.markingsStorage.wipeUserScope();
    } catch (err) {
      console.warn('markings wipe failed during logout', err);
    }

    // Paso 4: limpiar outbox de envíos pendientes.
    try {
      await this.outboxStorage.clear();
    } catch (err) {
      console.warn('outbox clear failed during logout', err);
    }

    // Paso 4.5: limpiar historial de actividad del tutor (Item 4 del refine).
    // Mismo criterio que markings: se llama ANTES de identityStorage.clear()
    // porque el adapter lee IdentityStorage internamente.
    try {
      await this.tutorActivityStorage.wipeUserScope();
    } catch (err) {
      console.warn('tutor activity wipe failed during logout', err);
    }

    // Paso 5: limpiar caché de perfil.
    try {
      await this.profileStorage.clear();
    } catch (err) {
      console.warn('profile storage clear failed during logout', err);
    }

    // Paso 6: limpiar identity (DESPUÉS de markingsStorage.wipeUserScope).
    try {
      await this.identityStorage.clear();
    } catch (err) {
      console.warn('identity storage clear failed during logout', err);
    }

    // Paso 6.5: limpiar el cache del slug (post-clear del storage). Sin esto,
    // el próximo request a /t/{slug}/... armaría el path con un slug fantasma.
    this.slugCache.clear();

    // Paso 7: notificar al SW (opcional).
    this.swMessenger?.post({ type: 'LOGOUT' });

    // Paso 8: navegar a login.
    this.router.navigate(['/login']);
  }
}
