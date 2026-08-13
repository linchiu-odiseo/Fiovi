import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';

import {
  DecideInstallCardStateUseCase,
  InstallCardState,
} from '../../../L2_application/use-cases/decide-install-card-state.use-case';
import { BeforeInstallPromptAdapter } from '../../../L3_periphery/pwa/before-install-prompt.adapter';
import {
  InstallInstructionsMode,
  InstallInstructionsModalComponent,
} from '../install-instructions-modal/install-instructions-modal.component';

// Variante del card según el rol del user. El título es el mismo — el copy
// del hint cambia el "para qué" según el flujo:
//   - student: "Estarás a un paso de ingresar" (a rendir simulacros).
//   - tutor:   "Ten tus aulas siempre a mano" (monitorear del celu).
export type InstallAppCardVariant = 'student' | 'tutor';

// Card "Instala Fiovi como app" que se monta al final del `<section class="simulacros">`
// del /home. Comparte visual con las cards del listado (mismo padding, radius,
// border, strip lateral) pero con strip primary — se lee como "un item más"
// del listado, tentando al user a instalar sin bloquear ningún flujo.
//
// Filosofía "tentando siempre": el card queda visible mientras el user no
// haya instalado. No hay X para cerrar, no hay snooze temporal. Los únicos
// oculta-para-siempre son: standalone (ya abrió instalada), flag installed
// prendido (via evento `appinstalled`), o desktop. Ver
// `DecideInstallCardStateUseCase` para las reglas.
@Component({
  selector: 'app-install-app-card',
  standalone: true,
  imports: [InstallInstructionsModalComponent],
  templateUrl: './install-app-card.component.html',
  styleUrl: './install-app-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InstallAppCardComponent {
  readonly variant = input<InstallAppCardVariant>('student');

  private readonly useCase = inject(DecideInstallCardStateUseCase);
  private readonly native = inject(BeforeInstallPromptAdapter);

  // Contador de "revisiones" — el único side-effect que puede cambiar el
  // resultado del use case tras un click (tocar el card nativo) bumpea
  // este signal y fuerza re-eval del `cardState` computed.
  private readonly revision = signal(0);

  protected readonly cardState = computed<InstallCardState>(() => {
    // Track: cuando el evento `beforeinstallprompt` llega, `native.available`
    // pasa de false a true → computed re-corre → el card puede pasar de
    // 'hidden' a 'nativePrompt' sin polling.
    this.native.available();
    this.revision();
    return this.useCase.execute();
  });

  protected readonly isVisible = computed(() => this.cardState().kind !== 'hidden');

  protected readonly hint = computed(() =>
    this.variant() === 'tutor' ? 'Ten tus aulas siempre a mano' : 'Estarás a un paso de ingresar',
  );

  protected readonly modalMode = signal<InstallInstructionsMode | null>(null);

  protected async onCardClick(): Promise<void> {
    const state = this.cardState();
    switch (state.kind) {
      case 'nativePrompt':
        await this.native.trigger();
        // Cualquier outcome (accepted/dismissed/unavailable) re-evalúa:
        //   - accepted → el evento `appinstalled` marcará el flag permanente
        //     via el adapter → próxima re-eval devuelve hidden.
        //   - dismissed → available flippa a false → próxima re-eval devuelve
        //     hidden hasta que Chromium re-emita `beforeinstallprompt` (lo
        //     hará por engagement heuristics).
        //   - unavailable → race raro; el card sigue apareciendo cuando
        //     available vuelva a true.
        this.revision.update((n) => n + 1);
        break;
      case 'iosInstructions':
      case 'iosOtherBrowser':
      case 'webviewFallback':
        this.modalMode.set(state.kind);
        break;
      case 'hidden':
        // Safety guard: el template no debería dispatch click cuando hidden.
        break;
    }
  }

  protected onModalClose(): void {
    this.modalMode.set(null);
  }
}
