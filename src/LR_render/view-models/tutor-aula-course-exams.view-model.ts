import { Injectable, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { GetTutorExamsUseCase } from '../../L2_application/use-cases/get-tutor-exams.use-case';
import { TutorExamsStore } from '../state/tutor-exams.store';
import { TutorExam } from '../../L1_domain/entities/tutor-exam';
import { NetworkError } from '../../L1_domain/errors/network.error';

// VM de /tutor/aulas/:classroomId/curso/:course — lista los exámenes filtrados
// del store por aula y curso. Sin llamada al back en warm path.
// `course` en la URL es el nombre snapshot; "Sin curso" mapea a `course: null`
// para que el path aula→cursos→exámenes coincida con la card de agrupación.
@Injectable()
export class TutorAulaCourseExamsViewModel {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly getTutorExams = inject(GetTutorExamsUseCase);
  private readonly store = inject(TutorExamsStore);

  readonly classroomId = signal<string>('');
  readonly course = signal<string>('');
  readonly loading = signal(true);
  readonly error = signal<'network' | null>(null);

  readonly exams = computed<readonly TutorExam[]>(() => {
    const classroomId = this.classroomId();
    const course = this.course();
    if (!classroomId || !course) return [];
    return this.store
      .exams()
      .filter((exam) => {
        if (exam.classroomId !== classroomId) return false;
        const examCourse = exam.course ?? 'Sin curso';
        return examCourse === course;
      })
      .slice()
      .sort((a, b) => b.scheduled.getTime() - a.scheduled.getTime());
  });

  readonly isEmpty = computed(() => this.exams().length === 0);

  async load(): Promise<void> {
    this.classroomId.set(this.route.snapshot.paramMap.get('classroomId') ?? '');
    this.course.set(this.route.snapshot.paramMap.get('course') ?? '');
    this.loading.set(true);
    this.error.set(null);

    try {
      if (this.store.exams().length === 0) {
        const list = await this.getTutorExams.execute();
        this.store.setExams(list);
      }
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

  goToExam(exam: TutorExam): void {
    void this.router.navigate(['/tutor/exams', exam.recordId]);
  }

  goBack(): void {
    void this.router.navigate(['/tutor/aulas', this.classroomId()]);
  }
}
