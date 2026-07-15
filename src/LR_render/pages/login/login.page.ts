import { Component, OnInit, ViewChild, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { apiPath } from '../../../L3_periphery/http/api-paths';
import { CAPTCHA_PROVIDER } from '../../../L3_periphery/tokens';
import { CaptchaWidgetComponent } from '../../components/captcha-widget/captcha-widget.component';
import { VersionFooterComponent } from '../../components/version-footer/version-footer.component';
import { LoginViewModel } from '../../view-models/login.view-model';

// Códigos de error que el backend learnex puede pasar en `?ssoError=` al
// redirigir a `/login` tras un flow SSO fallido. Enum finito sincronizado con
// `ResolveSsoLoginUseCase.SsoLoginError` + los errores del state OAuth del
// `PublicSsoAuthController` (google_error, missing_params, state_invalid).
// Cualquier valor fuera de la lista cae al fallback `unknown`.
const SSO_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  sso_disabled: 'El login con Google no está disponible en este momento.',
  sso_disabled_for_tenant: 'Tu academia no permite iniciar sesión con Google.',
  sso_provider_unsupported: 'Ese proveedor de login no está soportado.',
  sso_no_matching_tenant: 'Ese correo no está registrado en ninguna academia.',
  sso_email_not_verified: 'Verificá tu correo con Google antes de iniciar sesión.',
  sso_hosted_domain_mismatch: 'Tu cuenta de Google no pertenece al dominio autorizado.',
  sso_user_inactive: 'Tu cuenta está desactivada. Contactá a tu academia.',
  // Fallback defensivo: el backend post-cambio ya no lo emite, pero un cliente
  // con cache viejo podría verlo hasta el refresh de la PWA.
  sso_multiple_tenants: 'Iniciá sesión con tu contraseña por ahora.',
  google_error: 'Google no autorizó tu ingreso. Intentá de nuevo.',
  missing_params: 'Hubo un problema con Google. Intentá de nuevo.',
  state_invalid: 'El intento de login expiró. Intentá de nuevo.',
  unknown: 'No se pudo iniciar sesión con Google. Intentá de nuevo.',
};

@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule, CaptchaWidgetComponent, VersionFooterComponent],
  templateUrl: './login.page.html',
  styleUrl: './login.page.scss',
  providers: [LoginViewModel],
})
export class LoginPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly captchaProvider = inject(CAPTCHA_PROVIDER);
  protected readonly vm = inject(LoginViewModel);

  protected readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  // Snapshot al montar: si el provider está enabled, el LoginPage renderiza el
  // widget y deshabilita el botón hasta que llegue el primer token. Con site
  // key vacía (dev sin fricción) queda `false` y el submit funciona como antes.
  protected readonly captchaEnabled = this.captchaProvider.isEnabled();
  protected readonly captchaToken = signal<string | null>(null);
  protected readonly passwordVisible = signal(false);

  @ViewChild('captcha') private captchaWidget?: CaptchaWidgetComponent;

  ngOnInit(): void {
    // Si el backend redirigió a /login?ssoError=<code> tras un flow SSO
    // fallido, mostramos el mensaje en el mismo slot de error que ya usa el
    // submit de email/password. La lectura es snapshot (una sola vez al
    // montar) — el `ssoError` no cambia durante la vida del componente.
    const raw = this.route.snapshot.queryParams['ssoError'] as string | undefined;
    const msg = this.mapSsoErrorToMessage(raw ?? null);
    if (msg !== null) {
      this.vm.errorMessage.set(msg);
    }
    // Fetch dinámico de los providers habilitados en el SaaS. La UI decide
    // qué botones renderizar en base al signal `vm.ssoProviders()`. Sin
    // await para no bloquear el primer render del form password.
    void this.vm.loadSsoProviders();
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.vm.isSubmitting()) return;
    // Cuando el captcha está activo, no permitimos el submit hasta tener token.
    // El botón ya viene deshabilitado en el template — este guard cubre el path
    // "Enter en el input" que evade el disabled del botón.
    const token = this.captchaToken();
    if (this.captchaEnabled && !token) return;
    const outcome = await this.vm.submit({
      ...this.form.getRawValue(),
      captchaToken: token ?? undefined,
    });
    if (outcome === 'ok' || outcome === 'selection') {
      this.form.reset({ email: '', password: '' });
    } else if (outcome === 'invalid') {
      this.form.patchValue({ password: '' });
    }
    // network: form values stay as-is para que el usuario reintente.

    // Cualquier outcome distinto de éxito consume el token (los captcha tokens
    // son de un solo uso). Resetear el widget pide uno nuevo al proveedor.
    if (this.captchaEnabled && outcome !== 'ok' && outcome !== 'selection') {
      this.captchaWidget?.reset();
      this.captchaToken.set(null);
    }
  }

  protected onCaptchaTokenChange(token: string | null): void {
    this.captchaToken.set(token);
  }

  protected togglePasswordVisibility(): void {
    this.passwordVisible.update((v) => !v);
  }

  protected onSsoProviderClick(provider: string): void {
    // `window.location.assign` en vez de `href = ...` porque es spy-friendly
    // desde tests jsdom sin gymnastics de `Object.defineProperty` en el setter.
    window.location.assign(apiPath.ssoStart(provider));
  }

  // Traduce el código de error del backend a copy es-PE. Cualquier código
  // fuera del enum (incluido null/undefined/vacío) sin match explícito cae
  // al fallback `unknown`. Retorna `null` solo cuando NO llegó ningún código
  // (query param ausente) — para no pisar el `errorMessage` del submit.
  protected mapSsoErrorToMessage(code: string | null | undefined): string | null {
    if (code === null || code === undefined || code === '') return null;
    return SSO_ERROR_MESSAGES[code] ?? SSO_ERROR_MESSAGES['unknown'];
  }
}
