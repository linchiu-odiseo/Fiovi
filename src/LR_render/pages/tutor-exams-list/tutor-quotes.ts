// Capa ambient del /tutor/home — frase rotativa estilo epígrafe. Espeja
// el mecanismo de `inspirational-quotes.ts` (alumno) pero con voz
// dirigida al que enseña. Se elige una al montar la page y permanece
// hasta el próximo mount.
//
// Edición: el mantenimiento es pasar por acá y editar el array. Cero
// wiring, cero i18n. Si el set crece o se vuelve interesante rotarlo
// por hora del día / racha / etc, queda para un change separado.

export const TUTOR_QUOTES: readonly string[] = [
  'los alumnos no recuerdan lo que dijiste, recuerdan cómo los hiciste sentir',
  'un buen tutor deja huella sin darse cuenta',
  'la paciencia es la mejor herramienta pedagógica',
  'el que enseña aprende dos veces',
  'cada pregunta bien respondida es un examen aprobado más adelante',
  'pulsa aquí y te encontrarás a ti mismo',
];

export function randomTutorQuote(): string {
  const index = Math.floor(Math.random() * TUTOR_QUOTES.length);
  return TUTOR_QUOTES[index]!;
}
