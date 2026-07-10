import { Component, inject } from '@angular/core';
import { TutorAulaCoursesViewModel, AulaCourseItem } from '../../view-models/tutor-aula-courses.view-model';

// Pantalla /tutor/aulas/:classroomId — lista los cursos que hay dentro del aula
// seleccionada, agrupados desde el snapshot de exámenes del store.
@Component({
  selector: 'app-tutor-aula-courses-page',
  templateUrl: './tutor-aula-courses.page.html',
  styleUrl: './tutor-aula-courses.page.scss',
  providers: [TutorAulaCoursesViewModel],
})
export class TutorAulaCoursesPage {
  protected readonly vm = inject(TutorAulaCoursesViewModel);

  constructor() {
    void this.vm.load();
  }

  protected onVolver(): void {
    this.vm.goBack();
  }

  protected onCourseClick(course: AulaCourseItem): void {
    this.vm.goToCourse(course.name);
  }

  protected onRetry(): void {
    void this.vm.load();
  }
}
