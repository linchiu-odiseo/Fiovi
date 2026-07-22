import { describe, it, expect } from 'vitest';
import { apiPath } from '../../../../src/L3_periphery/http/api-paths';
import { environment } from '../../../../src/environments/environment';

// Specs para los helpers de apiPath de endpoints del tutor.
// Todos son tenant-scoped: reciben `slug` como primer parámetro.
// NOTA: todos usan encodeURIComponent internamente; los tests con
// "special chars" lo verifican.

const TEST_SLUG = 'vonex';
const BASE = `${environment.apiBaseUrl}/t/${TEST_SLUG}`;

describe('apiPath — helpers del tutor (con slug dinámico)', () => {
  describe('tutorVirtualExams(slug)', () => {
    it('retorna <base>/tutor/virtual-exams', () => {
      expect(apiPath.tutorVirtualExams(TEST_SLUG)).toBe(`${BASE}/tutor/virtual-exams`);
    });
  });

  describe('virtualExam(slug, recordId)', () => {
    it('retorna <base>/virtual-exams/rec-123 para recordId simple', () => {
      expect(apiPath.virtualExam(TEST_SLUG, 'rec-123')).toBe(`${BASE}/virtual-exams/rec-123`);
    });

    it('aplica encodeURIComponent: "foo/bar" → "foo%2Fbar"', () => {
      expect(apiPath.virtualExam(TEST_SLUG, 'foo/bar')).toBe(`${BASE}/virtual-exams/foo%2Fbar`);
    });
  });

  describe('classroomStudents(slug, classroomId, virtualExamDetailId)', () => {
    it('retorna URL con classroomId en path y virtualExamDetailId en query', () => {
      expect(apiPath.classroomStudents(TEST_SLUG, 'cls-1', 'det-abc')).toBe(
        `${BASE}/classrooms/cls-1/students?virtualExamDetailId=det-abc`,
      );
    });

    it('aplica encodeURIComponent sobre classroomId con "/" especial', () => {
      const url = apiPath.classroomStudents(TEST_SLUG, 'cls/1', 'det abc');
      expect(url).toContain('/classrooms/cls%2F1/students');
    });

    it('aplica encodeURIComponent sobre virtualExamDetailId con espacio', () => {
      const url = apiPath.classroomStudents(TEST_SLUG, 'cls/1', 'det abc');
      expect(url).toContain('virtualExamDetailId=det%20abc');
    });
  });

  describe('virtualExamEnabledStudents(slug, recordId)', () => {
    it('retorna <base>/virtual-exams/rec-1/enabled-students', () => {
      expect(apiPath.virtualExamEnabledStudents(TEST_SLUG, 'rec-1')).toBe(
        `${BASE}/virtual-exams/rec-1/enabled-students`,
      );
    });
  });

  describe('virtualExamStart(slug, recordId)', () => {
    it('retorna <base>/virtual-exams/rec-1/start', () => {
      expect(apiPath.virtualExamStart(TEST_SLUG, 'rec-1')).toBe(
        `${BASE}/virtual-exams/rec-1/start`,
      );
    });
  });

  describe('virtualExamFinalize(slug, recordId)', () => {
    it('retorna <base>/virtual-exams/rec-1/finalize', () => {
      expect(apiPath.virtualExamFinalize(TEST_SLUG, 'rec-1')).toBe(
        `${BASE}/virtual-exams/rec-1/finalize`,
      );
    });
  });

  describe('virtualExamArchive(slug, recordId)', () => {
    it('retorna <base>/virtual-exams/rec-1/archive', () => {
      expect(apiPath.virtualExamArchive(TEST_SLUG, 'rec-1')).toBe(
        `${BASE}/virtual-exams/rec-1/archive`,
      );
    });

    it('aplica encodeURIComponent sobre recordId con "/" especial', () => {
      expect(apiPath.virtualExamArchive(TEST_SLUG, 'foo/bar')).toBe(
        `${BASE}/virtual-exams/foo%2Fbar/archive`,
      );
    });
  });

  describe('coexistencia con helpers pre-existentes', () => {
    it('los helpers del tutor conviven con los globales y del alumno', () => {
      // Globales (sin slug).
      expect(typeof apiPath.login).toBe('function');
      expect(typeof apiPath.selectTenant).toBe('function');
      expect(typeof apiPath.listSsoProviders).toBe('function');
      expect(typeof apiPath.ssoStart).toBe('function');
      // Tenant-scoped del alumno.
      expect(typeof apiPath.studentExamSubmit).toBe('function');
      expect(typeof apiPath.studentExamDraft).toBe('function');
      // Tenant-scoped del tutor.
      expect(typeof apiPath.tutorVirtualExams).toBe('function');
      expect(typeof apiPath.virtualExam).toBe('function');
      expect(typeof apiPath.classroomStudents).toBe('function');
      expect(typeof apiPath.virtualExamEnabledStudents).toBe('function');
      expect(typeof apiPath.virtualExamStart).toBe('function');
      expect(typeof apiPath.virtualExamFinalize).toBe('function');
      expect(typeof apiPath.virtualExamArchive).toBe('function');
    });
  });
});
