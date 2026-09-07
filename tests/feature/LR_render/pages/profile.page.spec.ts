// Feature tests del item "Soporte" del perfil y del gate de "Descargar logs".
//
// Soporte es la salida manual para cuando el alumno reclama y sus logs de las
// últimas horas todavía no salieron por el ciclo normal. Lo que se protege
// acá: que confirme antes de mandar, que no se pueda spamear, y que
// "Descargar logs" —que baja el archivo crudo— no llegue nunca a producción.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Component } from '@angular/core';
import { ProfilePage } from '../../../../src/LR_render/pages/profile/profile.page';
import { GetIdentityUseCase } from '../../../../src/L2_application/use-cases/get-identity.use-case';
import { GetProfileUseCase } from '../../../../src/L2_application/use-cases/get-profile.use-case';
import { LogoutUseCase } from '../../../../src/L2_application/use-cases/logout.use-case';
import { PwaUpdateService } from '../../../../src/L3_periphery/pwa/pwa-update.service';
import { AuditLogSerializer } from '../../../../src/L3_periphery/telemetry/audit-log-serializer';
import { AuditLogUploadScheduler } from '../../../../src/L3_periphery/telemetry/audit-log-upload-scheduler.service';
import { environment } from '../../../../src/environments/environment';

const SUPPORT_LAST_SENT_KEY = 'fiovi-support-last-sent-at';

@Component({ template: '' })
class BlankComponent {}

describe('ProfilePage — Soporte', () => {
  let flushSpy: ReturnType<typeof vi.fn>;

  function createPage(): ProfilePage {
    return TestBed.createComponent(ProfilePage).componentInstance;
  }

  beforeEach(() => {
    localStorage.clear();
    flushSpy = vi.fn().mockResolvedValue(undefined);

    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', component: BlankComponent }]),
        { provide: GetIdentityUseCase, useValue: { execute: vi.fn().mockResolvedValue(null) } },
        { provide: GetProfileUseCase, useValue: { execute: vi.fn().mockResolvedValue(null) } },
        { provide: LogoutUseCase, useValue: { execute: vi.fn().mockResolvedValue(undefined) } },
        {
          provide: PwaUpdateService,
          useValue: {
            pendingUpdate: () => ({ available: false, fromVersion: '', toVersion: '' }),
            checkForUpdate: vi.fn(),
            applyUpdate: vi.fn(),
            start: vi.fn(),
          },
        },
        {
          provide: AuditLogSerializer,
          useValue: { downloadCurrentDay: vi.fn().mockResolvedValue(undefined) },
        },
        { provide: AuditLogUploadScheduler, useValue: { flushNow: flushSpy } },
      ],
    });
  });

  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('el botón abre el modal y no manda nada por sí solo', () => {
    const page = createPage() as unknown as {
      onSoporteClick(): void;
      showSupportModal(): boolean;
    };

    page.onSoporteClick();

    expect(page.showSupportModal()).toBe(true);
    expect(flushSpy).not.toHaveBeenCalled();
  });

  it('confirmar envía y cierra el modal', async () => {
    const page = createPage() as unknown as {
      onSoporteClick(): void;
      onSupportModalConfirm(): Promise<void>;
      showSupportModal(): boolean;
      supportState(): string;
    };

    page.onSoporteClick();
    await page.onSupportModalConfirm();

    expect(flushSpy).toHaveBeenCalledTimes(1);
    expect(page.showSupportModal()).toBe(false);
    expect(page.supportState()).toBe('sent');
  });

  it('cancelar cierra el modal sin enviar', () => {
    const page = createPage() as unknown as {
      onSoporteClick(): void;
      onSupportModalDismiss(): void;
      showSupportModal(): boolean;
    };

    page.onSoporteClick();
    page.onSupportModalDismiss();

    expect(page.showSupportModal()).toBe(false);
    expect(flushSpy).not.toHaveBeenCalled();
  });

  it('un fallo de envío se refleja en el estado y no rompe la pantalla', async () => {
    flushSpy.mockRejectedValue(new Error('sin red'));
    const page = createPage() as unknown as {
      onSupportModalConfirm(): Promise<void>;
      supportState(): string;
    };

    await page.onSupportModalConfirm();

    expect(page.supportState()).toBe('error');
  });

  describe('cooldown', () => {
    it('tras enviar, el modal muestra los minutos que faltan y no deja reenviar', async () => {
      const page = createPage() as unknown as {
        onSoporteClick(): void;
        onSupportModalConfirm(): Promise<void>;
        supportCooldownMinutes(): number;
      };

      await page.onSupportModalConfirm();
      expect(flushSpy).toHaveBeenCalledTimes(1);

      // Reabre: ahora el modal viene con la espera puesta.
      page.onSoporteClick();
      expect(page.supportCooldownMinutes()).toBeGreaterThan(0);

      await page.onSupportModalConfirm();
      expect(flushSpy).toHaveBeenCalledTimes(1); // no se mandó de nuevo
    });

    it('el cooldown sobrevive a salir y volver a entrar a la pantalla', () => {
      localStorage.setItem(SUPPORT_LAST_SENT_KEY, String(Date.now() - 60_000));
      const page = createPage() as unknown as {
        onSoporteClick(): void;
        supportCooldownMinutes(): number;
      };

      page.onSoporteClick();

      // 10 min de espera, pasó 1 → quedan ~9.
      expect(page.supportCooldownMinutes()).toBe(9);
    });

    it('una marca en el futuro no traba el botón para siempre', () => {
      // Reloj del dispositivo movido hacia atrás.
      localStorage.setItem(SUPPORT_LAST_SENT_KEY, String(Date.now() + 60 * 60 * 1000));
      const page = createPage() as unknown as {
        onSoporteClick(): void;
        supportCooldownMinutes(): number;
      };

      page.onSoporteClick();

      expect(page.supportCooldownMinutes()).toBe(0);
    });
  });

  it('"Descargar logs" no se muestra en un build de producción', () => {
    // Se gatea contra `production` y no contra `devTools` porque `devTools`
    // sale del .env de la VM de prod, que desde el repo no se puede verificar.
    const page = createPage() as unknown as { showDownloadLogs: boolean };
    expect(page.showDownloadLogs).toBe(!environment.production);
  });
});
