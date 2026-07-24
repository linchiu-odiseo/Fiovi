import { Component, DestroyRef, inject, signal } from '@angular/core';
import { CONNECTIVITY } from '../../../app.config';

// Badge persistente en la esquina superior derecha del shell que refleja
// el estado del puerto Connectivity. Verde "online" / rojo "offline"
// (lowercase inglés, chip mini — se comporta como sensor de estado, no
// como etiqueta). El texto accesible sigue siendo español ("Estado de
// conexión: en línea / sin conexión") vía aria-label.
// La suscripción al puerto se cancela vía DestroyRef cuando el componente
// se destruye (típicamente al navegar a /login donde el badge no se monta).
@Component({
  selector: 'app-connectivity-badge',
  templateUrl: './connectivity-badge.component.html',
  styleUrl: './connectivity-badge.component.scss',
})
export class ConnectivityBadgeComponent {
  private readonly connectivity = inject(CONNECTIVITY);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly isOnline = signal(this.connectivity.current());

  constructor() {
    const unsubscribe = this.connectivity.subscribe((next) => this.isOnline.set(next));
    this.destroyRef.onDestroy(unsubscribe);
  }
}
