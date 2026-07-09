import { Routes } from '@angular/router';
import { authGuard } from '../L3_periphery/guards/auth.guard';
import { publicOnlyGuard } from '../L3_periphery/guards/public-only.guard';
import { roleGuard } from '../L3_periphery/guards/role.guard';

// Routing namespaced por rol. Cada subtree (`/student/*`, `/tutor/*`) está
// protegido por la cadena `authGuard + roleGuard(role)`:
//   1. authGuard verifica que haya identity activa.
//   2. roleGuard verifica que el rol corresponda; si no, redirige al home
//      del rol REAL (no a /login).
//
// Rutas legacy (`/home`, `/simulacro/:id`) redirigen a sus equivalentes
// con prefijo `/student/*`. Si el user es tutor, el roleGuard('student')
// del destino rebota a `/tutor/home` — comportamiento esperado.
//
// La raíz `''` redirige a `/login` por simplicidad. El AppInitializer
// navega ANTES del primer render si hay identity válida (a `/{role}/home`),
// así que en la práctica el user nunca ve `/login` si ya está logueado.
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: '/login' },
  {
    path: 'login',
    canActivate: [publicOnlyGuard],
    loadComponent: () => import('./pages/login/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'student/home',
    canActivate: [authGuard, roleGuard('student')],
    loadComponent: () => import('./pages/home/home.page').then((m) => m.HomePage),
  },
  {
    path: 'student/simulacro/:id',
    canActivate: [authGuard, roleGuard('student')],
    loadComponent: () => import('./pages/simulacro/simulacro.page').then((m) => m.SimulacroPage),
  },
  {
    path: 'tutor/home',
    canActivate: [authGuard, roleGuard('tutor')],
    loadComponent: () =>
      import('./pages/tutor-exams-list/tutor-exams-list.page').then((m) => m.TutorExamsListPage),
  },
  {
    path: 'tutor/exams/:recordId',
    canActivate: [authGuard, roleGuard('tutor')],
    loadComponent: () =>
      import('./pages/tutor-exam-detail/tutor-exam-detail.page').then(
        (m) => m.TutorExamDetailPage,
      ),
  },
  // Ruta dev-only: cartilla mock 100% en memoria, sin back ni auth. La visibilidad
  // del atajo desde /home está gated por `environment.devTools`; la ruta en sí no
  // tiene guard porque también sirve como demo pública si se comparte el link.
  {
    path: 'demo-sheet',
    loadComponent: () =>
      import('./pages/demo-sheet/demo-sheet.page').then((m) => m.DemoSheetPage),
  },
  // Redirects legacy para bookmarks / instalaciones PWA existentes.
  { path: 'home', pathMatch: 'full', redirectTo: '/student/home' },
  { path: 'simulacro/:id', redirectTo: '/student/simulacro/:id' },
  { path: '**', redirectTo: '/login' },
];
