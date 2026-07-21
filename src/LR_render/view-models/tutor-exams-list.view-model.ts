import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { GetExamsEnCursoUseCase } from '../../L2_application/use-cases/get-exams-en-curso.use-case';
import { GetProfileUseCase } from '../../L2_application/use-cases/get-profile.use-case';
import { GetIdentityUseCase } from '../../L2_application/use-cases/get-identity.use-case';
import { LogoutUseCase } from '../../L2_application/use-cases/logout.use-case';
import { ExamEnCurso } from '../../L1_domain/entities/exam-en-curso';
import { NetworkError } from '../../L1_domain/errors/network.error';
import { TutorProfile, TutorClassroom } from '../../L1_domain/value-objects/tutor-profile';
import { ProfileNotAvailableError } from '../../L1_domain/errors/profile-not-available.error';

// View-model de /tutor/home. Provider-local al TutorExamsListPage (NO
// providedIn root) para que cada montaje arranque limpio.
//
// Ex-comportamiento (removido): traía TODOS los virtual-exams no-archivados
// del tutor (`GET /tutor/virtual-exams`, potencial 2000+ filas) y filtraba
// client-side. Ahora consume el endpoint dedicado `GET /tutor/exams/en-curso`
// que ya devuelve solo los in_progress (~0-10 items típicos) — misma verdad
// pero con 99% menos bytes y sin dependencia del store para hidratar la lista.
//
// El polling activo se decidió postergar para un siguiente cambio (ver
// discovery: hay que evaluar frecuencia + heartbeat + strategy de invalidación
// end-to-end contra el desync de finalización remota).
@Injectable()
export class TutorExamsListViewModel {
  private readonly getExamsEnCurso = inject(GetExamsEnCursoUseCase);
  private readonly getProfile = inject(GetProfileUseCase);
  private readonly getIdentity = inject(GetIdentityUseCase);
  private readonly logout = inject(LogoutUseCase);
  private readonly router = inject(Router);

  // Exámenes actualmente in_progress a través de TODAS las aulas del tutor.
  // Alimenta la sección "Exámenes en curso" y los badges por card de aula.
  readonly examsEnCurso = signal<readonly ExamEnCurso[]>([]);
  readonly loading = signal(true);
  readonly error = signal(false);

  // Header del tutor
  readonly userName = signal<string | null>(null);
  readonly userEmail = signal<string | null>(null);
  readonly userCode = signal<string | null>(null);
  readonly profileEmail = signal<string | null>(null);
  readonly classrooms = signal<readonly TutorClassroom[]>([]);
  readonly profileLoading = signal(false);
  readonly profileUnavailable = signal(false);

  readonly classroomCount = computed(() => this.classrooms().length);
  readonly studentTotal = computed(() =>
    this.classrooms().reduce((sum, c) => sum + c.studentCount, 0),
  );
  readonly hasClassrooms = computed(() => this.classrooms().length > 0);

  readonly hasExamsEnCurso = computed(() => this.examsEnCurso().length > 0);

  // Índice classroomId → cantidad de exámenes in_progress. Alimenta el badge
  // "N en curso" sobre cada card de aula sin necesidad de un fetch por aula.
  readonly inProgressByClassroom = computed<ReadonlyMap<string, number>>(() => {
    const map = new Map<string, number>();
    for (const exam of this.examsEnCurso()) {
      map.set(exam.classroomId, (map.get(exam.classroomId) ?? 0) + 1);
    }
    return map;
  });

  readonly isSigningOut = signal(false);

  private started = false;

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    void this.loadProfile();
    await this.refresh();
  }

  /** No-op — el polling activo se decidió postergar. Mantenida para simetría con la page. */
  stop(): void {
    // intencionalmente vacío
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      const result = await this.getExamsEnCurso.execute();
      this.examsEnCurso.set(result.items);
      this.error.set(false);
    } catch (err) {
      if (err instanceof NetworkError) {
        this.error.set(true);
      } else {
        throw err;
      }
    } finally {
      this.loading.set(false);
    }
  }

  /** Devuelve el contador de exámenes in_progress de un aula (0 si ninguno). */
  inProgressCountFor(classroomId: string): number {
    return this.inProgressByClassroom().get(classroomId) ?? 0;
  }

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

      if (profile.email) {
        this.userEmail.set(profile.email);
      } else {
        await this.resolveEmailFromIdentity();
      }
    } catch (err) {
      if (err instanceof ProfileNotAvailableError) {
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
      // Identity tampoco disponible — dejamos el email vacío.
    }
  }
}
