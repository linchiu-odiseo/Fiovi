import { describe, it, expect } from 'vitest';
import type { Route } from '@angular/router';
import { routes } from '../../../src/LR_render/app.routes';
import { authGuard } from '../../../src/L3_periphery/guards/auth.guard';
import { publicOnlyGuard } from '../../../src/L3_periphery/guards/public-only.guard';
import { roleGuard } from '../../../src/L3_periphery/guards/role.guard';

// Tests del routing config. Verificamos shape estática (path + canActivate +
// redirectTo) sin renderizar componentes — el test del routing real con
// guards activados está cubierto en los specs de cada guard.
//
// El `roleGuard` es una factory (`roleGuard('student')` devuelve un
// CanActivateFn). Para identificar que un guard de la lista canActivate es
// "el roleGuard del rol X" comparamos por shape: el nombre `roleGuard` del
// factory output o el comportamiento. Acá hacemos comparación estructural:
// el guard generado por `roleGuard('student')` no es identity-equal al
// generado por otra invocación, así que verificamos por longitud/presencia.

function findRoute(path: string): Route | undefined {
  return routes.find((r) => r.path === path);
}

describe('app.routes', () => {
  describe('rutas públicas', () => {
    it('/login tiene publicOnlyGuard en canActivate', () => {
      const r = findRoute('login');
      expect(r).toBeDefined();
      expect(r?.canActivate).toContain(publicOnlyGuard);
    });

    it('/login NO tiene authGuard (es pública)', () => {
      const r = findRoute('login');
      expect(r?.canActivate).not.toContain(authGuard);
    });
  });

  describe('rutas de alumno con prefijo /student', () => {
    it('/student/home tiene authGuard como primer guard', () => {
      const r = findRoute('student/home');
      expect(r).toBeDefined();
      expect(r?.canActivate?.[0]).toBe(authGuard);
    });

    it('/student/home tiene dos guards: authGuard + roleGuard("student")', () => {
      const r = findRoute('student/home');
      // El segundo guard es el output del factory roleGuard('student').
      // Lo verificamos por presencia (no identidad) y por la cardinalidad.
      expect(r?.canActivate?.length).toBe(2);
      expect(r?.canActivate?.[0]).toBe(authGuard);
      expect(typeof r?.canActivate?.[1]).toBe('function');
    });

    it('/student/simulacro/:id tiene authGuard + roleGuard("student")', () => {
      const r = findRoute('student/simulacro/:id');
      expect(r).toBeDefined();
      expect(r?.canActivate?.length).toBe(2);
      expect(r?.canActivate?.[0]).toBe(authGuard);
      expect(typeof r?.canActivate?.[1]).toBe('function');
    });
  });

  describe('rutas de tutor con prefijo /tutor', () => {
    it('/tutor/home tiene authGuard + roleGuard("tutor")', () => {
      const r = findRoute('tutor/home');
      expect(r).toBeDefined();
      expect(r?.canActivate?.length).toBe(2);
      expect(r?.canActivate?.[0]).toBe(authGuard);
      expect(typeof r?.canActivate?.[1]).toBe('function');
    });

    it('/tutor/home carga TutorExamsListPage (lazy loadComponent existe)', async () => {
      const r = findRoute('tutor/home');
      expect(typeof r?.loadComponent).toBe('function');
      // Verificamos que la función lazy resuelve al componente correcto.
      // En el entorno de test, loadComponent() puede retornar la clase directamente
      // o un objeto con la clase. Inspeccionamos ambas posibilidades.
      const result = (await r!.loadComponent!()) as unknown;
      // Buscar recursivamente el nombre de clase en el resultado
      const resultName =
        (result as { name?: string })?.name ??
        (result as { default?: { name?: string } })?.default?.name ??
        '';
      expect(resultName).toContain('TutorExamsList');
    });

    it('/tutor/exams/:recordId existe en la configuración de rutas', () => {
      const r = findRoute('tutor/exams/:recordId');
      expect(r).toBeDefined();
    });

    it('/tutor/exams/:recordId tiene canActivate: [authGuard, roleGuard("tutor")]', () => {
      const r = findRoute('tutor/exams/:recordId');
      expect(r?.canActivate?.length).toBe(2);
      expect(r?.canActivate?.[0]).toBe(authGuard);
      expect(typeof r?.canActivate?.[1]).toBe('function');
    });

    it('/tutor/exams/:recordId tiene loadComponent (lazy)', () => {
      const r = findRoute('tutor/exams/:recordId');
      expect(typeof r?.loadComponent).toBe('function');
    });

    it('/tutor/exams/:recordId loadComponent resuelve TutorExamDetailPage (no el stub)', async () => {
      const r = findRoute('tutor/exams/:recordId');
      expect(typeof r?.loadComponent).toBe('function');
      const result = (await r!.loadComponent!()) as unknown;
      const resultName =
        (result as { name?: string })?.name ??
        (result as { default?: { name?: string } })?.default?.name ??
        '';
      expect(resultName).toContain('TutorExamDetail');
    });

    it('roleGuard("student") y roleGuard("tutor") son funciones distintas (factory genera instancia nueva por rol)', () => {
      const studentRoute = findRoute('student/home');
      const tutorRoute = findRoute('tutor/home');
      // Verificamos que sean dos guards diferentes (la factory roleGuard()
      // devuelve un closure nuevo por invocación).
      expect(studentRoute?.canActivate?.[1]).not.toBe(tutorRoute?.canActivate?.[1]);
      // Sanity check: producen un guard al ser invocadas independientemente.
      const newStudentGuard = roleGuard('student');
      expect(typeof newStudentGuard).toBe('function');
    });

    it('no existe componente placeholder para /tutor/home (loadComponent resuelve TutorExamsListPage)', async () => {
      // Tras el change, /tutor/home debe apuntar a TutorExamsListPage, NO al
      // placeholder TutorHomePage. Verificamos resolviendo la lazy function.
      const r = findRoute('tutor/home');
      expect(typeof r?.loadComponent).toBe('function');
      const result = (await r!.loadComponent!()) as unknown;
      const resultName =
        (result as { name?: string })?.name ??
        (result as { default?: { name?: string } })?.default?.name ??
        '';
      // Si apuntara al placeholder, el nombre sería TutorHomePage.
      expect(resultName).not.toContain('TutorHome');
    });
  });

  describe('Scenario: Rutas del alumno sin cambios', () => {
    it('/student/home sigue con authGuard + roleGuard("student") sin alteración', () => {
      const r = findRoute('student/home');
      expect(r).toBeDefined();
      expect(r?.canActivate?.length).toBe(2);
      expect(r?.canActivate?.[0]).toBe(authGuard);
      expect(typeof r?.canActivate?.[1]).toBe('function');
      expect(typeof r?.loadComponent).toBe('function');
    });

    it('/student/simulacro/:id sigue sin cambios', () => {
      const r = findRoute('student/simulacro/:id');
      expect(r).toBeDefined();
      expect(r?.canActivate?.length).toBe(2);
      expect(r?.canActivate?.[0]).toBe(authGuard);
      expect(typeof r?.canActivate?.[1]).toBe('function');
    });

    it('/login sigue con publicOnlyGuard', () => {
      const r = findRoute('login');
      expect(r?.canActivate).toContain(publicOnlyGuard);
    });
  });

  describe('redirects legacy y catch-all', () => {
    it('/home redirige a /student/home con pathMatch="full"', () => {
      const r = findRoute('home');
      expect(r).toBeDefined();
      expect(r?.redirectTo).toBe('/student/home');
      expect(r?.pathMatch).toBe('full');
    });

    it('/simulacro/:id redirige a /student/simulacro/:id', () => {
      const r = findRoute('simulacro/:id');
      expect(r).toBeDefined();
      expect(r?.redirectTo).toBe('/student/simulacro/:id');
    });

    it('raíz "" redirige a /login con pathMatch="full"', () => {
      const r = findRoute('');
      expect(r).toBeDefined();
      expect(r?.redirectTo).toBe('/login');
      expect(r?.pathMatch).toBe('full');
    });

    it('wildcard "**" redirige a /login', () => {
      const r = findRoute('**');
      expect(r).toBeDefined();
      expect(r?.redirectTo).toBe('/login');
    });
  });

  describe('shape general', () => {
    it('exporta un array de rutas', () => {
      expect(Array.isArray(routes)).toBe(true);
      expect(routes.length).toBeGreaterThan(0);
    });

    it('rutas con loadComponent son funciones (lazy)', () => {
      const studentHome = findRoute('student/home');
      const tutorHome = findRoute('tutor/home');
      const login = findRoute('login');
      const simulacro = findRoute('student/simulacro/:id');
      expect(typeof studentHome?.loadComponent).toBe('function');
      expect(typeof tutorHome?.loadComponent).toBe('function');
      expect(typeof login?.loadComponent).toBe('function');
      expect(typeof simulacro?.loadComponent).toBe('function');
    });
  });
});
