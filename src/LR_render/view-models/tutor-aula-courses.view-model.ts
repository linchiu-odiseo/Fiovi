import { Injectable, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { GetTutorExamsUseCase } from '../../L2_application/use-cases/get-tutor-exams.use-case';
import { GetProfileUseCase } from '../../L2_application/use-cases/get-profile.use-case';
import { TutorExamsStore } from '../state/tutor-exams.store';
import { NetworkError } from '../../L1_domain/errors/network.error';
import { TutorProfile, TutorClassroom } from '../../L1_domain/value-objects/tutor-profile';
import { ProfileNotAvailableError } from '../../L1_domain/errors/profile-not-available.error';

// Item derivado para la pantalla: un "curso" agrupa los exámenes del tutor
// dentro de un aula específica. `count` no es la cantidad de preguntas del
// examen sino cuántos exámenes hay bajo ese curso en esa aula.
export interface AulaCourseItem {
  readonly name: string;
  readonly examCount: number;
}

// VM de /tutor/aulas/:classroomId. Alimenta la lista de cursos que tiene el
// aula seleccionada agrupando lo que ya vive en TutorExamsStore. Cold path:
// si el store está vacío (deep-link / hard refresh) hace un refetch único —
// el polling continuo vive en TutorExamsListViewModel (home tutor), no acá.
@Injectable()
export class TutorAulaCoursesViewModel {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly getTutorExams = inject(GetTutorExamsUseCase);
  private readonly getProfile = inject(GetProfileUseCase);
  private readonly store = inject(TutorExamsStore);

  readonly classroomId = signal<string>('');
  readonly classroomName = signal<string | null>(null);
  readonly loading = signal(true);
  readonly error = signal<'network' | 'notFound' | null>(null);

  // Lista derivada: agrupa los exámenes del store por `course` (snapshot) y
  // filtra por el classroomId de la ruta. Sin JOIN, sin request extra.
  // Los exámenes con `course: null` caen en la key sintética "Sin curso".
  readonly courses = computed<readonly AulaCourseItem[]>(() => {
    const classroomId = this.classroomId();
    if (!classroomId) return [];
    const grouped = new Map<string, number>();
    for (const exam of this.store.exams()) {
      if (exam.classroomId !== classroomId) continue;
      const key = exam.course ?? 'Sin curso';
      grouped.set(key, (grouped.get(key) ?? 0) + 1);
    }
    return [...grouped.entries()]
      .map(([name, examCount]) => ({ name, examCount }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es-PE'));
  });

  readonly hasCourses = computed(() => this.courses().length > 0);

  async load(): Promise<void> {
    const classroomId = this.route.snapshot.paramMap.get('classroomId') ?? '';
    this.classroomId.set(classroomId);
    this.loading.set(true);
    this.error.set(null);

    try {
      // Warm path: si el store ya tiene exámenes, no volvemos a llamar al back.
      if (this.store.exams().length === 0) {
        const list = await this.getTutorExams.execute();
        this.store.setExams(list);
      }
      await this.resolveClassroomName(classroomId);
    } catch (err) {
      if (err instanceof NetworkError) {
        this.error.set('network');
      } else {
        throw err;
      }
    } finally {
      this.loading.set(false);
    }
  }

  goToCourse(course: string): void {
    void this.router.navigate(['/tutor/aulas', this.classroomId(), 'curso', course]);
  }

  goBack(): void {
    void this.router.navigate(['/tutor/home']);
  }

  private async resolveClassroomName(classroomId: string): Promise<void> {
    try {
      const profile = (await this.getProfile.execute('tutor')) as TutorProfile;
      const aula: TutorClassroom | undefined = profile.classrooms.find((c) => c.id === classroomId);
      if (!aula) {
        this.error.set('notFound');
        return;
      }
      this.classroomName.set(aula.name);
    } catch (err) {
      if (err instanceof ProfileNotAvailableError) {
        // Perfil no disponible → seguimos sin nombre; la lista de cursos sirve igual.
        this.classroomName.set(null);
      } else if (!(err instanceof NetworkError)) {
        throw err;
      }
    }
  }
}
