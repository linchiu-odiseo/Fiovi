// `YYYY-MM-DD` en la timezone LOCAL del dispositivo. Sin dependencias externas.
//
// Usado por AuditLogStore para detectar cambio de día y disparar la rotación
// inline en `append` (spec REQ-AL-03, design Decision 5).
//
// Corte a las 00:00 local. El edge case "sesión cruza medianoche" no tiene
// tratamiento especial — nadie examina a las 00:00 local (design Non-Goal).

export function todayLocalKey(now: Date = new Date()): string {
  const yyyy = now.getFullYear().toString().padStart(4, '0');
  const mm = (now.getMonth() + 1).toString().padStart(2, '0');
  const dd = now.getDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Trunca sessionId a últimos 8 chars para el campo `s` de los eventos.
// El back tiene el UUID completo por el path — no hace falta duplicarlo en
// el log. Usado por adapters HTTP (para HttpContext) y por view-models (SS, MK).
export function shortSessionId(sessionId: string): string {
  return sessionId.length <= 8 ? sessionId : sessionId.slice(-8);
}
