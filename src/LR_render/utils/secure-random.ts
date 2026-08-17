// Drop-in reemplazo de Math.random() usando Web Crypto API. Devuelve un
// float uniforme en [0, 1). Disponible nativa en todos los browsers que
// Fiovi soporta (PWA mobile modernos) y en Node 20+ (para tests con
// jsdom). Reemplaza Math.random() en usos "cosméticos" (pickers, jitter
// de retry) para satisfacer la regla Sonar S2245 sin sumar dependencias
// ni cambiar semántica: la distribución sigue siendo uniforme en [0, 1).
export function secureRandomFloat(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0]! / 2 ** 32;
}
