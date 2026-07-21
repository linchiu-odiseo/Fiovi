import { Injectable, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { GetAulaSemanaExamenesUseCase } from '../../L2_application/use-cases/get-aula-semana-examenes.use-case';
import { AulaSemanaExamGrupo } from '../../L1_domain/entities/aula-semana-exam-grupo';
import { TutorExamsStore } from '../state/tutor-exams.store';
import { NetworkError } from '../../L1_domain/errors/network.error';
import { TutorExamForbiddenError } from '../../L1_domain/errors/tutor-exam-forbidden.error';
import { VirtualExamNotFoundError } from '../../L1_domain/errors/virtual-exam-not-found.error';

// VM de /tutor/aulas/:classroomId/semanas/:periodId — nivel 3 del nav.
// Recibe los exámenes ya agrupados por curso desde el backend. La UI puede
// expandir cada grupo client-side sin request adicional (mismo patrón que
// el 2-fetch aprobado en discovery: 1 request semana → 20 cursos × 4 fichas
// caben en un JSON de ~15 KB).
@Injectable()
export class TutorAulaSemanaExamenesViewModel {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly getExamenes = inject(GetAulaSemanaExamenesUseCase);
  private readonly examsStore = inject(TutorExamsStore);

  readonly classroomId = signal<string>('');
  readonly periodId = signal<string>('');
  readonly classroomName = signal<string | null>(null);
  readonly semanaName = signal<string | null>(null);
  readonly startDate = signal<string | null>(null);
  readonly endDate = signal<string | null>(null);
  readonly cursos = signal<readonly AulaSemanaExamGrupo[]>([]);
  readonly loading = signal(true);
  readonly error = signal<'network' | 'forbidden' | 'notFound' | null>(null);

  readonly hasCursos = computed(() => this.cursos().length > 0);

  async load(): Promise<void> {
    const classroomId = this.route.snapshot.paramMap.get('classroomId') ?? '';
    const periodId = this.route.snapshot.paramMap.get('periodId') ?? '';
    this.classroomId.set(classroomId);
    this.periodId.set(periodId);
    this.loading.set(true);
    this.error.set(null);

    try {
      const result = await this.getExamenes.execute(classroomId, periodId);
      this.classroomName.set(result.classroom.name);
      this.semanaName.set(result.week.name);
      this.startDate.set(result.week.startDate);
      this.endDate.set(result.week.endDate);
      this.cursos.set(result.cursos);

      // Popular TutorExamsStore con los TutorExam de esta semana. Cuando el
      // tutor tape un examen y navegue a /tutor/exams/:recordId, el warm
      // path del TutorExamDetailViewModel resuelve classroomId desde acá y
      // evita el fallback a getTutorExams (que traería los 2000+ virtuales
      // no-archivados). El home ya no llama getTutorExams, así que esta VM
      // es la fuente principal de hidratación del store.
      for (const grupo of result.cursos) {
        for (const exam of grupo.examenes) {
          this.examsStore.upsert(exam);
        }
      }
    } catch (err) {
      if (err instanceof VirtualExamNotFoundError) {
        this.error.set('notFound');
      } else if (err instanceof TutorExamForbiddenError) {
        this.error.set('forbidden');
      } else if (err instanceof NetworkError) {
        this.error.set('network');
      } else {
        throw err;
      }
    } finally {
      this.loading.set(false);
    }
  }

  goBack(): void {
    void this.router.navigate(['/tutor/aulas', this.classroomId(), 'semanas']);
  }
}
