import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { VersionFooterComponent } from '../../../components/version-footer/version-footer.component';
import { SelectTenantViewModel } from '../../../view-models/select-tenant.view-model';

@Component({
  selector: 'app-select-tenant-page',
  imports: [VersionFooterComponent],
  templateUrl: './select-tenant.page.html',
  styleUrl: './select-tenant.page.scss',
  providers: [SelectTenantViewModel],
})
export class SelectTenantPage implements OnInit {
  private readonly router = inject(Router);
  protected readonly vm = inject(SelectTenantViewModel);

  ngOnInit(): void {
    // Si no hay challenge válido en sessionStorage (URL directa sin flow
    // previo, TTL expirado, o session limpiada), volvemos a /login. El
    // banner con el motivo ya lo setea el vm.hydrate() cuando aplica.
    const hasChallenge = this.vm.hydrate();
    if (!hasChallenge) {
      void this.router.navigate(['/login']);
    }
  }

  protected onChoose(slug: string): void {
    void this.vm.choose(slug);
  }

  protected onCancel(): void {
    void this.vm.cancel();
  }
}
