import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { environment } from '../../../environments/environment';
import { VersionFooterComponent } from '../../components/version-footer/version-footer.component';
import { LoginViewModel } from '../../view-models/login.view-model';

// Códigos de error que el backend learnex puede pasar en `?ssoError=` al
// redirigir a `/login` tras un flujo Google fallido. Enum finito acordado
// con el equipo backend — cualquier valor fuera de la lista cae al fallback
// `unknown`.
const SSO_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  sso_disabled: 'El login con Google no está disponible para tu institución.',
  google_error: 'Google no autorizó tu ingreso. Intentá de nuevo.',
  missing_params: 'Hubo un problema con Google. Intentá de nuevo.',
  state_invalid: 'La sesión de login venció. Intentá de nuevo.',
  hosted_domain_mismatch: 'Solo podés ingresar con tu correo institucional.',
  email_not_verified: 'Tu correo de Google no está verificado.',
  user_not_found: 'Tu cuenta de Google no está registrada. Contactá a tu tutor.',
  unknown: 'No se pudo iniciar sesión con Google. Intentá de nuevo.',
};

@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule, VersionFooterComponent],
  templateUrl: './login.page.html',
  styleUrl: './login.page.scss',
  providers: [LoginViewModel],
})
export class LoginPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  protected readonly vm = inject(LoginViewModel);

  protected readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  // Gate del botón Google en el template. Flag opt-out desde `.env`
  // (`GOOGLE_SSO_ENABLED=false` lo apaga); por default el botón se ve.
  protected readonly googleSsoEnabled = environment.googleSsoEnabled;

  // URL del flujo Google del backend learnex. Ver contrato en
  // `openspec/changes/add-google-sso-login/proposal.md`. `?app=pwa` identifica
  // a Fiovi como frontend destino (vs `?app=tenant` del web-tenant), lo que
  // hace que el backend redirija a `WEB_PWA_BASE_URL` post-callback en vez de
  // a `WEB_TENANT_BASE_URL`. `returnTo=/` deja que el AppInitializer decida
  // la ruta final según role (student/tutor).
  protected readonly googleSsoUrl =
    `${environment.apiBaseUrl}/t/${environment.tenantSlug}` +
    `/auth/google/start?app=pwa&returnTo=%2F`;

  ngOnInit(): void {
    // Si el backend redirigió a /login?ssoError=<code> tras un flujo Google
    // fallido, mostramos el mensaje en el mismo slot de error que ya usa el
    // submit de email/password. La lectura es snapshot (una sola vez al
    // montar) — el `ssoError` no cambia durante la vida del componente.
    const raw = this.route.snapshot.queryParams['ssoError'] as string | undefined;
    const msg = this.mapSsoErrorToMessage(raw ?? null);
    if (msg !== null) {
      this.vm.errorMessage.set(msg);
    }
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.vm.isSubmitting()) return;
    const outcome = await this.vm.submit(this.form.getRawValue());
    if (outcome === 'ok') {
      this.form.reset({ email: '', password: '' });
    } else if (outcome === 'invalid') {
      this.form.patchValue({ password: '' });
    }
    // network: form values stay as-is para que el usuario reintente.
  }

  protected onGoogleLoginClick(): void {
    // `window.location.assign` en vez de `href = ...` porque es spy-friendly
    // desde tests jsdom sin gymnastics de `Object.defineProperty` en el setter.
    window.location.assign(this.googleSsoUrl);
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
