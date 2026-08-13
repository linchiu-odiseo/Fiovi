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
import { InstallEnvironmentProbe } from './L1_domain/ports/install-environment-probe';
import { InstallPromptStore } from './L1_domain/ports/install-prompt-store';
import { MarkingsStorage } from './L1_domain/ports/markings-storage';
import { ExamsApi } from './L1_domain/ports/exams-api';
import { IdentityStorage } from './L1_domain/ports/identity-storage';
import { NativeInstallPrompt } from './L1_domain/ports/native-install-prompt';
import { ProfileStorage } from './L1_domain/ports/profile-storage';
import { PwaCookieModeStore } from './L1_domain/ports/pwa-cookie-mode-store';
import { RouterPort } from './L1_domain/ports/router-port';
import { TenantSlugCache } from './L1_domain/ports/tenant-slug-cache';

// L2 use cases — clases TS puras sin @Injectable, instanciadas por factory.
import { LoginUseCase } from './L2_application/use-cases/login.use-case';
import { LogoutUseCase } from './L2_application/use-cases/logout.use-case';
import { GetIdentityUseCase } from './L2_application/use-cases/get-identity.use-case';
import { RefreshIdentityUseCase } from './L2_application/use-cases/refresh-identity.use-case';
import { GetProfileUseCase } from './L2_application/use-cases/get-profile.use-case';
import { InitializeSessionUseCase } from './L2_application/use-cases/initialize-session.use-case';
import { SelectTenantUseCase } from './L2_application/use-cases/select-tenant.use-case';
import { ListSsoProvidersUseCase } from './L2_application/use-cases/list-sso-providers.use-case';
import { GetTodaysExamsUseCase } from './L2_application/use-cases/get-todays-exams.use-case';
import { MarcarRespuestaUseCase } from './L2_application/use-cases/marcar-respuesta.use-case';
import { EnviarSimulacroUseCase } from './L2_application/use-cases/enviar-simulacro.use-case';
import { EnviarTareaUseCase } from './L2_application/use-cases/enviar-tarea.use-case';
import { RetomarEnviosPendientesUseCase } from './L2_application/use-cases/retomar-envios-pendientes.use-case';
import { ProgramarAutoEnvioUseCase } from './L2_application/use-cases/programar-auto-envio.use-case';
import { GuardarDraftUseCase } from './L2_application/use-cases/guardar-draft.use-case';
import { SeleccionarAdmissionAreaUseCase } from './L2_application/use-cases/seleccionar-admission-area.use-case';
import { GetHistorialUseCase } from './L2_application/use-cases/get-historial.use-case';
import { GetHistorialEntryUseCase } from './L2_application/use-cases/get-historial-entry.use-case';
import { GetMySubmissionUseCase } from './L2_application/use-cases/get-my-submission.use-case';
import { DecideInstallCardStateUseCase } from './L2_application/use-cases/decide-install-card-state.use-case';

// L3 implementaciones de los puertos.
import { CloudflareTurnstileProvider } from './L3_periphery/captcha/cloudflare-turnstile-provider';
import { HttpAuthRepository } from './L3_periphery/http/http-auth-repository';
import { HttpExamsApi } from './L3_periphery/http/http-exams-api';
import { HttpTutorExamsApi } from './L3_periphery/http/http-tutor-exams-api';
import { HttpTutorNavigationApi } from './L3_periphery/http/http-tutor-navigation-api';
import { LocalStorageIdentityStorage } from './L3_periphery/storage/local-storage-identity-storage';
import { LocalStoragePwaCookieModeStore } from './L3_periphery/storage/local-storage-pwa-cookie-mode-store';
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
import { BeforeInstallPromptAdapter } from './L3_periphery/pwa/before-install-prompt.adapter';
import { BrowserInstallEnvironmentProbe } from './L3_periphery/pwa/browser-install-environment-probe';
import { PwaUpdateService } from './L3_periphery/pwa/pwa-update.service';
import { LocalStorageInstallPromptStore } from './L3_periphery/storage/local-storage-install-prompt-store';
import { SlugStore } from './L3_periphery/http/slug-store';
import { SsoCallbackBootstrap } from './L3_periphery/http/sso-callback-bootstrap';
import {
  CAPTCHA_PROVIDER,
  IDENTITY_STORAGE,
  INSTALL_ENV_PROBE,
  INSTALL_PROMPT_STORE,
  NATIVE_INSTALL_PROMPT,
  PROFILE_STORAGE,
  OUTBOX_STORAGE,
  PWA_COOKIE_MODE_STORE,
  TUTOR_EXAMS_API,
  TUTOR_NAVIGATION_API,
} from './L3_periphery/tokens';
import { environment } from './environments/environment';

// L2 use-cases del tutor — puras TS, sin decorador Angular.
import { GetTutorExamsUseCase } from './L2_application/use-cases/get-tutor-exams.use-case';
import { GetTutorExamsFinalizadasUseCase } from './L2_application/use-cases/get-tutor-exams-finalizadas.use-case';
import { GetTutorExamDetailUseCase } from './L2_application/use-cases/get-tutor-exam-detail.use-case';
import { ListClassroomStudentsUseCase } from './L2_application/use-cases/list-classroom-students.use-case';
import { IniciarExamenUseCase } from './L2_application/use-cases/iniciar-examen.use-case';
import { FinalizarExamenUseCase } from './L2_application/use-cases/finalizar-examen.use-case';
import { ArchivarExamenUseCase } from './L2_application/use-cases/archivar-examen.use-case';
import { ActualizarAlumnosHabilitadosUseCase } from './L2_application/use-cases/actualizar-alumnos-habilitados.use-case';
import { GetAulaSemanasUseCase } from './L2_application/use-cases/get-aula-semanas.use-case';
import { GetAulaSemanaExamenesUseCase } from './L2_application/use-cases/get-aula-semana-examenes.use-case';
import { GetExamsEnCursoUseCase } from './L2_application/use-cases/get-exams-en-curso.use-case';
import { TutorExamsApi } from './L1_domain/ports/tutor-exams-api';
import { TutorNavigationApi } from './L1_domain/ports/tutor-navigation-api';

// Tokens DI para ports de Fase 2 que aún no migraron a src/L3_periphery/tokens.ts.
// Se mantienen acá hasta que un change futuro los consolide.
export const AUTH_REPOSITORY = new InjectionToken<AuthRepository>('AUTH_REPOSITORY');
export const CLOCK = new InjectionToken<Clock>('CLOCK');
export const CONNECTIVITY = new InjectionToken<Connectivity>('CONNECTIVITY');
export const MARKINGS_STORAGE = new InjectionToken<MarkingsStorage>('MARKINGS_STORAGE');
export const EXAMS_API = new InjectionToken<ExamsApi>('EXAMS_API');
export const ROUTER_PORT = new InjectionToken<RouterPort>('ROUTER_PORT');
export const TENANT_SLUG_CACHE = new InjectionToken<TenantSlugCache>('TENANT_SLUG_CACHE');

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
    { provide: PWA_COOKIE_MODE_STORE, useExisting: LocalStoragePwaCookieModeStore },
    { provide: INSTALL_ENV_PROBE, useExisting: BrowserInstallEnvironmentProbe },
    { provide: INSTALL_PROMPT_STORE, useExisting: LocalStorageInstallPromptStore },
    { provide: NATIVE_INSTALL_PROMPT, useExisting: BeforeInstallPromptAdapter },
    { provide: TENANT_SLUG_CACHE, useExisting: SlugStore },
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
    // Bind puerto TutorNavigationApi → HttpTutorNavigationApi. Mismo patrón
    // que el bind de TUTOR_EXAMS_API.
    { provide: TUTOR_NAVIGATION_API, useExisting: HttpTutorNavigationApi },
    // Bind puerto CaptchaProvider → CloudflareTurnstileProvider. Con
    // `CAPTCHA_SITE_KEY` vacío en `.env`, el provider queda `isEnabled()=false`
    // y el LoginPage skipea el widget (dev sin fricción).
    { provide: CAPTCHA_PROVIDER, useExisting: CloudflareTurnstileProvider },
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
      useFactory: (
        repo: AuthRepository,
        storage: IdentityStorage,
        slugCache: TenantSlugCache,
        getProfile: GetProfileUseCase,
        pwaCookieMode: PwaCookieModeStore,
      ) => new LoginUseCase(repo, storage, slugCache, getProfile, pwaCookieMode),
      deps: [
        AUTH_REPOSITORY,
        IDENTITY_STORAGE,
        TENANT_SLUG_CACHE,
        GetProfileUseCase,
        PWA_COOKIE_MODE_STORE,
      ],
    },
    {
      provide: SelectTenantUseCase,
      useFactory: (
        repo: AuthRepository,
        storage: IdentityStorage,
        slugCache: TenantSlugCache,
        getProfile: GetProfileUseCase,
        pwaCookieMode: PwaCookieModeStore,
      ) => new SelectTenantUseCase(repo, storage, slugCache, getProfile, pwaCookieMode),
      deps: [
        AUTH_REPOSITORY,
        IDENTITY_STORAGE,
        TENANT_SLUG_CACHE,
        GetProfileUseCase,
        PWA_COOKIE_MODE_STORE,
      ],
    },
    {
      provide: ListSsoProvidersUseCase,
      useFactory: (repo: AuthRepository) => new ListSsoProvidersUseCase(repo),
      deps: [AUTH_REPOSITORY],
    },
    {
      provide: LogoutUseCase,
      useFactory: (
        repo: AuthRepository,
        identityStorage: IdentityStorage,
        slugCache: TenantSlugCache,
        profileStorage: ProfileStorage,
        draftDispatcher: DraftAutoSaveDispatcher,
        routerPort: RouterPort,
      ) =>
        new LogoutUseCase(
          repo,
          identityStorage,
          slugCache,
          profileStorage,
          draftDispatcher,
          routerPort,
        ),
      deps: [
        AUTH_REPOSITORY,
        IDENTITY_STORAGE,
        TENANT_SLUG_CACHE,
        PROFILE_STORAGE,
        DraftAutoSaveDispatcher,
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
      useFactory: (
        repo: AuthRepository,
        storage: IdentityStorage,
        slugCache: TenantSlugCache,
        logout: LogoutUseCase,
      ) => new RefreshIdentityUseCase(repo, storage, slugCache, logout),
      deps: [AUTH_REPOSITORY, IDENTITY_STORAGE, TENANT_SLUG_CACHE, LogoutUseCase],
    },
    {
      provide: InitializeSessionUseCase,
      useFactory: (
        repo: AuthRepository,
        storage: IdentityStorage,
        slugCache: TenantSlugCache,
        getProfile: GetProfileUseCase,
      ) => new InitializeSessionUseCase(repo, storage, slugCache, getProfile),
      deps: [AUTH_REPOSITORY, IDENTITY_STORAGE, TENANT_SLUG_CACHE, GetProfileUseCase],
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
      provide: EnviarTareaUseCase,
      useFactory: (
        api: ExamsApi,
        markings: MarkingsStorage,
        clock: Clock,
        identity: IdentityStorage,
      ) => new EnviarTareaUseCase(api, markings, clock, identity),
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
    {
      provide: GetMySubmissionUseCase,
      useFactory: (api: ExamsApi, markings: MarkingsStorage) =>
        new GetMySubmissionUseCase(api, markings),
      deps: [EXAMS_API, MARKINGS_STORAGE],
    },
    {
      provide: GetHistorialUseCase,
      useFactory: (markings: MarkingsStorage, getMy: GetMySubmissionUseCase) =>
        new GetHistorialUseCase(markings, getMy),
      deps: [MARKINGS_STORAGE, GetMySubmissionUseCase],
    },
    {
      provide: GetHistorialEntryUseCase,
      useFactory: (markings: MarkingsStorage) => new GetHistorialEntryUseCase(markings),
      deps: [MARKINGS_STORAGE],
    },
    {
      provide: DecideInstallCardStateUseCase,
      useFactory: (
        probe: InstallEnvironmentProbe,
        store: InstallPromptStore,
        native: NativeInstallPrompt,
      ) => new DecideInstallCardStateUseCase(probe, store, native),
      deps: [INSTALL_ENV_PROBE, INSTALL_PROMPT_STORE, NATIVE_INSTALL_PROMPT],
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
      provide: GetTutorExamsFinalizadasUseCase,
      useFactory: (api: TutorExamsApi) => new GetTutorExamsFinalizadasUseCase(api),
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
      provide: ArchivarExamenUseCase,
      useFactory: (api: TutorExamsApi) => new ArchivarExamenUseCase(api),
      deps: [TUTOR_EXAMS_API],
    },
    {
      provide: ActualizarAlumnosHabilitadosUseCase,
      useFactory: (api: TutorExamsApi) => new ActualizarAlumnosHabilitadosUseCase(api),
      deps: [TUTOR_EXAMS_API],
    },
    // Use-cases del nav mobile del tutor (change tutor-aulas-semanas-view).
    // Todos anclan el Clock con serverTime del response — patrón GetTodaysExamsUseCase.
    {
      provide: GetAulaSemanasUseCase,
      useFactory: (api: TutorNavigationApi, clock: Clock) => new GetAulaSemanasUseCase(api, clock),
      deps: [TUTOR_NAVIGATION_API, CLOCK],
    },
    {
      provide: GetAulaSemanaExamenesUseCase,
      useFactory: (api: TutorNavigationApi, clock: Clock) =>
        new GetAulaSemanaExamenesUseCase(api, clock),
      deps: [TUTOR_NAVIGATION_API, CLOCK],
    },
    {
      provide: GetExamsEnCursoUseCase,
      useFactory: (api: TutorNavigationApi, clock: Clock) => new GetExamsEnCursoUseCase(api, clock),
      deps: [TUTOR_NAVIGATION_API, CLOCK],
    },

    // Provider del dispatcher de draft. Con draftEnabled=true se instancia el
    // dispatcher real; con false, el stub no-op que no emite tráfico ni timers.
    // El view-model inyecta DraftAutoSaveDispatcher y llama métodos sin condicional.
    // (design.md D7 — NO en APP_INITIALIZER, arranca lazy desde el view-model D8)
    {
      provide: DraftAutoSaveDispatcher,
      useFactory: (useCase: GuardarDraftUseCase) =>
        environment.draftEnabled
          ? new DraftAutoSaveDispatcher(useCase)
          : new NoopDraftAutoSaveDispatcher(),
      deps: [GuardarDraftUseCase],
    },

    // AppInitializer #0 (SÍNCRONO, corre PRIMERO): procesa la URL post-callback
    // SSO. Si viene `?slug=` hidrata `SlugStore` para que el `InitializeSession`
    // pueda armar `me()`. Si viene `?selectionToken=&tenants=` stashea el
    // challenge en sessionStorage y limpia URL antes del Router. Ver
    // `SsoCallbackBootstrap` para el flow por caso.
    provideAppInitializer(() => {
      inject(SsoCallbackBootstrap).run();
    }),

    // AppInitializer #1: re-valida identity contra learnex al arrancar (cookie
    // HttpOnly puede seguir viva entre sesiones, o venimos de un callback SSO
    // que dejó cookies + hidrató SlugStore). Si OK, identity queda disponible
    // para guards y view-models antes del primer render.
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

    // BeforeInstallPromptAdapter: registra listeners globales
    // `beforeinstallprompt` (Chromium) y `appinstalled`. Sin arrancarlo,
    // el card "Instala Fiovi como app" nunca capta el evento nativo y
    // se queda en modo `hidden` en Android.
    provideAppInitializer(() => {
      inject(BeforeInstallPromptAdapter).start();
    }),
  ],
};
