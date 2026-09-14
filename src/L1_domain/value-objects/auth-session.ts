import { Identity } from '../entities/identity';
import { ServerTime } from './server-time';

// Resultado exitoso de login/selectTenant/me/refresh: empareja la `Identity`
// con el `serverTime` de esa misma respuesta HTTP, cuando el backend lo
// incluyo. `serverTime` es `null` cuando el campo vino ausente (backend
// todavia no desplegado) o no se pudo parsear como ISO 8601 — ninguno de los
// dos casos es un error, simplemente no hay calibracion para esa respuesta.
//
// Sibling field de `Identity` en vez de un campo mas de `Identity`: lo que
// persiste `IdentityStorage` es solo la identity, no un timestamp de
// calibracion de un solo uso que quedaria stale en el proximo read.
export interface AuthSession {
  readonly identity: Identity;
  readonly serverTime: ServerTime | null;
}
