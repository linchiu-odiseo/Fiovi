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

// Default al abrir /demo-sheet. Se puede cambiar en vivo con el selector de
// preguntas del propio page (pills 4/8/12/15/25/50/100) para probar cómo se
// comporta la cartilla y el modal de confirmación con distintos volúmenes.
const DEMO_QUESTION_COUNT_DEFAULT = 8;

// Presets del selector. Cambia la cantidad de preguntas y resetea marcaciones
// al nuevo tamaño (más simple que preservar; el demo no persiste igual).
export const DEMO_QUESTION_COUNT_PRESETS: readonly number[] = [4, 8, 12, 15, 25, 50, 100];
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

  // Cantidad de preguntas variable. Cambiar via `cambiarPreguntasCount()`
  // resetea las marcaciones (más simple que preservar y padear/truncar).
  readonly preguntasCount = signal<number>(DEMO_QUESTION_COUNT_DEFAULT);
  readonly preguntas: Signal<readonly number[]> = computed(() =>
    Array.from({ length: this.preguntasCount() }, (_, i) => i + 1),
  );
  readonly marcaciones = signal<AnswersMap>(this.emptyAnswersMap());
  readonly admissionArea = signal<AdmissionArea>(DEFAULT_ADMISSION_AREA);
  readonly editingRow = signal<number | null>(null);
  readonly isSubmitting = signal(false);
  readonly submissionState = signal<DemoSubmissionState>('idle');
  readonly lastAck = signal<SubmissionAck | null>(null);

  // Modal de revisión previa al submit. `true` mientras el alumno está
  // decidiendo si envía o vuelve. `confirmarEnvio()` cierra este signal y
  // dispara `submit()`; `cancelarConfirmacion()` solo lo cierra.
  readonly confirmarEnvioAbierto = signal<boolean>(false);

  // Filtro visual del botón cíclico `todas → marcadas → blancos`. NO afecta
  // el submit — solo la grilla renderizada. `preguntasVisibles` deriva de acá
  // y de las marcaciones actuales.
  readonly filtroPreguntas = signal<'todas' | 'marcadas' | 'blancos'>('todas');

  readonly marcadasCount = computed(() => {
    const map = this.marcaciones();
    let n = 0;
    for (const v of Object.values(map)) {
      if (v !== null) n++;
    }
    return n;
  });

  readonly blancosCount = computed(() => this.preguntasCount() - this.marcadasCount());

  // Preguntas efectivamente renderizadas en la grilla según el filtro. En
  // 'todas' devuelve el array completo; en 'marcadas' / 'blancos' filtra.
  // Signal derivado — recompone cuando cambia marcaciones o el filtro.
  readonly preguntasVisibles: Signal<readonly number[]> = computed(() => {
    const filtro = this.filtroPreguntas();
    const all = this.preguntas();
    if (filtro === 'todas') return all;
    const map = this.marcaciones();
    if (filtro === 'marcadas') {
      return all.filter((p) => map[String(p)] !== null);
    }
    return all.filter((p) => map[String(p)] === null);
  });

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

  // True mientras el demo no haya vencido. Aplica el mismo blink al reloj
  // que el simulacro real, en cualquier formato ("N min" o "MM:SS"). Espejo
  // de `countdownUrgente` en el simulacro real.
  readonly countdownUrgente: Signal<boolean> = computed(() => {
    return this.closeAt.getTime() - this.nowTick().getTime() > 0;
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

  // Abre el modal de revisión. Antes existía un `submit()` directo desde el
  // click del botón "Enviar"; ahora ese click abre este modal y el submit
  // real se dispara solo si el alumno confirma con "Enviar y terminar".
  // Guards duplican los de `submit()` para no mostrar el modal si ya se
  // envió o si el tiempo se cumplió.
  pedirConfirmacion(): void {
    if (this.stopped) return;
    if (this.isSubmitting()) return;
    if (this.lastAck() !== null) return;
    if (this.examenTiempoCumplido()) return;
    this.confirmarEnvioAbierto.set(true);
  }

  cancelarConfirmacion(): void {
    this.confirmarEnvioAbierto.set(false);
  }

  // Simula un envío: `isSubmitting` en true, delay ~400ms, produce un
  // SubmissionAck falso con id, hash y timestamp inventados. El modal de
  // recibo (mismo componente que usa la cartilla real) se dispara con
  // `lastAck`. `onReceiptClose()` limpia y navega a /home.
  //
  // Solo se llama desde `pedirConfirmacion()` + confirmación del modal.
  // No hay call site directo desde el template.
  async submit(): Promise<void> {
    if (this.isSubmitting()) return;
    if (this.examenTiempoCumplido()) return;
    this.confirmarEnvioAbierto.set(false);
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

  // DEV: cambia el volumen de preguntas y resetea la cartilla al nuevo tamaño.
  // Ignora valores no positivos por defensa. No-op si el count ya coincide para
  // evitar wipe innecesario cuando el usuario re-clickea el mismo pill.
  //
  // Reset del filtro a 'todas' — en cartillas nuevas (o cortas) no tiene sentido
  // arrastrar el filtro anterior.
  cambiarPreguntasCount(n: number): void {
    if (this.stopped) return;
    if (!Number.isInteger(n) || n <= 0) return;
    if (this.preguntasCount() === n) return;
    this.preguntasCount.set(n);
    this.marcaciones.set(this.emptyAnswersMap());
    this.filtroPreguntas.set('todas');
    this.exitEditing();
  }

  cambiarFiltro(filtro: 'todas' | 'marcadas' | 'blancos'): void {
    if (this.stopped) return;
    this.filtroPreguntas.set(filtro);
  }

  private emptyAnswersMap(): AnswersMap {
    const map: AnswersMap = {};
    const count = this.preguntasCount();
    for (let i = 1; i <= count; i++) {
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
    return `${mins} min`;
  }
  const totalSeconds = Math.ceil(ms / 1_000);
  const mm = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const ss = (totalSeconds % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}
