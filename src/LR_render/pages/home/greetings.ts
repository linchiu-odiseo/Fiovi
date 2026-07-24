// Set de saludos que precede al nombre en el hero del /home. Se elige
// uno al montar la page y persiste hasta el próximo mount.
//
// Convención sin coma: el saludo se concatena directamente con el
// nombre ("Hola Fulano", "Buen día Fulano") — lectura más limpia en
// mobile que la variante puntuada "Hola, Fulano".
//
// Edición: agregar/quitar entradas acá sin tocar la view-model. El
// invariante "al menos 1 elemento" está cubierto por el unit test.
// Aplica tanto a /student/home como a /tutor/home.

export const GREETINGS: readonly string[] = [
  'Hola',
  'Bienvenido',
  'Buen día',
  'Qué gusto verte',
  'Hola de nuevo',
];

export function randomGreeting(): string {
  const index = Math.floor(Math.random() * GREETINGS.length);
  return GREETINGS[index]!;
}
