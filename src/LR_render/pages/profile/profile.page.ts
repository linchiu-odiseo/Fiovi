import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { GetIdentityUseCase } from '../../../L2_application/use-cases/get-identity.use-case';
import { GetProfileUseCase } from '../../../L2_application/use-cases/get-profile.use-case';
import { LogoutUseCase } from '../../../L2_application/use-cases/logout.use-case';
import { PwaUpdateService } from '../../../L3_periphery/pwa/pwa-update.service';
import { AuditLogSerializer } from '../../../L3_periphery/telemetry/audit-log-serializer';
import { AuditLogUploadScheduler } from '../../../L3_periphery/telemetry/audit-log-upload-scheduler.service';
import { environment } from '../../../environments/environment';
import { StudentProfile } from '../../../L1_domain/value-objects/student-profile';
import { TutorProfile } from '../../../L1_domain/value-objects/tutor-profile';
import { Role } from '../../../L1_domain/entities/identity';
import { AboutModalComponent } from '../../components/about-modal/about-modal.component';
import { SupportLogsModalComponent } from '../../components/support-logs-modal/support-logs-modal.component';
import { UpdateConfirmModalComponent } from '../../components/update-confirm-modal/update-confirm-modal.component';
import { VersionFooterComponent } from '../../components/version-footer/version-footer.component';

// Espera mínima entre envíos a soporte. El back ya tiene su propio límite
// por usuario; esto es para que el alumno no dispare diez envíos seguidos
// creyendo que "no pasó nada" cuando en realidad ya se mandó.
const SUPPORT_COOLDOWN_MS = 10 * 60 * 1000;
const SUPPORT_LAST_SENT_KEY = 'fiovi-support-last-sent-at';

type SupportSendState = 'idle' | 'sending' | 'sent' | 'error';

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
  imports: [
    VersionFooterComponent,
    UpdateConfirmModalComponent,
    AboutModalComponent,
    SupportLogsModalComponent,
  ],
})
export class ProfilePage {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly getIdentity = inject(GetIdentityUseCase);
  private readonly getProfile = inject(GetProfileUseCase);
  private readonly logout = inject(LogoutUseCase);
  private readonly auditLogSerializer = inject(AuditLogSerializer);
  private readonly uploadScheduler = inject(AuditLogUploadScheduler);
  protected readonly pwa = inject(PwaUpdateService);

  protected readonly appVersion = environment.appVersion;
  protected readonly updateStatus = signal<UpdateRowStatus>('idle');
  protected readonly showUpdateModal = signal(false);
  protected readonly showAboutModal = signal(false);
  protected readonly showSupportModal = signal(false);
  protected readonly supportState = signal<SupportSendState>('idle');
  protected readonly supportCooldownMinutes = signal(0);

  // "Descargar logs" baja el archivo crudo al dispositivo: es una herramienta
  // de diagnóstico, no algo para el alumno. Se gatea contra `production` y no
  // contra `devTools` a propósito — `production` lo fija el generador por
  // archivo de salida, mientras que `devTools` sale del `.env` que vive en la
  // VM de producción y desde el repo no hay forma de verificar su valor. Si
  // ese archivo tuviera el flag mal, el botón se publicaría a los alumnos.
  protected readonly showDownloadLogs = !environment.production;

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
    // Padre lógico fijo — home del rol. NO usar location.back() porque el
    // history del browser puede tener rutas hermanas (ej. /student/historial)
    // y "volver" desde /profile debería llevar SIEMPRE al home, no al último
    // sitio visitado.
    const r = this.role();
    if (r === 'tutor') {
      void this.router.navigate(['/tutor/home']);
    } else {
      void this.router.navigate(['/student/home']);
    }
  }

  protected onHistorialClick(): void {
    const r = this.role();
    if (r === 'student') {
      void this.router.navigate(['/student/historial']);
    } else if (r === 'tutor') {
      void this.router.navigate(['/tutor/actividad']);
    }
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
    this.showAboutModal.set(true);
  }

  // Salida manual para cuando el alumno reclama y sus logs de las últimas
  // horas todavía no salieron por el ciclo normal.
  protected onSoporteClick(): void {
    this.supportState.set('idle');
    this.supportCooldownMinutes.set(remainingCooldownMinutes());
    this.showSupportModal.set(true);
  }

  protected onSupportModalDismiss(): void {
    this.showSupportModal.set(false);
  }

  protected async onSupportModalConfirm(): Promise<void> {
    if (remainingCooldownMinutes() > 0) return;
    this.supportState.set('sending');
    try {
      // `flushNow` sella lo pendiente en este momento y drena la cola: sin el
      // sellado no se irían justamente las últimas horas, que son las que el
      // alumno viene a reclamar.
      await this.uploadScheduler.flushNow();
      writeSupportSentAt(Date.now());
      this.supportState.set('sent');
    } catch {
      this.supportState.set('error');
    }
    this.showSupportModal.set(false);
  }

  protected async onDescargarLogsClick(): Promise<void> {
    // Audit-log Fase 0: descarga NDJSON del día actual. Siempre visible en la
    // rama feat/audit-log-fase-0 (sin feature flag per design Decision 6).
    // Cuando la rama se promueva a develop se evalúa si necesita gating.
    await this.auditLogSerializer.downloadCurrentDay();
  }

  protected onAboutModalDismiss(): void {
    this.showAboutModal.set(false);
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

// El cooldown vive en localStorage y no en un signal: tiene que sobrevivir a
// que el alumno salga de la pantalla y vuelva a entrar, que es exactamente lo
// que haría alguien impaciente.
function remainingCooldownMinutes(now: number = Date.now()): number {
  try {
    const raw = localStorage.getItem(SUPPORT_LAST_SENT_KEY);
    if (raw === null) return 0;
    const lastSent = Number(raw);
    if (!Number.isFinite(lastSent)) return 0;
    const elapsed = now - lastSent;
    // Un valor futuro (reloj del dispositivo movido) no puede dejar el botón
    // trabado para siempre.
    if (elapsed < 0 || elapsed >= SUPPORT_COOLDOWN_MS) return 0;
    return Math.ceil((SUPPORT_COOLDOWN_MS - elapsed) / 60_000);
  } catch {
    return 0;
  }
}

function writeSupportSentAt(ms: number): void {
  try {
    localStorage.setItem(SUPPORT_LAST_SENT_KEY, String(ms));
  } catch {
    // Best-effort: sin localStorage no hay cooldown local, pero el límite
    // por usuario del back sigue en pie.
  }
}
