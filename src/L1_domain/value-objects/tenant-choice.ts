// Un tenant en la lista del selector post-login (cuando el email matchea
// >1 tenant). El backend expone solo `slug` + `name` — datos públicos que
// sirven para renderizar el botón y armar la request de select-tenant.
export interface TenantChoice {
  readonly slug: string;
  readonly name: string;
}
