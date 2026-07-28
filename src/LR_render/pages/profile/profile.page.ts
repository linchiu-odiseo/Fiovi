import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { GetIdentityUseCase } from '../../../L2_application/use-cases/get-identity.use-case';
import { GetProfileUseCase } from '../../../L2_application/use-cases/get-profile.use-case';
import { LogoutUseCase } from '../../../L2_application/use-cases/logout.use-case';
import { PwaUpdateService } from '../../../L3_periphery/pwa/pwa-update.service';
import { environment } from '../../../environments/environment';
import { StudentProfile } from '../../../L1_domain/value-objects/student-profile';
import { TutorProfile } from '../../../L1_domain/value-objects/tutor-profile';
import { Role } from '../../../L1_domain/entities/identity';
import { UpdateConfirmModalComponent } from '../../components/update-confirm-modal/update-confirm-modal.component';
import { VersionFooterComponent } from '../../components/version-footer/version-footer.component';

// Estados de la fila "Actualizaciones":
//   idle       — sin acción reciente. Muestra la versión actual como hint.
//   checking   — chequeo en vuelo. Muestra "Buscando…".
//   up-to-date — el último chequeo dijo que no hay update. Muestra "Al día".
//   applying   — el usuario aceptó aplicar; reload en camino.
// El signal `pwa.pendingUpdate().available` es la fuente de verdad para
// saber si hay update disponible; este estado local solo enriquece el
// feedback inline (chequeo manual + resultado "Al día").
type UpdateRowStatus = 'idle' | 'checking' | 'up-to-date' | 'applying';

// Hub de cuenta compartido entre student y tutor. La home dejó de mostrar
// email + código + logout inline: todo eso se concentra acá para calmar la
// vista principal. Cinco apartados en lista plana: Historial, Configuración,
// Ayuda (stub → /demo-sheet), Actualizaciones y Acerca de — los cuatro
// primeros son placeholders declarados como follow-up.
@Component({
  selector: 'app-profile-page',
  templateUrl: './profile.page.html',
  styleUrl: './profile.page.scss',
  imports: [VersionFooterComponent, UpdateConfirmModalComponent],
})
export class ProfilePage {
  private readonly location = inject(Location);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly getIdentity = inject(GetIdentityUseCase);
  private readonly getProfile = inject(GetProfileUseCase);
  private readonly logout = inject(LogoutUseCase);
  protected readonly pwa = inject(PwaUpdateService);

  protected readonly appVersion = environment.appVersion;
  protected readonly updateStatus = signal<UpdateRowStatus>('idle');
  protected readonly showUpdateModal = signal(false);

  // Datos del usuario. `email` viene siempre de la identity (garantizado por
  // authGuard). `role`, `firstName`, `lastName`, `code` vienen del perfil
  // remoto — mientras carga se muestran skeletons vacíos ('').
  protected readonly email = signal<string>('');
  protected readonly role = signal<Role | null>(null);
  protected readonly firstName = signal<string>('');
  protected readonly lastName = signal<string>('');
  protected readonly code = signal<string>('');
  protected readonly loading = signal(true);
  protected readonly isSigningOut = signal(false);

  protected readonly fullName = computed(() => {
    const first = this.firstName().trim();
    const last = this.lastName().trim();
    const combined = `${first} ${last}`.trim();
    return combined.length > 0 ? combined : this.email();
  });

  protected readonly roleLabel = computed(() => {
    const r = this.role();
    if (r === 'student') return 'student';
    if (r === 'tutor') return 'tutor';
    return '';
  });

  constructor() {
    void this.load();
    // No hay estado externo que limpiar todavía — la firma queda armada por si
    // más adelante se agrega polling / subscripciones.
    this.destroyRef.onDestroy(() => {
      /* noop */
    });
  }

  private async load(): Promise<void> {
    try {
      const identity = await this.getIdentity.execute();
      if (!identity) return;
      this.email.set(identity.email);
      const currentRole = identity.role();
      this.role.set(currentRole);
      // El perfil puede fallar (403/404) — en ese caso mostramos solo email,
      // que es dato de identity siempre disponible.
      try {
        const profile = await this.getProfile.execute(currentRole);
        this.applyProfile(profile);
      } catch {
        // silent: header cae a email; no bloqueamos el hub por eso.
      }
    } finally {
      this.loading.set(false);
    }
  }

  private applyProfile(profile: StudentProfile | TutorProfile): void {
    this.firstName.set(profile.firstName);
    this.lastName.set(profile.lastName);
    this.code.set(profile.code);
  }

  protected onBack(): void {
    this.location.back();
  }

  protected onHistorialClick(): void {
    const r = this.role();
    if (r === 'student') {
      void this.router.navigate(['/student/historial']);
    }
    // Tutor: historial es follow-up (Item 4). Por ahora ignoramos el click
    // para el rol tutor — la fila está oculta en el template.
  }

  protected onConfigClick(): void {
    // Placeholder: ídem historial.
  }

  protected onAyudaClick(): void {
    // Stub: mientras no exista una vista de ayuda real, apuntamos al demo
    // sheet — pantalla mock 100 % local que sirve para inspección visual
    // de la cartilla. Cuando exista /help, cambiar el destino acá.
    void this.router.navigate(['/demo-sheet']);
  }

  protected async onActualizacionesClick(): Promise<void> {
    // Si ya hay una nueva versión latched, abrimos el modal de confirmación
    // (mismo flow que el CTA del version-footer). Si el estado local está
    // "checking" o "applying", ignoramos taps para evitar dobles.
    if (this.updateStatus() === 'checking' || this.updateStatus() === 'applying') return;
    if (this.pwa.pendingUpdate().available) {
      this.showUpdateModal.set(true);
      return;
    }
    this.updateStatus.set('checking');
    const found = await this.pwa.checkForUpdateNow();
    // Si `found`, el signal `pwa.pendingUpdate()` se prende asincrónicamente
    // vía VERSION_READY — la vista lo lee reactivo y muestra el CTA
    // "Actualizar a X.Y.Z". Local marca "idle" para no mostrar "Al día"
    // encima del CTA. Si no hay update, mostramos "Al día".
    this.updateStatus.set(found ? 'idle' : 'up-to-date');
  }

  protected onUpdateModalCancel(): void {
    this.showUpdateModal.set(false);
  }

  protected onUpdateModalConfirm(): void {
    // El reload reinicia el contexto; no reseteamos el modal ni el status.
    this.updateStatus.set('applying');
    void this.pwa.applyUpdate();
  }

  protected onAcercaDeClick(): void {
    // Placeholder: la vista "Acerca de" (versión, tenant, licencias)
    // queda como follow-up.
  }

  protected async onSignOut(): Promise<void> {
    if (this.isSigningOut()) return;
    this.isSigningOut.set(true);
    try {
      await this.logout.execute();
      await this.router.navigate(['/login']);
    } finally {
      this.isSigningOut.set(false);
    }
  }
}
