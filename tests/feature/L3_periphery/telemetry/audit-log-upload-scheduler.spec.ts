// Feature tests del AuditLogUploadScheduler — la lógica de CUÁNDO se sube.
//
// Lo que se protege acá es que los alumnos no coincidan. La cita se sortea
// dentro de una ventana, se persiste como timestamp absoluto (sobrevive al
// cierre de la app) y, si venció con la app cerrada, se vuelve a sortear en
// vez de disparar en el instante en que el alumno abrió — que es cuando
// todos abren a la vez.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AuditLogUploadScheduler } from '../../../../src/L3_periphery/telemetry/audit-log-upload-scheduler.service';
import { AuditLogUploadDispatcherService } from '../../../../src/L3_periphery/telemetry/audit-log-upload-dispatcher.service';
import { ExamActivity } from '../../../../src/L3_periphery/telemetry/exam-activity.service';

const NEXT_ATTEMPT_KEY = 'fiovi-audit-log-next-attempt-at';
const LAST_UPLOAD_KEY = 'fiovi-audit-log-last-upload-at';
const FIVE_HOURS = 5 * 60 * 60 * 1000;
const THIRTY_MIN = 30 * 60 * 1000;

const NOW = 1_800_000_000_000;

describe('AuditLogUploadScheduler', () => {
  let uploadSpy: ReturnType<typeof vi.fn>;
  let scheduler: AuditLogUploadScheduler;
  let examActivity: ExamActivity;

  beforeEach(() => {
    localStorage.clear();
    uploadSpy = vi.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        AuditLogUploadScheduler,
        ExamActivity,
        { provide: AuditLogUploadDispatcherService, useValue: { uploadPending: uploadSpy } },
      ],
    });
    scheduler = TestBed.inject(AuditLogUploadScheduler);
    examActivity = TestBed.inject(ExamActivity);
  });

  afterEach(() => {
    scheduler.stop();
    localStorage.clear();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  function setLastUpload(ms: number): void {
    localStorage.setItem(LAST_UPLOAD_KEY, String(ms));
  }

  function nextAttempt(): number | null {
    const raw = localStorage.getItem(NEXT_ATTEMPT_KEY);
    return raw === null ? null : Number(raw);
  }

  it('instalación nueva: ancla el reloj y no sube al primer arranque', async () => {
    await scheduler.tick(NOW);

    expect(uploadSpy).not.toHaveBeenCalled();
    expect(nextAttempt()).toBeNull();
    expect(Number(localStorage.getItem(LAST_UPLOAD_KEY))).toBe(NOW);
  });

  it('antes de cumplirse la cadencia no agenda nada', async () => {
    setLastUpload(NOW - FIVE_HOURS + 60_000);

    await scheduler.tick(NOW);

    expect(nextAttempt()).toBeNull();
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it('al cumplirse la cadencia agenda una cita dentro de la ventana, sin subir todavía', async () => {
    setLastUpload(NOW - FIVE_HOURS);

    await scheduler.tick(NOW);

    const at = nextAttempt();
    expect(at).not.toBeNull();
    expect(at!).toBeGreaterThanOrEqual(NOW);
    expect(at!).toBeLessThan(NOW + THIRTY_MIN);
    // Agendar no es subir: subir en el mismo tick en que vence sería juntar
    // a todos los que vencen a la vez.
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it('la cita se reparte: dos alumnos que vencen juntos no sortean lo mismo', async () => {
    const draws = new Set<number>();
    for (let i = 0; i < 20; i++) {
      localStorage.clear();
      setLastUpload(NOW - FIVE_HOURS);
      await scheduler.tick(NOW);
      draws.add(nextAttempt()!);
    }
    // Con 20 sorteos sobre una ventana de 30 min, que salgan todos iguales
    // significaría que no hay dispersión real.
    expect(draws.size).toBeGreaterThan(1);
  });

  it('llegada la cita con la app abierta, sube y limpia la cita', async () => {
    setLastUpload(NOW - FIVE_HOURS);
    localStorage.setItem(NEXT_ATTEMPT_KEY, String(NOW - 1000));

    await scheduler.tick(NOW);

    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect(nextAttempt()).toBeNull();
    expect(Number(localStorage.getItem(LAST_UPLOAD_KEY))).toBe(NOW);
  });

  // El escenario que motivó todo esto: cierra a las 6pm, abre a las 8am.
  it('si la cita venció con la app cerrada, re-sortea en vez de subir al abrir', async () => {
    setLastUpload(NOW - 14 * 60 * 60 * 1000);
    // Cita de anoche, hace horas.
    localStorage.setItem(NEXT_ATTEMPT_KEY, String(NOW - 8 * 60 * 60 * 1000));

    await scheduler.tick(NOW);

    // No sube AHORA: a esta hora abren todos los alumnos a la vez.
    expect(uploadSpy).not.toHaveBeenCalled();
    const at = nextAttempt();
    expect(at!).toBeGreaterThanOrEqual(NOW);
    expect(at!).toBeLessThan(NOW + THIRTY_MIN);
  });

  it('la cita sobrevive al cierre de la app: no se re-sortea si todavía no venció', async () => {
    setLastUpload(NOW - FIVE_HOURS);
    const scheduled = NOW + 10 * 60 * 1000;
    localStorage.setItem(NEXT_ATTEMPT_KEY, String(scheduled));

    await scheduler.tick(NOW);

    expect(nextAttempt()).toBe(scheduled);
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it('durante un examen no sube ni agenda', async () => {
    setLastUpload(NOW - FIVE_HOURS);
    localStorage.setItem(NEXT_ATTEMPT_KEY, String(NOW - 1000));
    examActivity.markStarted();

    await scheduler.tick(NOW);

    expect(uploadSpy).not.toHaveBeenCalled();
    // La cita queda intacta: al terminar el examen se retoma.
    expect(nextAttempt()).toBe(NOW - 1000);
  });

  it('terminado el examen vuelve a subir', async () => {
    setLastUpload(NOW - FIVE_HOURS);
    localStorage.setItem(NEXT_ATTEMPT_KEY, String(NOW - 1000));
    examActivity.markStarted();
    await scheduler.tick(NOW);
    expect(uploadSpy).not.toHaveBeenCalled();

    examActivity.markEnded();
    await scheduler.tick(NOW);

    expect(uploadSpy).toHaveBeenCalledTimes(1);
  });

  it('flushNow sube sin importar la cita — es lo que usa el botón de Soporte', async () => {
    setLastUpload(NOW - 60_000);
    localStorage.setItem(NEXT_ATTEMPT_KEY, String(NOW + THIRTY_MIN));

    await scheduler.flushNow(NOW);

    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect(nextAttempt()).toBeNull();
  });

  describe('flush al ocultarse la app', () => {
    function hide(): void {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    }

    it('sube si ya estaba vencido', async () => {
      setLastUpload(Date.now() - FIVE_HOURS - 1000);
      scheduler.start();
      uploadSpy.mockClear();

      hide();
      await new Promise((r) => setTimeout(r, 20));

      expect(uploadSpy).toHaveBeenCalled();
    });

    it('NO sube si todavía no vencía — ocultar la app pasa todo el tiempo', async () => {
      setLastUpload(Date.now());
      scheduler.start();
      uploadSpy.mockClear();

      hide();
      await new Promise((r) => setTimeout(r, 20));

      expect(uploadSpy).not.toHaveBeenCalled();
    });

    it('NO sube durante un examen', async () => {
      setLastUpload(Date.now() - FIVE_HOURS - 1000);
      scheduler.start();
      uploadSpy.mockClear();
      examActivity.markStarted();

      hide();
      await new Promise((r) => setTimeout(r, 20));

      expect(uploadSpy).not.toHaveBeenCalled();
    });
  });
});
