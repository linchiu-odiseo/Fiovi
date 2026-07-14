import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { TUTOR_EXAMS_API } from '../../../src/L3_periphery/tokens';
import { FakeTutorExamsApi } from '../../../src/L3_periphery/fakes/fake-tutor-exams-api';
import type { TutorExamsApi } from '../../../src/L1_domain/ports/tutor-exams-api';

// Type-level integration: verifica que TUTOR_EXAMS_API token resuelve a TutorExamsApi
// cuando se provee con FakeTutorExamsApi. Satisface tutor-exams-api Requirement
// "Token de inyección TUTOR_EXAMS_API" / Scenario "FakeTutorExamsApi implementa el port completo".

describe('TUTOR_EXAMS_API token + FakeTutorExamsApi', () => {
  it('TUTOR_EXAMS_API token resuelve a TutorExamsApi cuando se inyecta FakeTutorExamsApi', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: TUTOR_EXAMS_API, useClass: FakeTutorExamsApi }],
    });

    // Si FakeTutorExamsApi no implementara TutorExamsApi, useClass fallaría en tiempo
    // de compilación (TS verifica la asignabilidad).
    const api = TestBed.inject<TutorExamsApi>(TUTOR_EXAMS_API);
    expect(api).toBeInstanceOf(FakeTutorExamsApi);
    expect(typeof api.getTutorExams).toBe('function');
    expect(typeof api.getExamDetail).toBe('function');
    expect(typeof api.listClassroomStudents).toBe('function');
    expect(typeof api.updateEnabledStudents).toBe('function');
    expect(typeof api.iniciar).toBe('function');
    expect(typeof api.finalizar).toBe('function');
  });

  it('FakeTutorExamsApi.getTutorExams() resuelve con array vacío por defecto', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: TUTOR_EXAMS_API, useClass: FakeTutorExamsApi }],
    });

    const api = TestBed.inject<TutorExamsApi>(TUTOR_EXAMS_API);
    const result = await api.getTutorExams();
    expect(result).toEqual([]);
  });

  it('FakeTutorExamsApi.iniciar() resuelve void', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: TUTOR_EXAMS_API, useClass: FakeTutorExamsApi }],
    });

    const api = TestBed.inject<TutorExamsApi>(TUTOR_EXAMS_API);
    await expect(api.iniciar('rec-1')).resolves.toBeUndefined();
  });
});
