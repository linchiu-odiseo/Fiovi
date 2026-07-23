import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { TutorExamsStore } from '../../../../src/LR_render/state/tutor-exams.store';
import { TutorExam } from '../../../../src/L1_domain/entities/tutor-exam';
import { ExamServerStatus } from '../../../../src/L1_domain/value-objects/exam-server-status';

function buildExam(overrides: Partial<ConstructorParameters<typeof TutorExam>[0]> = {}): TutorExam {
  return new TutorExam({
    detailId: 'det-1',
    recordId: 'rec-1',
    classroomId: 'cls-1',
    serverStatus: new ExamServerStatus('scheduled'),
    name: 'Examen de Matemáticas',
    course: 'Álgebra',
    area: 'Matemáticas',
    count: 20,
    duration: 60,
    scheduled: new Date('2026-06-01T10:00:00Z'),
    startedAt: null,
    finishedAt: null,
    openUntil: null,
    ...overrides,
  });
}

describe('TutorExamsStore', () => {
  let store: TutorExamsStore;

  const getStore = (): TutorExamsStore =>
    TestBed.runInInjectionContext(() => TestBed.inject(TutorExamsStore));

  beforeEach(async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      providers: [TutorExamsStore],
    }).compileComponents();

    store = getStore();
  });

  describe('estado inicial', () => {
    it('exams() inicia vacío', () => {
      expect(store.exams()).toEqual([]);
    });
  });

  describe('setExams()', () => {
    it('setExams([exam1, exam2]) actualiza la signal list inmediatamente', () => {
      const exam1 = buildExam({ recordId: 'rec-1' });
      const exam2 = buildExam({ recordId: 'rec-2', detailId: 'det-2' });

      store.setExams([exam1, exam2]);

      expect(store.exams()).toHaveLength(2);
      expect(store.exams()[0]).toBe(exam1);
      expect(store.exams()[1]).toBe(exam2);
    });

    it('setExams(newList) sobreescribe la lista previa (Store actualizado tras polling)', () => {
      const exam1 = buildExam({ recordId: 'rec-1' });
      store.setExams([exam1]);
      expect(store.exams()).toHaveLength(1);

      const exam2 = buildExam({ recordId: 'rec-2', detailId: 'det-2' });
      const exam3 = buildExam({ recordId: 'rec-3', detailId: 'det-3' });
      store.setExams([exam2, exam3]);

      expect(store.exams()).toHaveLength(2);
      expect(store.exams()[0]).toBe(exam2);
    });
  });

  describe('findByRecordId()', () => {
    it('store vacío → findByRecordId("any") retorna null (store-miss)', () => {
      expect(store.findByRecordId('any')).toBeNull();
    });

    it('setExams([exam1, exam2]) → findByRecordId("rec-1") retorna exam1', () => {
      const exam1 = buildExam({ recordId: 'rec-1', classroomId: 'cls-1', detailId: 'det-1' });
      const exam2 = buildExam({ recordId: 'rec-2', classroomId: 'cls-2', detailId: 'det-2' });
      store.setExams([exam1, exam2]);

      const found = store.findByRecordId('rec-1');

      expect(found).toBe(exam1);
      expect(found?.classroomId).toBe('cls-1');
      expect(found?.detailId).toBe('det-1');
    });

    it('recordId no existe en la lista → retorna null', () => {
      const exam1 = buildExam({ recordId: 'rec-1' });
      store.setExams([exam1]);

      expect(store.findByRecordId('rec-999')).toBeNull();
    });
  });

  describe('clear()', () => {
    it('clear() vacía la lista', () => {
      const exam1 = buildExam({ recordId: 'rec-1' });
      store.setExams([exam1]);
      expect(store.exams()).toHaveLength(1);

      store.clear();

      expect(store.exams()).toHaveLength(0);
    });

    it('findByRecordId después de clear() retorna null', () => {
      const exam1 = buildExam({ recordId: 'rec-1' });
      store.setExams([exam1]);

      store.clear();

      expect(store.findByRecordId('rec-1')).toBeNull();
    });
  });

  describe('remove()', () => {
    it('remove() saca el exam por recordId y deja el resto', () => {
      const a = buildExam({ recordId: 'rec-a' });
      const b = buildExam({ recordId: 'rec-b' });
      store.setExams([a, b]);

      store.remove('rec-a');

      expect(store.exams()).toHaveLength(1);
      expect(store.findByRecordId('rec-a')).toBeNull();
      expect(store.findByRecordId('rec-b')).not.toBeNull();
    });

    it('remove() sobre un recordId inexistente es no-op (no re-emite la signal)', () => {
      const a = buildExam({ recordId: 'rec-a' });
      store.setExams([a]);
      const before = store.exams();

      store.remove('rec-inexistente');

      // Misma referencia = la signal no re-emitió. Preserva identidad para que
      // los computed downstream no recomputen sin necesidad.
      expect(store.exams()).toBe(before);
    });
  });

  describe('upsert()', () => {
    it('upsert actualiza un exam existente por recordId', () => {
      const exam1 = buildExam({ recordId: 'rec-1', name: 'Original' });
      store.setExams([exam1]);

      const updated = buildExam({
        recordId: 'rec-1',
        name: 'Updated',
        serverStatus: new ExamServerStatus('in_progress'),
      });
      store.upsert(updated);

      expect(store.exams()).toHaveLength(1);
      expect(store.findByRecordId('rec-1')?.name).toBe('Updated');
    });

    it('upsert agrega un exam nuevo cuando no existe por recordId', () => {
      const exam1 = buildExam({ recordId: 'rec-1' });
      store.setExams([exam1]);

      const newExam = buildExam({ recordId: 'rec-99', detailId: 'det-99' });
      store.upsert(newExam);

      expect(store.exams()).toHaveLength(2);
      expect(store.findByRecordId('rec-99')).toBe(newExam);
    });
  });
});
