import { SelectionChallenge } from '../../L1_domain/value-objects/selection-challenge';

// Outcome del parseo de la URL con la que Fiovi aterriza post-callback SSO
// del backend. Cuatro variantes:
//   - `auto`: caso 1 tenant matcheado. El backend puso cookies HttpOnly y
//     agregó `?slug=<slug>` para que Fiovi sepa a qué tenant pertenece antes
//     de armar el path `/t/{slug}/auth/me`.
//   - `selection`: caso >1 tenant matcheado. El backend redirigió a
//     `/login/select-tenant?selectionToken=<jwt>&tenants=<base64>` sin cookies.
//     Fiovi renderiza el selector; el user elige; se llama `POST /auth/select-tenant`.
//   - `error`: el backend redirigió a `/login?ssoError=<code>`. La LoginPage
//     muestra el mensaje mapeado.
//   - `none`: la URL no tiene ninguno de los query params esperados — arranque
//     normal, no venimos de callback.
export type SsoCallbackOutcome =
  | { kind: 'auto'; slug: string }
  | { kind: 'selection'; challenge: SelectionChallenge }
  | { kind: 'error'; code: string }
  | { kind: 'none' };

// Parsea la query string de la URL con la que aterriza el frontend PWA post
// callback SSO del backend. Puro TS — no toca `window` ni `history`, testeable
// sin browser. El caller (SsoCallbackBootstrap en L3) hace `history.replaceState`
// para limpiar la URL antes de que el Angular Router se monte.
export class ProcessSsoCallbackUseCase {
  execute(search: string): SsoCallbackOutcome {
    const params = new URLSearchParams(search);

    const ssoError = params.get('ssoError');
    if (ssoError) {
      return { kind: 'error', code: ssoError };
    }

    const selectionToken = params.get('selectionToken');
    const tenantsB64 = params.get('tenants');
    if (selectionToken && tenantsB64) {
      const decoded = safeDecodeTenants(tenantsB64);
      if (!decoded || decoded.length === 0) {
        // Params corruptos — tratamos como error genérico. La UI redirige
        // a /login con toast neutro. No revelar detalle interno del parse.
        return { kind: 'error', code: 'state_invalid' };
      }
      return {
        kind: 'selection',
        challenge: {
          selectionToken,
          // El backend no manda `selectionExpiresAt` en la URL — asumimos
          // los 5 min de TTL del token JWT. Si expira antes, el POST
          // /auth/select-tenant devolverá 401 y la view-model mostrará el
          // mensaje "expiró, inicia de nuevo".
          selectionExpiresAt: Date.now() + 5 * 60 * 1000,
          tenants: decoded,
        },
      };
    }

    const slug = params.get('slug');
    if (slug && isValidSlug(slug)) {
      return { kind: 'auto', slug };
    }

    return { kind: 'none' };
  }
}

// Slug policy relajada — solo requiere caracteres URL-safe (alfanuméricos,
// guiones y underscores). El backend hace su propia validación estricta al
// resolver contra la tabla `tenants`; acá solo defendemos contra basura obvia.
function isValidSlug(slug: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(slug);
}

function safeDecodeTenants(b64: string): { slug: string; name: string }[] | null {
  try {
    const jsonStr = atob(b64);
    const parsed: unknown = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return null;
    const out: { slug: string; name: string }[] = [];
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) return null;
      const t = item as { slug?: unknown; name?: unknown };
      if (typeof t.slug !== 'string' || typeof t.name !== 'string') return null;
      if (!isValidSlug(t.slug)) return null;
      out.push({ slug: t.slug, name: t.name });
    }
    return out;
  } catch {
    return null;
  }
}
