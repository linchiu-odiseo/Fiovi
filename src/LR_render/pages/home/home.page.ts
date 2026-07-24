import { Component, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { VersionFooterComponent } from '../../components/version-footer/version-footer.component';
import { HomePageViewModel, SimulacroCard } from '../../view-models/home.view-model';

// Threshold de pull-to-refresh: el alumno debe arrastrar al menos 80px hacia
// abajo desde scrollTop=0 antes de disparar el refresh. Lo dejamos hardcoded —
// si se vuelve mood-sensitive lo subimos a constante de config.
const PULL_THRESHOLD_PX = 80;
const PULL_MAX_VISUAL_PX = 120;

@Component({
  selector: 'app-home-page',
  templateUrl: './home.page.html',
  styleUrl: './home.page.scss',
  imports: [VersionFooterComponent],
  providers: [HomePageViewModel],
})
export class HomePage {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly vm = inject(HomePageViewModel);

  // Estado del pull-to-refresh — todo visual; el dispatch del refresh ocurre
  // en touchend cuando se cruza el threshold.
  protected readonly pullOffset = signal(0);
  protected readonly isPulling = signal(false);

  private readonly scrollContainer = viewChild<ElementRef<HTMLElement>>('scrollContainer');

  private touchStartY: number | null = null;
  private touchStartScrollTop = 0;

  constructor() {
    void this.vm.start();
    this.destroyRef.onDestroy(() => this.vm.stop());
  }

  protected onSimulacroClick(card: SimulacroCard): void {
    if (!card.clickable) return;
    if (this.vm.offlineStorageBlocked()) return;
    void this.router.navigate(['/simulacro', card.id]);
  }

  protected onProfileClick(): void {
    void this.router.navigate(['/profile']);
  }

  protected retry(): void {
    void this.vm.refresh();
  }

  protected onTouchStart(event: TouchEvent): void {
    const container = this.scrollContainer()?.nativeElement;
    const scrollTop = container?.scrollTop ?? 0;
    this.touchStartScrollTop = scrollTop;
    if (scrollTop > 0) {
      // Si no estamos en el tope, NO armamos el gesto: el scroll nativo gana.
      this.touchStartY = null;
      return;
    }
    this.touchStartY = event.touches[0]?.clientY ?? null;
  }

  protected onTouchMove(event: TouchEvent): void {
    if (this.touchStartY === null) return;
    if (this.vm.isLoading()) return;
    const currentY = event.touches[0]?.clientY ?? this.touchStartY;
    const delta = currentY - this.touchStartY;
    if (delta <= 0) {
      this.pullOffset.set(0);
      this.isPulling.set(false);
      return;
    }
    this.isPulling.set(true);
    // Damping: la primera mitad responde 1:1, después se siente con resistencia.
    const damped = Math.min(delta * 0.6, PULL_MAX_VISUAL_PX);
    this.pullOffset.set(damped);
  }

  protected onTouchEnd(): void {
    if (this.touchStartY === null) {
      this.resetPull();
      return;
    }
    const reachedThreshold = this.pullOffset() >= PULL_THRESHOLD_PX * 0.6;
    this.resetPull();
    if (reachedThreshold) {
      void this.vm.refresh();
    }
  }

  private resetPull(): void {
    this.touchStartY = null;
    this.touchStartScrollTop = 0;
    this.isPulling.set(false);
    this.pullOffset.set(0);
  }
}
