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
    // Segunda mitad del flow cuando el email matchea >1 tenant (post-login
    // password o post-callback SSO Google). El publicOnlyGuard lo protege:
    // si el user ya tiene identity, se envía directo al home del rol.
    // El page se auto-redirige a /login si no hay challenge pendiente en
    // sessionStorage.
    path: 'login/select-tenant',
    canActivate: [publicOnlyGuard],
    loadComponent: () =>
      import('./pages/login/select-tenant/select-tenant.page').then((m) => m.SelectTenantPage),
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
    path: 'student/tareas',
    canActivate: [authGuard, roleGuard('student')],
    loadComponent: () =>
      import('./pages/student-tasks-list/student-tasks-list.page').then(
        (m) => m.StudentTasksListPage,
      ),
  },
  {
    path: 'student/historial',
    canActivate: [authGuard, roleGuard('student')],
    loadComponent: () =>
      import('./pages/student-historial-list/student-historial-list.page').then(
        (m) => m.StudentHistorialListPage,
      ),
  },
  {
    path: 'student/historial/:examId',
    canActivate: [authGuard, roleGuard('student')],
    loadComponent: () =>
      import('./pages/student-historial-detail/student-historial-detail.page').then(
        (m) => m.StudentHistorialDetailPage,
      ),
  },
  {
    path: 'tutor/home',
    canActivate: [authGuard, roleGuard('tutor')],
    loadComponent: () =>
      import('./pages/tutor-exams-list/tutor-exams-list.page').then((m) => m.TutorExamsListPage),
  },
  {
    path: 'tutor/tareas',
    canActivate: [authGuard, roleGuard('tutor')],
    loadComponent: () =>
      import('./pages/tutor-tasks-list/tutor-tasks-list.page').then(
        (m) => m.TutorTasksListPage,
      ),
  },
  // Nav mobile AULA → SEMANA → CURSO → EXÁMENES (change tutor-aulas-semanas-view).
  // La ruta legacy `/tutor/aulas/:classroomId` (que apuntaba a la lista plana de
  // cursos) redirige a la nueva vista de semanas — deep-links viejos siguen
  // funcionando sin 404.
  {
    path: 'tutor/aulas/:classroomId',
    pathMatch: 'full',
    redirectTo: 'tutor/aulas/:classroomId/semanas',
  },
  {
    path: 'tutor/aulas/:classroomId/semanas',
    canActivate: [authGuard, roleGuard('tutor')],
    loadComponent: () =>
      import('./pages/tutor-aula-semanas/tutor-aula-semanas.page').then(
        (m) => m.TutorAulaSemanasPage,
      ),
  },
  {
    path: 'tutor/aulas/:classroomId/semanas/:periodId',
    canActivate: [authGuard, roleGuard('tutor')],
    loadComponent: () =>
      import('./pages/tutor-aula-semana-examenes/tutor-aula-semana-examenes.page').then(
        (m) => m.TutorAulaSemanaExamenesPage,
      ),
  },
  {
    path: 'tutor/exams/:recordId',
    canActivate: [authGuard, roleGuard('tutor')],
    loadComponent: () =>
      import('./pages/tutor-exam-detail/tutor-exam-detail.page').then((m) => m.TutorExamDetailPage),
  },
  // Perfil compartido entre student y tutor. No usa roleGuard porque ambos roles
  // caen en la misma placeholder page (los datos del perfil aún no se muestran
  // acá; ver `pages/profile/profile.page.ts`). Solo authGuard.
  {
    path: 'profile',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/profile/profile.page').then((m) => m.ProfilePage),
  },
  // Ruta dev-only: cartilla mock 100% en memoria, sin back ni auth. La visibilidad
  // del atajo desde /home está gated por `environment.devTools`; la ruta en sí no
  // tiene guard porque también sirve como demo pública si se comparte el link.
  {
    path: 'demo-sheet',
    loadComponent: () => import('./pages/demo-sheet/demo-sheet.page').then((m) => m.DemoSheetPage),
  },
  // Redirects legacy para bookmarks / instalaciones PWA existentes.
  { path: 'home', pathMatch: 'full', redirectTo: '/student/home' },
  { path: 'simulacro/:id', redirectTo: '/student/simulacro/:id' },
  { path: '**', redirectTo: '/login' },
];
