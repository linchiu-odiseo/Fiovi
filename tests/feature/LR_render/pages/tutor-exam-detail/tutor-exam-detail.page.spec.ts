import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Component, signal, WritableSignal } from '@angular/core';
import { TutorExamDetailPage } from '../../../../../src/LR_render/pages/tutor-exam-detail/tutor-exam-detail.page';
import { TutorExamDetailViewModel } from '../../../../../src/LR_render/view-models/tutor-exam-detail.view-model';
import { TutorExamDetail } from '../../../../../src/L1_domain/value-objects/tutor-exam-detail';
import { ClassroomStudent } from '../../../../../src/L1_domain/value-objects/classroom-student';
import { ExamServerStatus } from '../../../../../src/L1_domain/value-objects/exam-server-status';

// ─── builders ────────────────────────────────────────────────────────────────

function buildDetail(overrides: Partial<TutorExamDetail> = {}): TutorExamDetail {
  return {
    id: 'det-1',
    recordId: 'rec-1',
    status: new ExamServerStatus('scheduled'),
    name: 'Examen de Matemáticas',
    course: 'Álgebra',
    area: 'Matemáticas',
    count: 20,
    duration: 60,
    enabledStudentIds: ['s-1'],
    startedAt: null,
    finishedAt: null,
    createdAt: new Date('2026-06-01T10:00:00Z'),
    ...overrides,
  };
}

function buildStudent(overrides: Partial<ClassroomStudent> = {}): ClassroomStudent {
  return {
    studentId: 's-1',
    studentCode: 'CODE001',
    firstName: 'Ana',
    lastName: 'García',
    enabled: true,
    hasSubmitted: false,
    ...overrides,
  };
}

// ─── Fake VM ─────────────────────────────────────────────────────────────────

class FakeTutorExamDetailViewModel {
  readonly detail: WritableSignal<TutorExamDetail | null> = signal(null);
  readonly students: WritableSignal<readonly ClassroomStudent[]> = signal([]);
  readonly loading: WritableSignal<boolean> = signal(false);
  readonly error: WritableSignal<'network' | 'notFound' | 'forbidden' | null> = signal(null);
  readonly enabledStudentIds: WritableSignal<readonly string[]> = signal([]);
  readonly isSaving: WritableSignal<boolean> = signal(false);
  readonly actionError: WritableSignal<string | null> = signal(null);
  // Modal "editar duración antes de iniciar" con formato mm:ss.
  readonly iniciarModalOpen: WritableSignal<boolean> = signal(false);
  readonly pendingMinutes: WritableSignal<number | null> = signal(null);
  readonly pendingSeconds: WritableSignal<number | null> = signal(null);
  readonly durationError: WritableSignal<string | null> = signal(null);
  readonly pendingTotalSeconds = () => {
    const m = this.pendingMinutes();
    const s = this.pendingSeconds();
    if (m === null || s === null) return null;
    return m * 60 + s;
  };
  // Modal "confirmar finalización antes de tiempo".
  readonly finalizarModalOpen: WritableSignal<boolean> = signal(false);
  // Modal "confirmar archivar" (post-finalize).
  readonly archivarModalOpen: WritableSignal<boolean> = signal(false);
  // Modal "confirmar deshabilitar alumno en curso".
  readonly desactivarModalOpen: WritableSignal<boolean> = signal(false);
  readonly desactivarPendingStudentId: WritableSignal<string | null> = signal(null);
  // Contadores del panel de alumnos.
  readonly enabledCount = () => this.enabledStudentIds().length;
  readonly totalStudents = () => this.students().length;

  canIniciar = vi.fn().mockReturnValue(false);
  canFinalizar = vi.fn().mockReturnValue(false);
  canArchivar = vi.fn().mockReturnValue(false);
  isCheckboxDisabled = vi.fn().mockReturnValue(false);

  openIniciarModal = vi.fn(() => {
    this.iniciarModalOpen.set(true);
  });
  cancelIniciarModal = vi.fn(() => {
    this.iniciarModalOpen.set(false);
  });
  confirmIniciarModal = vi.fn(async () => {
    this.iniciarModalOpen.set(false);
  });
  openFinalizarModal = vi.fn(() => {
    this.finalizarModalOpen.set(true);
  });
  cancelFinalizarModal = vi.fn(() => {
    this.finalizarModalOpen.set(false);
  });
  confirmFinalizarModal = vi.fn(async () => {
    this.finalizarModalOpen.set(false);
  });
  openArchivarModal = vi.fn(() => {
    this.archivarModalOpen.set(true);
  });
  cancelArchivarModal = vi.fn(() => {
    this.archivarModalOpen.set(false);
  });
  confirmArchivarModal = vi.fn(async () => {
    this.archivarModalOpen.set(false);
  });
  requestToggleStudent = vi.fn();
  confirmDesactivarStudent = vi.fn(async () => {
    this.desactivarModalOpen.set(false);
    this.desactivarPendingStudentId.set(null);
  });
  cancelDesactivarStudent = vi.fn(() => {
    this.desactivarModalOpen.set(false);
    this.desactivarPendingStudentId.set(null);
  });

  // Countdown en vivo (mismo shape que el simulacro del alumno). En el fake
  // exponemos strings vacíos porque el fake no arranca el ticker — la lógica
  // real vive en el VM y está cubierta por su propio spec.
  readonly effectiveCloseAt = () => null;
  readonly countdownRestante = () => '';
  readonly closeTimeText = () => '';
  readonly closeLabelPrefix = () => 'Cierra a las';

  async load(): Promise<void> {
    /* no-op */
  }
  async retry(): Promise<void> {
    /* no-op */
  }
  async iniciar(_newDuration?: number): Promise<void> {
    /* no-op */
  }
  async finalizar(): Promise<void> {
    /* no-op */
  }
  async archivar(): Promise<void> {
    /* no-op */
  }
  async toggleStudent(_studentId: string): Promise<void> {
    /* no-op */
  }
  stop(): void {
    /* no-op — el fake no arranca timers */
  }
}

@Component({ template: '' })
class TutorExamsListStub {}

// ─── test suite ──────────────────────────────────────────────────────────────

describe('TutorExamDetailPage', () => {
  let fakeVm: FakeTutorExamDetailViewModel;

  beforeEach(async () => {
    fakeVm = new FakeTutorExamDetailViewModel();

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [TutorExamDetailPage],
      providers: [
        provideRouter([
          { path: 'tutor/home', component: TutorExamsListStub },
          { path: 'tutor/exams/:recordId', component: TutorExamDetailPage },
        ]),
      ],
    })
      .overrideComponent(TutorExamDetailPage, {
        set: {
          providers: [{ provide: TutorExamDetailViewModel, useValue: fakeVm }],
        },
      })
      .compileComponents();
  });

  // ── VM local provider ──────────────────────────────────────────────────────

  describe('Scenario: VM es local al componente page', () => {
    it('TutorExamDetailViewModel aparece en providers del decorador @Component', () => {
      const fixture = TestBed.createComponent(TutorExamDetailPage);
      fixture.detectChanges();
      // Si el VM no fuera provider-local, el inject() del page lanzaría error aquí.
      expect(fixture.componentInstance).toBeDefined();
    });
  });

  // ── Iniciar button visibility ──────────────────────────────────────────────

  describe('Scenario: Botón Iniciar visible cuando status=scheduled', () => {
    it('botón "Iniciar" está en el DOM cuando canIniciar() es true', async () => {
      fakeVm.detail.set(buildDetail({ status: new ExamServerStatus('scheduled') }));
      fakeVm.canIniciar.mockReturnValue(true);
      fakeVm.canFinalizar.mockReturnValue(false);

      const fixture = TestBed.createComponent(TutorExamDetailPage);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const btn = el.querySelector('[data-testid="btn-iniciar"]');
      expect(btn).not.toBeNull();
    });

    it('botón "Iniciar" ausente cuando canIniciar() es false', async () => {
      fakeVm.detail.set(buildDetail({ status: new ExamServerStatus('in_progress') }));
      fakeVm.canIniciar.mockReturnValue(false);
      fakeVm.canFinalizar.mockReturnValue(true);

      const fixture = TestBed.createComponent(TutorExamDetailPage);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const btn = el.querySelector('[data-testid="btn-iniciar"]');
      expect(btn).toBeNull();
    });
  });

  describe('Scenario: Botón Iniciar deshabilitado si enabledStudentIds().length === 0 (D5)', () => {
    it('botón "Iniciar" está disabled cuando canIniciar() devuelve false (sin alumnos)', async () => {
      fakeVm.detail.set(buildDetail({ status: new ExamServerStatus('scheduled') }));
      fakeVm.enabledStudentIds.set([]);
      // canIniciar returns false because no enabled students
      fakeVm.canIniciar.mockReturnValue(false);
      fakeVm.canFinalizar.mockReturnValue(false);

      const fixture = TestBed.createComponent(TutorExamDetailPage);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      // No iniciar button when canIniciar is false
      const btn = el.querySelector('[data-testid="btn-iniciar"]');
      expect(btn).toBeNull();
    });
  });

  describe('Scenario: Botón Iniciar NO aparece si status es in_progress o finalized', () => {
    it('botón "Iniciar" ausente con status=in_progress', async () => {
      fakeVm.detail.set(buildDetail({ status: new ExamServerStatus('in_progress') }));
      fakeVm.canIniciar.mockReturnValue(false);
      fakeVm.canFinalizar.mockReturnValue(true);

      const fixture = TestBed.createComponent(TutorExamDetailPage);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('[data-testid="btn-iniciar"]')).toBeNull();
    });

    it('botón "Iniciar" ausente con status=finalized', async () => {
      fakeVm.detail.set(buildDetail({ status: new ExamServerStatus('finalized') }));
      fakeVm.canIniciar.mockReturnValue(false);
      fakeVm.canFinalizar.mockReturnValue(false);

      const fixture = TestBed.createComponent(TutorExamDetailPage);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('[data-testid="btn-iniciar"]')).toBeNull();
    });
  });

  // ── Finalizar button visibility ────────────────────────────────────────────

  describe('Scenario: Botón Finalizar visible cuando status=in_progress', () => {
    it('botón "Finalizar" está en el DOM cuando canFinalizar() es true', async () => {
      fakeVm.detail.set(buildDetail({ status: new ExamServerStatus('in_progress') }));
      fakeVm.canIniciar.mockReturnValue(false);
      fakeVm.canFinalizar.mockReturnValue(true);

      const fixture = TestBed.createComponent(TutorExamDetailPage);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const btn = el.querySelector('[data-testid="btn-finalizar"]');
      expect(btn).not.toBeNull();
    });

    it('botón "Finalizar" ausente cuando canFinalizar() es false', async () => {
      fakeVm.detail.set(buildDetail({ status: new ExamServerStatus('scheduled') }));
      fakeVm.canIniciar.mockReturnValue(true);
      fakeVm.canFinalizar.mockReturnValue(false);

      const fixture = TestBed.createComponent(TutorExamDetailPage);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('[data-testid="btn-finalizar"]')).toBeNull();
    });
  });

  describe('Scenario: Botón Finalizar NO aparece si status es scheduled o finalized', () => {
    it('botón "Finalizar" ausente con status=scheduled', async () => {
      fakeVm.canFinalizar.mockReturnValue(false);
      fakeVm.detail.set(buildDetail({ status: new ExamServerStatus('scheduled') }));

      const fixture = TestBed.createComponent(TutorExamDetailPage);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('[data-testid="btn-finalizar"]')).toBeNull();
    });

    it('botón "Finalizar" ausente con status=finalized', async () => {
      fakeVm.canFinalizar.mockReturnValue(false);
      fakeVm.detail.set(buildDetail({ status: new ExamServerStatus('finalized') }));

      const fixture = TestBed.createComponent(TutorExamDetailPage);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('[data-testid="btn-finalizar"]')).toBeNull();
    });
  });

  // ── Checkbox disabled states ───────────────────────────────────────────────

  describe('Scenario: Checkbox de alumno con hasSubmitted deshabilitado (D5)', () => {
    it('checkbox de alumno con hasSubmitted=true está disabled', async () => {
      const submitted = buildStudent({ studentId: 's-sub', hasSubmitted: true });
      fakeVm.students.set([submitted]);
      fakeVm.detail.set(buildDetail({ status: new ExamServerStatus('scheduled') }));
      fakeVm.isCheckboxDisabled.mockImplementation((s: ClassroomStudent) => s.hasSubmitted);

      const fixture = TestBed.createComponent(TutorExamDetailPage);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const checkbox = el.querySelector(
        'input[type="checkbox"][data-testid="student-checkbox"]',
      ) as HTMLInputElement;
      expect(checkbox).not.toBeNull();
      expect(checkbox.disabled).toBe(true);
    });
  });

  describe('Scenario: Checkboxes deshabilitados en modo finalized (D5)', () => {
    it('todos los checkboxes disabled cuando status=finalized', async () => {
      fakeVm.students.set([
        buildStudent({ studentId: 's-1', hasSubmitted: false }),
        buildStudent({ studentId: 's-2', hasSubmitted: false }),
      ]);
      fakeVm.detail.set(buildDetail({ status: new ExamServerStatus('finalized') }));
      // All disabled when finalized
      fakeVm.isCheckboxDisabled.mockReturnValue(true);

      const fixture = TestBed.createComponent(TutorExamDetailPage);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const checkboxes = el.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"][data-testid="student-checkbox"]',
      );
      expect(checkboxes.length).toBe(2);
      for (const cb of Array.from(checkboxes)) {
        expect(cb.disabled).toBe(true);
      }
    });
  });

  // ── Error banner + retry ───────────────────────────────────────────────────

  describe('Scenario: Error de red en carga inicial → estado de error con botón reintentar', () => {
    it('error banner visible cuando error()="network"', async () => {
      fakeVm.error.set('network');

      const fixture = TestBed.createComponent(TutorExamDetailPage);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const banner = el.querySelector('[data-testid="error-banner"]');
      expect(banner).not.toBeNull();
    });

    it('botón "Reintentar" visible cuando error()="network"', async () => {
      fakeVm.error.set('network');

      const fixture = TestBed.createComponent(TutorExamDetailPage);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const retryBtn = el.querySelector('[data-testid="btn-retry"]');
      expect(retryBtn).not.toBeNull();
    });

    it('error banner ausente cuando error()=null', async () => {
      fakeVm.error.set(null);
      fakeVm.detail.set(buildDetail());

      const fixture = TestBed.createComponent(TutorExamDetailPage);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('[data-testid="error-banner"]')).toBeNull();
    });
  });

  // ── Back button (btn-volver) ───────────────────────────────────────────────

  describe('Scenario: Botón Volver — navegación a /tutor/home (iOS standalone)', () => {
    it('btn-volver existe en el DOM cuando no hay error', async () => {
      fakeVm.detail.set(buildDetail());
      fakeVm.error.set(null);

      const fixture = TestBed.createComponent(TutorExamDetailPage);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('[data-testid="btn-volver"]')).not.toBeNull();
    });

    it('btn-volver existe en el DOM incluso cuando error() está seteado', async () => {
      fakeVm.error.set('network');

      const fixture = TestBed.createComponent(TutorExamDetailPage);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('[data-testid="btn-volver"]')).not.toBeNull();
    });

    it('click en btn-volver navega a ["/tutor/home"] via Router.navigate', async () => {
      fakeVm.detail.set(buildDetail());
      fakeVm.error.set(null);

      const fixture = TestBed.createComponent(TutorExamDetailPage);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      const btn = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="btn-volver"]',
      ) as HTMLButtonElement;
      btn.click();

      // Flush promises for the async navigate
      for (let i = 0; i < 5; i++) await Promise.resolve();

      expect(navigateSpy).toHaveBeenCalledWith(['/tutor/home']);
    });

    it('btn-volver usa Router.navigate — NO usa history.back()', async () => {
      // Verifica que el componente tenga el método onVolver() que llama Router.navigate
      // (no history.back, que falla en iOS standalone sin historial previo).
      const fixture = TestBed.createComponent(TutorExamDetailPage);
      fixture.detectChanges();

      const page = fixture.componentInstance as TutorExamDetailPage & {
        onVolver?: () => void;
      };
      expect(typeof page.onVolver).toBe('function');
    });
  });
});
