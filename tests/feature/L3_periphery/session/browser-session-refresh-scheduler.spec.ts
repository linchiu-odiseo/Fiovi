import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { BrowserSessionRefreshScheduler } from '../../../../src/L3_periphery/session/browser-session-refresh-scheduler';
import { CLOCK } from '../../../../src/app.config';
import { Clock } from '../../../../src/L1_domain/ports/clock';
import { ServerTime } from '../../../../src/L1_domain/value-objects/server-time';

// El scheduler agenda con lead time 60s (constante privada del adapter). Los
// tests usan fake timers de vitest para avanzar el reloj sin dormir de verdad
// y validar el efecto observable (cuando dispara / no dispara el handler),
// sin acoplar el spec al valor exacto del lead time.
const NOW = 1_700_000_000_000;

// Fake local del Clock: por defecto devuelve `new Date()` (respeta
// vi.setSystemTime), igual que FakeClock en tests/unit/L2_application/fakes.ts.
// Se define acá (no se importa de fakes.ts) porque ese archivo es L2-only y
// no depende de Angular; este spec es L3 y usa TestBed.
class FakeClock implements Clock {
  private currentServerTime: ServerTime | null = null;

  now(): Date {
    return this.currentServerTime ? this.currentServerTime.value : new Date();
  }

  setServerTime(serverTime: ServerTime): void {
    this.currentServerTime = serverTime;
  }
}

describe('BrowserSessionRefreshScheduler', () => {
  let scheduler: BrowserSessionRefreshScheduler;
  let clock: FakeClock;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    clock = new FakeClock();
    TestBed.configureTestingModule({
      providers: [{ provide: CLOCK, useValue: clock }],
    });
    scheduler = TestBed.runInInjectionContext(() => new BrowserSessionRefreshScheduler());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('schedule agenda el timer para (expiresAt - lead time) desde ahora', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    scheduler.setRefreshHandler(handler);
    // JWT vence en 15 min desde ahora — el timer debe dispararse en 14 min.
    scheduler.schedule(NOW + 15 * 60_000);

    vi.advanceTimersByTime(14 * 60_000 - 1);
    expect(handler).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2);
    // El handler es async — dejamos que las microtasks corran.
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('schedule dispara inmediato (delay=0) si el JWT ya esta dentro del lead time', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    scheduler.setRefreshHandler(handler);
    // JWT vence en 30s — dentro del lead de 60s. Debe agendar con delay 0.
    scheduler.schedule(NOW + 30_000);

    expect(handler).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('schedule dispara inmediato (delay=0) si el JWT ya expiro', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    scheduler.setRefreshHandler(handler);
    scheduler.schedule(NOW - 10_000);

    vi.advanceTimersByTime(0);
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('un segundo schedule cancela el timer anterior (no doble trigger)', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    scheduler.setRefreshHandler(handler);
    scheduler.schedule(NOW + 15 * 60_000);
    // Antes de que dispare, re-agendamos para 30 min desde ahora — cancela el
    // primero, agenda el nuevo.
    vi.advanceTimersByTime(10 * 60_000);
    scheduler.schedule(NOW + 30 * 60_000);

    // Avanzar hasta el momento en que HABRIA disparado el primero — no debe.
    vi.advanceTimersByTime(5 * 60_000);
    await Promise.resolve();
    expect(handler).not.toHaveBeenCalled();

    // Avanzar hasta el momento del segundo timer (29 min desde t=0).
    vi.advanceTimersByTime(14 * 60_000);
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('cancel elimina el timer pendiente', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    scheduler.setRefreshHandler(handler);
    scheduler.schedule(NOW + 15 * 60_000);
    scheduler.cancel();

    vi.advanceTimersByTime(20 * 60_000);
    await Promise.resolve();
    expect(handler).not.toHaveBeenCalled();
  });

  it('cancel es idempotente (llamar sin timer agendado no lanza)', () => {
    expect(() => scheduler.cancel()).not.toThrow();
    expect(() => {
      scheduler.cancel();
      scheduler.cancel();
    }).not.toThrow();
  });

  it('sin handler seteado, trigger no lanza (log warn silencioso)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    scheduler.schedule(NOW + 15 * 60_000);
    vi.advanceTimersByTime(15 * 60_000);
    await Promise.resolve();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('handler que lanza NO propaga (queda como log warn); scheduler sigue usable', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const handler = vi.fn().mockRejectedValue(new Error('refresh failed'));
    scheduler.setRefreshHandler(handler);
    scheduler.schedule(NOW + 15 * 60_000);

    vi.advanceTimersByTime(15 * 60_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();

    // Debe poder re-agendar despues del fallo.
    handler.mockReset().mockResolvedValue(undefined);
    scheduler.schedule(NOW + 30 * 60_000);
    vi.advanceTimersByTime(30 * 60_000);
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('schedule computa delayMs contra el Clock calibrado, no contra el Date.now() desviado', async () => {
    // El reloj local del dispositivo (system time) está adelantado 30 min
    // respecto del server. El Clock inyectado sí conoce la hora real del
    // server (calibrado).
    const serverNow = NOW;
    vi.setSystemTime(serverNow + 30 * 60_000);
    clock.setServerTime(new ServerTime(new Date(serverNow).toISOString()));

    const handler = vi.fn().mockResolvedValue(undefined);
    scheduler.setRefreshHandler(handler);
    // JWT vence en 15 min desde la hora del SERVER (no del device) — el
    // schedule debe anclarse a eso, no a Date.now() (que ya está 30 min
    // adelante y haría que el JWT parezca vencido hace rato).
    scheduler.schedule(serverNow + 15 * 60_000);

    // Contra clock.now() (=serverNow), el timer dispara en 14 min.
    vi.advanceTimersByTime(14 * 60_000 - 1);
    expect(handler).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2);
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
