import { Component, inject } from '@angular/core';
import { AulaSemana } from '../../../L1_domain/entities/aula-semana';
import { TutorAulaSemanasViewModel } from '../../view-models/tutor-aula-semanas.view-model';

// Pantalla /tutor/aulas/:classroomId/semanas — nivel 2 del nav mobile
// AULA → SEMANA → CURSO → EXÁMENES. Lista todas las semanas del ciclo del
// aula (incluye semanas sin exámenes creados, con un badge "sin exámenes").
@Component({
  selector: 'app-tutor-aula-semanas-page',
  templateUrl: './tutor-aula-semanas.page.html',
  styleUrl: './tutor-aula-semanas.page.scss',
  providers: [TutorAulaSemanasViewModel],
})
export class TutorAulaSemanasPage {
  protected readonly vm = inject(TutorAulaSemanasViewModel);

  constructor() {
    void this.vm.load();
  }

  protected onVolver(): void {
    this.vm.goBack();
  }

  protected onSemanaClick(semana: AulaSemana): void {
    this.vm.goToSemana(semana.periodId);
  }

  protected onRetry(): void {
    void this.vm.load();
  }

  /** True cuando la semana coincide con el "hoy" del reloj server-anchored. */
  protected esActual(semana: AulaSemana): boolean {
    const actual = this.vm.semanaActual();
    return actual !== null && actual.periodId === semana.periodId;
  }
}
