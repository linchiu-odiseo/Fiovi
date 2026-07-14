// Provider SSO habilitado globalmente en el SaaS (ej. Google, Microsoft).
// El backend expone la lista via GET /auth/sso/providers para render
// dinámico del botón — si el admin apaga un provider, el botón desaparece
// sin deploy del frontend.
export interface SsoProvider {
  readonly provider: string; // ej. 'google' — identifica al provider en el path del start
  readonly displayName: string; // ej. 'Google' — texto humano para el botón
}
