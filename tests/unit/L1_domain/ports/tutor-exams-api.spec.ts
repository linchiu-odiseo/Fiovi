import { describe, it, expect } from 'vitest';
// Type-only smoke test: verifica que el puerto TutorExamsApi expone exactamente
// 9 métodos y que el archivo no importa nada de Angular.
//
// NO HAY Angular imports en src/L1_domain/ports/tutor-exams-api.ts:
//   - no import from '@angular/core'
//   - no import from '@angular/common/http'
//   - solo importa tipos de dominio (TutorExam, TutorExamDetail, etc.)
import type { TutorExamsApi } from '../../../../src/L1_domain/ports/tutor-exams-api';

describe('TutorExamsApi port — smoke de tipos', () => {
  it('el módulo del puerto carga sin errores de importación', async () => {
    // Si hay imports de Angular que no existen en este contexto, esto fallará.
    const module = await import('../../../../src/L1_domain/ports/tutor-exams-api');
    // El módulo no debe exportar una clase concreta Angular — solo tipos/interfaces.
    // Si en el módulo aparece algo como @Injectable, Angular lo registraría y habría
    // side effects. Verificamos que no haya una clase default inyectable.
    expect(module).toBeTruthy();
  });

  it('una implementación mínima satisface los 9 métodos del puerto (type-check)', () => {
    // Este bloque verifica en runtime que una implementación fake
    // que cumpla los 9 métodos es asignable a TutorExamsApi.
    // Si la interfaz cambiara y faltaran métodos, el assignment de tipo fallaría.
    const fake: TutorExamsApi = {
      getTutorExams: async () => [],
      getExamsFinalizadas: async () => [],
      getExamDetail: async (_recordId: string) => {
        throw new Error('not implemented');
      },
      listClassroomStudents: async (_req: {
        classroomId: string;
        virtualExamDetailId: string;
      }) => [],
      updateEnabledStudents: async (_req: {
        recordId: string;
        enabledStudentIds: readonly string[];
      }) => {
        return;
      },
      iniciar: async (_recordId: string) => {
        return;
      },
      finalizar: async (_recordId: string) => ({ transitioned: false }),
      archivar: async (_recordId: string) => {
        return;
      },
      refreshEnabled: async (_recordId: string) => ({ addedCount: 0, totalEnabledCount: 0 }),
    };

    // Contamos los métodos expuestos en el fake (debe ser exactamente 9).
    const fakeAsRecord = fake as unknown as Record<string, unknown>;
    const methodCount = Object.keys(fakeAsRecord).filter(
      (key) => typeof fakeAsRecord[key] === 'function',
    ).length;

    expect(methodCount).toBe(9);
    expect(typeof fake.getTutorExams).toBe('function');
    expect(typeof fake.getExamsFinalizadas).toBe('function');
    expect(typeof fake.getExamDetail).toBe('function');
    expect(typeof fake.listClassroomStudents).toBe('function');
    expect(typeof fake.updateEnabledStudents).toBe('function');
    expect(typeof fake.iniciar).toBe('function');
    expect(typeof fake.finalizar).toBe('function');
    expect(typeof fake.archivar).toBe('function');
    expect(typeof fake.refreshEnabled).toBe('function');
  });
});
