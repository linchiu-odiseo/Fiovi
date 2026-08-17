import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AlternativaValue, AnswersMap } from '../../L1_domain/ports/markings-storage';
import {
  AdmissionArea,
  DEFAULT_ADMISSION_AREA,
} from '../../L1_domain/value-objects/admission-area';
import { SubmissionAck } from '../../L1_domain/value-objects/submission-ack';
import { secureRandomFloat } from '../utils/secure-random';

// View-model de /demo-sheet: cartilla mock 100% en memoria para probar la UX
// sin depender del back. No usa MarcarRespuestaUseCase, no toca IndexedDB, no
// llama a EnviarSimulacroUseCase. Todo el flujo (marcar, dado, submit, recibo,
// countdown, área) se resuelve local.
//
// Nada de este view-model debería importarse desde código de producción real:
// existe únicamente para poblar la ruta dev-only `/demo-sheet`.

const DEMO_QUESTION_COUNT = 8;
const DEMO_DURATION_MS = 3 * 60_000; // 3 minutos
const COUNTDOWN_TICK_MS = 1_000;
const SHOW_SECONDS_BELOW_MS = 5 * 60_000;
const FAKE_SUBMIT_DELAY_MS = 400;
const EDITING_AUTO_LOCK_MS = 5_000;

// Curso/área ficticio del header. Refleja lo que muestra la cartilla real
// cuando el back devuelve `Exam.course` (ej. "Matemáticas · Ciencias").
const DEMO_EXAM_COURSE = 'Matemáticas · Demo';
const DEMO_EXAM_NAME = 'Simulacro CEPRE · Demo';

// Mismo estado por fila que el simulacro real, para que la UX del long-press
// (marcar → locked → editing → cambio) se sienta idéntica.
export type DemoRowState = 'unmarked' | 'locked' | 'editing';
export type DemoSubmissionState = 'idle' | 'sending' | 'sent';

@Injectable()
export class DemoSheetViewModel {
  private readonly router = inject(Router);

  readonly examCourse = signal(DEMO_EXAM_COURSE);
  readonly examName = signal(DEMO_EXAM_NAME);
  readonly preguntas: Signal<readonly number[]> = signal(
    Array.from({ length: DEMO_QUESTION_COUNT }, (_, i) => i + 1),
  );
  readonly marcaciones = signal<AnswersMap>(this.emptyAnswersMap());
  readonly admissionArea = signal<AdmissionArea>(DEFAULT_ADMISSION_AREA);
  readonly editingRow = signal<number | null>(null);
  readonly isSubmitting = signal(false);
  readonly submissionState = signal<DemoSubmissionState>('idle');
  readonly lastAck = signal<SubmissionAck | null>(null);

  // Ticker que refresca cada segundo para que el countdown recompute.
  readonly nowTick = signal<Date>(new Date());
  private readonly startedAt = new Date();
  private readonly closeAt = new Date(this.startedAt.getTime() + DEMO_DURATION_MS);

  // El examen ya venció cuando el reloj cruzó `closeAt`. Deshabilita marcado
  // y grisa la grilla — igual que `examenTiempoCumplido` en el real.
  readonly examenTiempoCumplido: Signal<boolean> = computed(
    () => this.nowTick().getTime() >= this.closeAt.getTime(),
  );

  readonly vigente: Signal<boolean> = computed(() => !this.examenTiempoCumplido());

  // "MM:SS" mientras quedan menos de 5 min (el demo entero está bajo el umbral).
  readonly countdownRestante: Signal<string> = computed(() => {
    const remainingMs = Math.max(0, this.closeAt.getTime() - this.nowTick().getTime());
    return formatRestante(remainingMs);
  });

  readonly cierreHHMM: Signal<string> = computed(() => formatHHMM(this.closeAt));

  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private editingTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor() {
    this.startCountdownTicker();
  }

  rowState(pregunta: number): DemoRowState {
    if (this.editingRow() === pregunta) return 'editing';
    const marca = this.marcaciones()[String(pregunta)] ?? null;
    return marca === null ? 'unmarked' : 'locked';
  }

  // Entra a modo edición (long-press del real). Solo aplica si la fila está
  // `locked` — la protección contra cambios accidentales se preserva en la
  // demo para que el gesto se sienta idéntico.
  enterEditing(pregunta: number): void {
    if (this.stopped) return;
    if (this.rowState(pregunta) !== 'locked') return;
    this.cancelEditingTimer();
    this.editingRow.set(pregunta);
    this.editingTimer = setTimeout(() => {
      this.editingTimer = null;
      if (this.editingRow() === pregunta) {
        this.editingRow.set(null);
      }
    }, EDITING_AUTO_LOCK_MS);
  }

  exitEditing(): void {
    this.cancelEditingTimer();
    this.editingRow.set(null);
  }

  // Marca/desmarca respetando la misma máquina de estado que el real:
  //   unmarked → letra:      marca (queda locked)
  //   editing  → letra igual: desmarca (queda unmarked)
  //   editing  → letra dist.: cambia (queda locked)
  //   locked   → no-op
  marcar(pregunta: number, letra: AlternativaValue): void {
    if (this.stopped) return;
    if (!this.vigente()) return;
    const state = this.rowState(pregunta);
    if (state === 'locked') return;
    const actual = this.marcaciones()[String(pregunta)] ?? null;
    const proxima: AlternativaValue = actual === letra ? null : letra;
    this.marcaciones.update((prev) => ({ ...prev, [String(pregunta)]: proxima }));
    this.exitEditing();
  }

  // Sobreescribe todo con opciones {A,B,C,D,E,vacío} uniforme. Espejo del
  // método homónimo del real, pero sin persistir a IDB.
  marcarAleatorio(): void {
    if (this.stopped) return;
    if (!this.vigente()) return;
    const opciones: readonly AlternativaValue[] = ['A', 'B', 'C', 'D', 'E', null];
    const nuevoMap: AnswersMap = {};
    for (const pregunta of this.preguntas()) {
      const proxima = opciones[Math.floor(secureRandomFloat() * opciones.length)] ?? null;
      nuevoMap[String(pregunta)] = proxima;
    }
    this.marcaciones.set(nuevoMap);
    this.exitEditing();
  }

  seleccionarArea(area: AdmissionArea): void {
    if (this.stopped) return;
    this.admissionArea.set(area);
  }

  // Simula un envío: `isSubmitting` en true, delay ~400ms, produce un
  // SubmissionAck falso con id, hash y timestamp inventados. El modal de
  // recibo (mismo componente que usa la cartilla real) se dispara con
  // `lastAck`. `onReceiptClose()` limpia y navega a /home.
  async submit(): Promise<void> {
    if (this.isSubmitting()) return;
    if (this.examenTiempoCumplido()) return;
    this.isSubmitting.set(true);
    this.submissionState.set('sending');
    await new Promise((resolve) => setTimeout(resolve, FAKE_SUBMIT_DELAY_MS));
    if (this.stopped) {
      this.isSubmitting.set(false);
      return;
    }
    const ack = new SubmissionAck(fakeId(), fakeHex64(), new Date());
    this.lastAck.set(ack);
    this.submissionState.set('sent');
    this.isSubmitting.set(false);
  }

  onReceiptClose(): void {
    this.lastAck.set(null);
    void this.router.navigate(['/home']);
  }

  volver(): void {
    void this.router.navigate(['/home']);
  }

  stop(): void {
    this.stopped = true;
    this.stopCountdownTicker();
    this.cancelEditingTimer();
    this.editingRow.set(null);
  }

  private startCountdownTicker(): void {
    if (this.countdownTimer !== null) return;
    this.countdownTimer = setInterval(() => {
      if (this.stopped) return;
      this.nowTick.set(new Date());
    }, COUNTDOWN_TICK_MS);
  }

  private stopCountdownTicker(): void {
    if (this.countdownTimer !== null) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  private cancelEditingTimer(): void {
    if (this.editingTimer !== null) {
      clearTimeout(this.editingTimer);
      this.editingTimer = null;
    }
  }

  private emptyAnswersMap(): AnswersMap {
    const map: AnswersMap = {};
    for (let i = 1; i <= DEMO_QUESTION_COUNT; i++) {
      map[String(i)] = null;
    }
    return map;
  }
}

function fakeId(): string {
  return `demo-${Date.now().toString(36)}-${Math.floor(secureRandomFloat() * 1e6).toString(36)}`;
}

// 64 chars hex random. No es sha256 real, pero cumple el shape que valida
// `SubmissionAck` y el que espera `formatHashBlock` del receipt modal — el
// bloque se ve idéntico al real.
function fakeHex64(): string {
  const chars = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 64; i++) {
    out += chars[Math.floor(secureRandomFloat() * 16)];
  }
  return out;
}

function formatHHMM(d: Date): string {
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

// Espejo del `formatRestante` del real, condensado. Para el demo la duración
// entera son 3 min, así que siempre caemos en el formato "MM:SS".
function formatRestante(ms: number): string {
  if (ms <= 0) return '00:00';
  if (ms >= SHOW_SECONDS_BELOW_MS) {
    const mins = Math.ceil(ms / 60_000);
    return `${mins} min restantes`;
  }
  const totalSeconds = Math.ceil(ms / 1_000);
  const mm = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const ss = (totalSeconds % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}
