import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BrowserSessionRefreshScheduler } from '../../../../src/L3_periphery/session/browser-session-refresh-scheduler';

// El scheduler agenda con lead time 60s (constante privada del adapter). Los
// tests usan fake timers de vitest para avanzar el reloj sin dormir de verdad
// y validar el efecto observable (cuando dispara / no dispara el handler),
// sin acoplar el spec al valor exacto del lead time.
const NOW = 1_700_000_000_000;

describe('BrowserSessionRefreshScheduler', () => {
  let scheduler: BrowserSessionRefreshScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    scheduler = new BrowserSessionRefreshScheduler();
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
});
