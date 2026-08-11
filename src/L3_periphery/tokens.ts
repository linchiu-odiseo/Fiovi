import { InjectionToken } from '@angular/core';
import { CaptchaProvider } from '../L1_domain/ports/captcha-provider';
import { IdentityStorage } from '../L1_domain/ports/identity-storage';
import { ProfileStorage } from '../L1_domain/ports/profile-storage';
import { OutboxStoragePort } from '../L1_domain/ports/outbox-storage.port';
import { PwaCookieModeStore } from '../L1_domain/ports/pwa-cookie-mode-store';
import { SwMessengerPort } from '../L1_domain/ports/sw-messenger.port';
import { TutorExamsApi } from '../L1_domain/ports/tutor-exams-api';
import { TutorNavigationApi } from '../L1_domain/ports/tutor-navigation-api';

// Tokens DI para los ports L1 que se inyectan via interface (Angular no
// puede inyectar interfaces por tipo en TypeScript runtime). Los bindings
// concretos viven en `app.config.ts` con `useExisting` apuntando a las
// implementaciones concretas L3.
//
// Beneficio arquitectónico: los adapters L3 que necesitan un port lo
// inyectan por token → dependen de la interface L1, no de la clase
// concreta. Esto preserva el Principio de Inversión de Dependencias
// y evita que un adapter dependa de otro adapter directamente
// (lo que era el layer violation original de `IndexedDbMarkingsStorage`).
export const IDENTITY_STORAGE = new InjectionToken<IdentityStorage>('IdentityStorage');
export const PROFILE_STORAGE = new InjectionToken<ProfileStorage>('ProfileStorage');
export const OUTBOX_STORAGE = new InjectionToken<OutboxStoragePort>('OutboxStoragePort');
export const SW_MESSENGER = new InjectionToken<SwMessengerPort>('SwMessengerPort');

// Token DI para el puerto de virtual exams del tutor. El binding concreto
// vive en `app.config.ts` con `useExisting: HttpTutorExamsApi`.
// Las VM del tutor lo inyectan para usarlo sin acoplarse a la clase L3.
export const TUTOR_EXAMS_API = new InjectionToken<TutorExamsApi>('TUTOR_EXAMS_API');

// Token DI para el puerto de navegación del tutor (AULA → SEMANA → CURSO →
// EXÁMENES + shortcut en-curso). Separado de TUTOR_EXAMS_API porque cubre
// otro bounded context: navegación / listados agregados, no operaciones
// sobre un virtual exam individual.
export const TUTOR_NAVIGATION_API = new InjectionToken<TutorNavigationApi>('TUTOR_NAVIGATION_API');

// Token DI para el puerto del captcha anti-bot que protege el login. El binding
// concreto vive en `app.config.ts` con `useExisting: CloudflareTurnstileProvider`.
// El `CaptchaWidgetComponent` (LR) lo consume vía este token.
export const CAPTCHA_PROVIDER = new InjectionToken<CaptchaProvider>('CaptchaProvider');

// Token DI para el flag "esta instalación migró al modo pwa cookie". El binding
// concreto vive en `app.config.ts` con `useExisting: LocalStoragePwaCookieModeStore`.
// Consumido por `credentialsInterceptor` (agrega header X-Client-App si está
// encendido) y por los use-cases de login/select-tenant/sso-callback (lo encienden
// tras auth exitosa). Ver `PwaCookieModeStore` para el racional del flag.
export const PWA_COOKIE_MODE_STORE = new InjectionToken<PwaCookieModeStore>('PwaCookieModeStore');
