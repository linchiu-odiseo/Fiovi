import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { GetIdentityUseCase } from '../../L2_application/use-cases/get-identity.use-case';
import { RefreshIdentityUseCase } from '../../L2_application/use-cases/refresh-identity.use-case';

// Bloquea el acceso a rutas marcadas si no hay identity activa.
// Si la identity está expirada o ausente, intenta renovarla via POST /auth/refresh
// antes de redirigir — evita kick a /login cuando la refresh-cookie sigue viva.
export const authGuard: CanActivateFn = async () => {
  const getIdentity = inject(GetIdentityUseCase);
  const refresh = inject(RefreshIdentityUseCase);
  const router = inject(Router);
  const identity = await getIdentity.execute();
  if (identity) return true;
  try {
    await refresh.execute();
    return true;
  } catch {
    return router.parseUrl('/login');
  }
};
