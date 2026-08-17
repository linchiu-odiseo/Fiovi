// Capa ambient del /home — frase rotativa estilo "splash Minecraft" /
// epígrafe de libro: se elige una al montar la página y permanece visible
// debajo del saludo. Estática y client-side por diseño: cero network calls,
// cero backend, cero analytics. Si el set se vuelve interesante para
// rotación dinámica, queda para un change separado.
//
// Edición: el usuario puede agregar/quitar entradas del array sin tocar
// el view-model ni la página. La función `randomQuote` siempre devuelve
// una string del set (el invariante de "al menos 1 elemento" lo cubre el
// test en tests/unit/LR_render/pages/home/inspirational-quotes.spec.ts).

import { secureRandomFloat } from '../../utils/secure-random';

export const INSPIRATIONAL_QUOTES: readonly string[] = [
  'la diferencia entre el que pasa y el que no son los días en que nadie estaba viendo',
  'lo que practicas en silencio aparece en la hoja cuando importa',
  'el tiempo que le dedicas hoy es el examen que apruebas mañana',
  'no es talento. es haber vuelto a empezar más veces',
  'cada pregunta es una decisión; cada decisión, una respuesta tuya',
  'pulsa aquí y te encontrarás a ti mismo',
];

export function randomQuote(): string {
  const index = Math.floor(secureRandomFloat() * INSPIRATIONAL_QUOTES.length);
  // El non-null assertion es seguro: el módulo expone una const readonly y
  // el test garantiza que el array no sea vacío. Si alguien lo vacía, el
  // build pasa pero el unit test falla — barrera temprana antes de prod.
  return INSPIRATIONAL_QUOTES[index]!;
}
