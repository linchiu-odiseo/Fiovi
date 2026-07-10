import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { GetTutorExamsUseCase } from '../../L2_application/use-cases/get-tutor-exams.use-case';
import { GetProfileUseCase } from '../../L2_application/use-cases/get-profile.use-case';
import { GetIdentityUseCase } from '../../L2_application/use-cases/get-identity.use-case';
import { LogoutUseCase } from '../../L2_application/use-cases/logout.use-case';
import { TutorExamsStore } from '../state/tutor-exams.store';
import { TutorExam } from '../../L1_domain/entities/tutor-exam';
import { NetworkError } from '../../L1_domain/errors/network.error';
import { TutorProfile, TutorClassroom } from '../../L1_domain/value-objects/tutor-profile';
import { ProfileNotAvailableError } from '../../L1_domain/errors/profile-not-available.error';

// Cada 120s mientras la pestaña está visible: refresca la lista del tutor
// contra el backend. Mismo patrón que HomePageViewModel.
const POLL_INTERVAL_MS = 120_000;

// View-model de /tutor/home (lista de exámenes del tutor). Provider-local al
// TutorExamsListPage (NO providedIn root) para que cada montaje arranque
// limpio sus timers y listeners.
@Injectable()
export class TutorExamsListViewModel {
  private readonly getTutorExams = inject(GetTutorExamsUseCase);
  private readonly getProfile = inject(GetProfileUseCase);
  private readonly getIdentity = inject(GetIdentityUseCase);
  private readonly logout = inject(LogoutUseCase);
  private readonly router = inject(Router);
  private readonly store = inject(TutorExamsStore);

  // Lista de exámenes del tutor. Inicia vacía; se populará en el primer load.
  readonly exams = signal<readonly TutorExam[]>([]);
  // true mientras GetTutorExamsUseCase está en vuelo.
  readonly loading = signal(true);
  // true si el último fetch resultó en NetworkError. El polling continúa.
  readonly error = signal(false);

  // Header del tutor: datos del perfil desde GetProfileUseCase('tutor').
  readonly userName = signal<string | null>(null);
  readonly userEmail = signal<string | null>(null);
  readonly userCode = signal<string | null>(null);
  readonly profileEmail = signal<string | null>(null);
  readonly classrooms = signal<readonly TutorClassroom[]>([]);
  readonly profileLoading = signal(false);
  readonly profileUnavailable = signal(false);

  // Computeds de aulas
  readonly classroomCount = computed(() => this.classrooms().length);
  readonly studentTotal = computed(() =>
    this.classrooms().reduce((sum, c) => sum + c.studentCount, 0),
  );
  readonly hasClassrooms = computed(() => this.classrooms().length > 0);

  // Solo exámenes en curso (in_progress). Los `scheduled` y `finalized` viven
  // en la jerarquía Aula → Curso → Examen; acá el home resalta "qué está
  // corriendo AHORA" para acceso rápido.
  readonly examsInProgress = computed(() =>
    this.exams().filter((e) => e.serverStatus.value === 'in_progress'),
  );
  readonly hasExamsInProgress = computed(() => this.examsInProgress().length > 0);

  // Logout
  readonly isSigningOut = signal(false);

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private visibilityListener: (() => void) | null = null;
  private started = false;
  private stopped = false;

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.stopped = false;

    // Cargar perfil en paralelo (no bloquea el fetch de exámenes).
    void this.loadProfile();
    await this.refresh();

    this.startPollingIfVisible();
    this.attachVisibilityListener();
  }

  stop(): void {
    this.stopped = true;
    this.stopPolling();
    this.detachVisibilityListener();
  }

  async refresh(): Promise<void> {
    if (this.stopped) return;
    this.loading.set(true);
    try {
      const list = await this.getTutorExams.execute();
      this.exams.set(list);
      this.store.setExams(list);
      this.error.set(false);
    } catch (err) {
      if (err instanceof NetworkError) {
        // Activa el error signal pero mantiene la lista anterior y continúa
        // el polling — el próximo tick intentará de nuevo.
        this.error.set(true);
      } else {
        // Error no modelado: re-lanzar para no silenciar bugs.
        throw err;
      }
    } finally {
      this.loading.set(false);
    }
  }

  // Cerrar sesión. El guard isSigningOut previene doble ejecución.
  async signOut(): Promise<void> {
    if (this.isSigningOut()) return;
    this.isSigningOut.set(true);
    try {
      await this.logout.execute();
      await this.router.navigate(['/login']);
    } finally {
      this.isSigningOut.set(false);
    }
  }

  private async loadProfile(): Promise<void> {
    this.profileLoading.set(true);
    try {
      const profile = (await this.getProfile.execute('tutor')) as TutorProfile;
      this.userName.set(`${profile.firstName} ${profile.lastName}`);
      this.userCode.set(profile.code);
      this.profileEmail.set(profile.email);
      this.classrooms.set(profile.classrooms);

      // Email en el header: preferimos el del perfil. Cuando el `/me` viene
      // con `email: null` (data-quality del back), caemos a Identity —
      // que trae el email con el que el tutor inició sesión.
      if (profile.email) {
        this.userEmail.set(profile.email);
      } else {
        await this.resolveEmailFromIdentity();
      }
    } catch (err) {
      if (err instanceof ProfileNotAvailableError) {
        // Tutor con identity válida pero sin fila en tutors — degradamos a email.
        this.profileUnavailable.set(true);
        await this.resolveEmailFromIdentity();
      } else if (err instanceof NetworkError) {
        // Sin perfil pero sesión OK — el header no muestra nombre.
      } else {
        throw err;
      }
    } finally {
      this.profileLoading.set(false);
    }
  }

  private async resolveEmailFromIdentity(): Promise<void> {
    try {
      const identity = await this.getIdentity.execute();
      if (identity) this.userEmail.set(identity.email);
    } catch {
      // Identity tampoco disponible — dejamos el email vacío; el template
      // usa @if para no renderizar la línea.
    }
  }

  private startPollingIfVisible(): void {
    if (this.pollTimer !== null) return;
    if (typeof document === 'undefined') return;
    if (document.visibilityState !== 'visible') return;
    this.pollTimer = setInterval(() => {
      if (this.stopped) return;
      void this.refresh();
    }, POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private attachVisibilityListener(): void {
    if (typeof document === 'undefined') return;
    const handler = (): void => {
      if (this.stopped) return;
      if (document.visibilityState === 'visible') {
        void this.refresh();
        this.startPollingIfVisible();
      } else {
        this.stopPolling();
      }
    };
    document.addEventListener('visibilitychange', handler);
    this.visibilityListener = handler;
  }

  private detachVisibilityListener(): void {
    if (this.visibilityListener !== null && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityListener);
    }
    this.visibilityListener = null;
  }
}
