import {
  ApplicationConfig,
  InjectionToken,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideServiceWorker } from '@angular/service-worker';

import { routes } from './LR_render/app.routes';

// L1 ports (interfaces). Angular los conoce vía InjectionTokens declarados acá
// o en src/L3_periphery/tokens.ts — el dominio se mantiene independiente del DI.
import { AuthRepository } from './L1_domain/ports/auth-repository';
import { Clock } from './L1_domain/ports/clock';
import { Connectivity } from './L1_domain/ports/connectivity';
import { MarkingsStorage } from './L1_domain/ports/markings-storage';
import { ExamsApi } from './L1_domain/ports/exams-api';
import { IdentityStorage } from './L1_domain/ports/identity-storage';
import { ProfileStorage } from './L1_domain/ports/profile-storage';
import { OutboxStoragePort } from './L1_domain/ports/outbox-storage.port';
import { RouterPort } from './L1_domain/ports/router-port';

// L2 use cases — clases TS puras sin @Injectable, instanciadas por factory.
import { LoginUseCase } from './L2_application/use-cases/login.use-case';
import { LogoutUseCase } from './L2_application/use-cases/logout.use-case';
import { GetIdentityUseCase } from './L2_application/use-cases/get-identity.use-case';
import { RefreshIdentityUseCase } from './L2_application/use-cases/refresh-identity.use-case';
import { GetProfileUseCase } from './L2_application/use-cases/get-profile.use-case';
import { InitializeSessionUseCase } from './L2_application/use-cases/initialize-session.use-case';
import { GetTodaysExamsUseCase } from './L2_application/use-cases/get-todays-exams.use-case';
import { MarcarRespuestaUseCase } from './L2_application/use-cases/marcar-respuesta.use-case';
import { EnviarSimulacroUseCase } from './L2_application/use-cases/enviar-simulacro.use-case';
import { RetomarEnviosPendientesUseCase } from './L2_application/use-cases/retomar-envios-pendientes.use-case';
import { ProgramarAutoEnvioUseCase } from './L2_application/use-cases/programar-auto-envio.use-case';
import { GuardarDraftUseCase } from './L2_application/use-cases/guardar-draft.use-case';
import { SeleccionarAdmissionAreaUseCase } from './L2_application/use-cases/seleccionar-admission-area.use-case';

// L3 implementaciones de los puertos.
import { HttpAuthRepository } from './L3_periphery/http/http-auth-repository';
import { HttpExamsApi } from './L3_periphery/http/http-exams-api';
import { HttpTutorExamsApi } from './L3_periphery/http/http-tutor-exams-api';
import { LocalStorageIdentityStorage } from './L3_periphery/storage/local-storage-identity-storage';
import { IndexedDbProfileStorage } from './L3_periphery/storage/indexed-db-profile-storage';
import { IndexedDbMarkingsStorage } from './L3_periphery/storage/indexed-db-markings-storage';
import { ServerAnchoredClock } from './L3_periphery/clock/server-anchored-clock';
import { BrowserConnectivity } from './L3_periphery/connectivity/browser-connectivity';
import { EnvioRetryDispatcher } from './L3_periphery/envio/envio-retry-dispatcher.service';
import {
  DraftAutoSaveDispatcher,
  NoopDraftAutoSaveDispatcher,
} from './L3_periphery/envio/draft-auto-save-dispatcher.service';
import { credentialsInterceptor } from './L3_periphery/interceptors/credentials.interceptor';
import { PwaUpdateService } from './L3_periphery/pwa/pwa-update.service';
import { IDENTITY_STORAGE, PROFILE_STORAGE, OUTBOX_STORAGE, TUTOR_EXAMS_API } from './L3_periphery/tokens';
import { environment } from './environments/environment';

// L2 use-cases del tutor — puras TS, sin decorador Angular.
import { GetTutorExamsUseCase } from './L2_application/use-cases/get-tutor-exams.use-case';
import { GetTutorExamDetailUseCase } from './L2_application/use-cases/get-tutor-exam-detail.use-case';
import { ListClassroomStudentsUseCase } from './L2_application/use-cases/list-classroom-students.use-case';
import { IniciarExamenUseCase } from './L2_application/use-cases/iniciar-examen.use-case';
import { FinalizarExamenUseCase } from './L2_application/use-cases/finalizar-examen.use-case';
import { ActualizarAlumnosHabilitadosUseCase } from './L2_application/use-cases/actualizar-alumnos-habilitados.use-case';
import { TutorExamsApi } from './L1_domain/ports/tutor-exams-api';

// Tokens DI para ports de Fase 2 que aún no migraron a src/L3_periphery/tokens.ts.
// Se mantienen acá hasta que un change futuro los consolide.
export const AUTH_REPOSITORY = new InjectionToken<AuthRepository>('AUTH_REPOSITORY');
export const CLOCK = new InjectionToken<Clock>('CLOCK');
export const CONNECTIVITY = new InjectionToken<Connectivity>('CONNECTIVITY');
export const MARKINGS_STORAGE = new InjectionToken<MarkingsStorage>('MARKINGS_STORAGE');
export const EXAMS_API = new InjectionToken<ExamsApi>('EXAMS_API');
export const ROUTER_PORT = new InjectionToken<RouterPort>('ROUTER_PORT');

// Adapter Angular `Router` → `RouterPort` (L1). Inline factory; sin nuevo archivo
// porque es un wrapper trivial usado solo desde el wiring.
function makeRouterPort(angularRouter: Router): RouterPort {
  return {
    navigate: (commands) => {
      // Voiding la promesa: navegación en use cases no espera resolución.
      void angularRouter.navigate(commands as unknown[]);
    },
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([credentialsInterceptor])),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),

    // Bind puertos L1 → implementaciones L3.
    { provide: AUTH_REPOSITORY, useExisting: HttpAuthRepository },
    { provide: IDENTITY_STORAGE, useExisting: LocalStorageIdentityStorage },
    { provide: PROFILE_STORAGE, useExisting: IndexedDbProfileStorage },
    // IndexedDbMarkingsStorage implementa MarkingsStorage Y OutboxStoragePort.
    { provide: MARKINGS_STORAGE, useExisting: IndexedDbMarkingsStorage },
    { provide: OUTBOX_STORAGE, useExisting: IndexedDbMarkingsStorage },
    { provide: CLOCK, useExisting: ServerAnchoredClock },
    { provide: CONNECTIVITY, useExisting: BrowserConnectivity },
    { provide: EXAMS_API, useExisting: HttpExamsApi },
    // Bind puerto TutorExamsApi → implementación HttpTutorExamsApi (L3 → L1).
    // HttpTutorExamsApi es @Injectable({ providedIn: 'root' }) — el useExisting
    // conecta el token con la instancia singleton ya creada por Angular.
    { provide: TUTOR_EXAMS_API, useExisting: HttpTutorExamsApi },
    {
      provide: ROUTER_PORT,
      useFactory: makeRouterPort,
      deps: [Router],
    },

    // Use cases L2: pure TS, sin decorador — Angular los instancia vía factory.
    {
      provide: GetProfileUseCase,
      useFactory: (storage: ProfileStorage, repo: AuthRepository) =>
        new GetProfileUseCase(storage, repo),
      deps: [PROFILE_STORAGE, AUTH_REPOSITORY],
    },
    {
      provide: LoginUseCase,
      useFactory: (repo: AuthRepository, storage: IdentityStorage, getProfile: GetProfileUseCase) =>
        new LoginUseCase(repo, storage, getProfile),
      deps: [AUTH_REPOSITORY, IDENTITY_STORAGE, GetProfileUseCase],
    },
    {
      provide: LogoutUseCase,
      useFactory: (
        repo: AuthRepository,
        identityStorage: IdentityStorage,
        profileStorage: ProfileStorage,
        markings: MarkingsStorage,
        outbox: OutboxStoragePort,
        routerPort: RouterPort,
      ) => new LogoutUseCase(repo, identityStorage, profileStorage, markings, outbox, routerPort),
      deps: [
        AUTH_REPOSITORY,
        IDENTITY_STORAGE,
        PROFILE_STORAGE,
        MARKINGS_STORAGE,
        OUTBOX_STORAGE,
        ROUTER_PORT,
      ],
    },
    {
      provide: GetIdentityUseCase,
      useFactory: (storage: IdentityStorage) => new GetIdentityUseCase(storage, () => Date.now()),
      deps: [IDENTITY_STORAGE],
    },
    {
      provide: RefreshIdentityUseCase,
      useFactory: (repo: AuthRepository, storage: IdentityStorage, logout: LogoutUseCase) =>
        new RefreshIdentityUseCase(repo, storage, logout),
      deps: [AUTH_REPOSITORY, IDENTITY_STORAGE, LogoutUseCase],
    },
    {
      provide: InitializeSessionUseCase,
      useFactory: (repo: AuthRepository, storage: IdentityStorage, getProfile: GetProfileUseCase) =>
        new InitializeSessionUseCase(repo, storage, getProfile),
      deps: [AUTH_REPOSITORY, IDENTITY_STORAGE, GetProfileUseCase],
    },
    {
      provide: GetTodaysExamsUseCase,
      useFactory: (api: ExamsApi, clock: Clock) => new GetTodaysExamsUseCase(api, clock),
      deps: [EXAMS_API, CLOCK],
    },
    {
      provide: MarcarRespuestaUseCase,
      useFactory: (markings: MarkingsStorage) => new MarcarRespuestaUseCase(markings),
      deps: [MARKINGS_STORAGE],
    },
    {
      provide: EnviarSimulacroUseCase,
      useFactory: (
        api: ExamsApi,
        markings: MarkingsStorage,
        clock: Clock,
        identity: IdentityStorage,
      ) => new EnviarSimulacroUseCase(api, markings, clock, identity),
      deps: [EXAMS_API, MARKINGS_STORAGE, CLOCK, IDENTITY_STORAGE],
    },
    {
      provide: RetomarEnviosPendientesUseCase,
      useFactory: (api: ExamsApi, markings: MarkingsStorage) =>
        new RetomarEnviosPendientesUseCase(api, markings),
      deps: [EXAMS_API, MARKINGS_STORAGE],
    },
    {
      provide: ProgramarAutoEnvioUseCase,
      useFactory: (enviar: EnviarSimulacroUseCase, clock: Clock) =>
        new ProgramarAutoEnvioUseCase(enviar, clock),
      deps: [EnviarSimulacroUseCase, CLOCK],
    },
    {
      provide: GuardarDraftUseCase,
      useFactory: (api: ExamsApi, markings: MarkingsStorage, identity: IdentityStorage) =>
        new GuardarDraftUseCase(api, markings, identity),
      deps: [EXAMS_API, MARKINGS_STORAGE, IDENTITY_STORAGE],
    },
    {
      provide: SeleccionarAdmissionAreaUseCase,
      useFactory: (markings: MarkingsStorage) => new SeleccionarAdmissionAreaUseCase(markings),
      deps: [MARKINGS_STORAGE],
    },
    // Use-cases del tutor: fábricas puras que inyectan el puerto via TUTOR_EXAMS_API.
    // PR1 los registra aquí pero ninguna VM los inyecta todavía (compila, runtime-inert).
    // PR2/PR3 añadirán las VM y páginas que los consumen. Ver design.md D7.
    {
      provide: GetTutorExamsUseCase,
      useFactory: (api: TutorExamsApi) => new GetTutorExamsUseCase(api),
      deps: [TUTOR_EXAMS_API],
    },
    {
      provide: GetTutorExamDetailUseCase,
      useFactory: (api: TutorExamsApi) => new GetTutorExamDetailUseCase(api),
      deps: [TUTOR_EXAMS_API],
    },
    {
      provide: ListClassroomStudentsUseCase,
      useFactory: (api: TutorExamsApi) => new ListClassroomStudentsUseCase(api),
      deps: [TUTOR_EXAMS_API],
    },
    {
      provide: IniciarExamenUseCase,
      useFactory: (api: TutorExamsApi) => new IniciarExamenUseCase(api),
      deps: [TUTOR_EXAMS_API],
    },
    {
      provide: FinalizarExamenUseCase,
      useFactory: (api: TutorExamsApi) => new FinalizarExamenUseCase(api),
      deps: [TUTOR_EXAMS_API],
    },
    {
      provide: ActualizarAlumnosHabilitadosUseCase,
      useFactory: (api: TutorExamsApi) => new ActualizarAlumnosHabilitadosUseCase(api),
      deps: [TUTOR_EXAMS_API],
    },

    // Provider del dispatcher de draft. Con draftEnabled=true se instancia el
    // dispatcher real; con false, el stub no-op que no emite tráfico ni timers.
    // El view-model inyecta DraftAutoSaveDispatcher y llama métodos sin condicional.
    // (design.md D7 — NO en APP_INITIALIZER, arranca lazy desde el view-model D8)
    {
      provide: DraftAutoSaveDispatcher,
      useFactory: (useCase: GuardarDraftUseCase) =>
        environment.draftEnabled ? new DraftAutoSaveDispatcher(useCase) : new NoopDraftAutoSaveDispatcher(),
      deps: [GuardarDraftUseCase],
    },

    // AppInitializer: re-valida identity contra learnex al arrancar (cookie
    // HttpOnly puede seguir viva entre sesiones). Si OK, identity queda
    // disponible para guards y view-models antes del primer render.
    provideAppInitializer(async () => {
      await inject(InitializeSessionUseCase).execute();
    }),

    // Dispatcher de retomar envíos pendientes (Fase 2): se suscribe a
    // Connectivity para reintentar la cola cuando vuelve la red.
    provideAppInitializer(() => {
      inject(EnvioRetryDispatcher).start();
    }),

    // PwaUpdateService: arranca suscripción a SwUpdate.versionUpdates y
    // listener visibilitychange. Es sync (no devuelve Promise), no bloquea
    // boot. En dev mode el servicio detecta isEnabled=false y no-op.
    provideAppInitializer(() => {
      inject(PwaUpdateService).start();
    }),
  ],
};
