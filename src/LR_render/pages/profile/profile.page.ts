import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { GetIdentityUseCase } from '../../../L2_application/use-cases/get-identity.use-case';
import { GetProfileUseCase } from '../../../L2_application/use-cases/get-profile.use-case';
import { LogoutUseCase } from '../../../L2_application/use-cases/logout.use-case';
import { environment } from '../../../environments/environment';
import { StudentProfile } from '../../../L1_domain/value-objects/student-profile';
import { TutorProfile } from '../../../L1_domain/value-objects/tutor-profile';
import { Role } from '../../../L1_domain/entities/identity';
import { VersionFooterComponent } from '../../components/version-footer/version-footer.component';

// Hub de cuenta compartido entre student y tutor. La home dejó de mostrar
// email + código + logout inline: todo eso se concentra acá para calmar la
// vista principal. Historial y configuración son placeholders (próximamente).
// Demo sheet es un dev-tool, gated por `environment.devTools` — sale del
// header del home y aparece solo dentro de este hub.
@Component({
  selector: 'app-profile-page',
  templateUrl: './profile.page.html',
  styleUrl: './profile.page.scss',
  imports: [VersionFooterComponent],
})
export class ProfilePage {
  private readonly location = inject(Location);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly getIdentity = inject(GetIdentityUseCase);
  private readonly getProfile = inject(GetProfileUseCase);
  private readonly logout = inject(LogoutUseCase);

  protected readonly isDevTools = environment.devTools;

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
    if (r === 'student') return 'Student';
    if (r === 'tutor') return 'Tutor';
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

  protected onDemoSheetClick(): void {
    void this.router.navigate(['/demo-sheet']);
  }

  protected onHistorialClick(): void {
    // Placeholder: la vista de historial es follow-up declarado. Por ahora
    // ignoramos el click para no navegar a una ruta rota.
  }

  protected onConfigClick(): void {
    // Placeholder: ídem historial.
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
