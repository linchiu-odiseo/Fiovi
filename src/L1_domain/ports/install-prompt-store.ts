// Persistencia local del estado del card "Instala Fiovi como app". Vive en
// localStorage: el flag NO tiene que sobrevivir a la desinstalación del
// browser ni saltar a otro dispositivo, y no queremos pagar el costo async
// de IndexedDB para leerlo en cada tick del view-model.
//
// Un solo bit de estado: `installedFlag`. Se prende cuando el browser
// dispara `appinstalled`. Mientras está apagado, el card sigue tentando en
// cada visita. Una vez prendido, no vuelve a mostrarse (respetamos que el
// user ya lo instaló, aunque luego desinstale y vuelva).
//
// Sync porque el use case lo consulta en cada `execute()`; adapter degrada
// silencioso si localStorage está bloqueado (Safari ITP, modo privado).
export interface InstallPromptStore {
  isMarkedInstalled(): boolean;
  markInstalled(): void;
}
