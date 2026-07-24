import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';

import { PwaUpdateService } from '../../../L3_periphery/pwa/pwa-update.service';
import { environment } from '../../../environments/environment';
import { UpdateConfirmModalComponent } from '../update-confirm-modal/update-confirm-modal.component';

// Footer de versión con doble rol:
//   1. Estado normal: muestra "Fiovi · versión X.Y.Z" — visible pero tenue,
//      útil para que soporte pregunte al alumno qué versión tiene.
//   2. Estado update pendiente (pwa.pendingUpdate().available === true):
//      agrega el link "→ X.Y.W disponible ↻" en azul primary. Tap abre el
//      UpdateConfirmModal para confirmar el reload.
//
// Este componente es el único mount del flujo de update en toda la app —
// vive en TODAS las pages (incluida /login) via <app-version-footer />, así
// que un usuario con bundle viejo puede actualizar antes de loguearse.
@Component({
  selector: 'app-version-footer',
  standalone: true,
  imports: [UpdateConfirmModalComponent],
  templateUrl: './version-footer.component.html',
  styleUrl: './version-footer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VersionFooterComponent {
  private readonly pwa = inject(PwaUpdateService);

  readonly version = environment.appVersion;
  readonly pendingUpdate = this.pwa.pendingUpdate;
  readonly showConfirmModal = signal(false);

  onUpdateClick(): void {
    this.showConfirmModal.set(true);
  }

  onModalCancel(): void {
    this.showConfirmModal.set(false);
  }

  onModalConfirm(): void {
    // El reload reinicia el contexto; no resetear showConfirmModal.
    void this.pwa.applyUpdate();
  }
}
