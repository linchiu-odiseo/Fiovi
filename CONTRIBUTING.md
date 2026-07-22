# CONTRIBUTING — Reglas de colaboración en Fiovi

> Este documento define el contrato mínimo que cualquier colaborador (humano o agente IA) debe cumplir para tocar este repo. No son sugerencias; son condiciones para que un cambio sea aceptado.
>
> Si vas a trabajar acá, leé este archivo entero antes de escribir una sola línea de código. Si estás en una sesión de Claude Code, también tenés que respetar [`CLAUDE.md`](./CLAUDE.md) y los docs en [`agents/`](./agents/).

---

## Regla #1 — Todo cambio pasa por SDD (OpenSpec). Sin excepción.

**No se acepta código sin spec previo.** No hay "es un fix chiquito", no hay "es solo un rename", no hay "lo justifico en el commit". Si tocás `src/` o `tests/`, el cambio nace como un OpenSpec change y atraviesa las 8 fases.

### Las 8 fases del workflow SDD

```
┌─────────────┐   ┌────────┐   ┌──────┐   ┌────────┐   ┌───────┐   ┌───────┐   ┌────────┐   ┌─────────┐
│ 1. Explore  │ → │ 2.     │ → │ 3.   │ → │ 4.     │ → │ 5.    │ → │ 6.    │ → │ 7.     │ → │ 8.      │
│ (opcional)  │   │ Propose│   │ Spec │   │ Design │   │ Tasks │   │ Apply │   │ Verify │   │ Archive │
└─────────────┘   └────────┘   └──────┘   └────────┘   └───────┘   └───────┘   └────────┘   └─────────┘
```

| #   | Fase        | Skill / comando | Artefacto que produce                           | Cuándo es obligatoria                                                                                                                       |
| --- | ----------- | --------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Explore** | `sdd-explore`   | notas / memory                                  | Opcional. Solo cuando la idea no está clara y hay que investigar el código antes de proponer.                                               |
| 2   | **Propose** | `sdd-propose`   | `proposal.md`                                   | **Siempre.** Sin proposal aprobada no hay change.                                                                                           |
| 3   | **Spec**    | `sdd-spec`      | `specs/<cap>/spec.md` (delta)                   | **Siempre.** Define requisitos formales (capabilities + scenarios).                                                                         |
| 4   | **Design**  | `sdd-design`    | `design.md`                                     | **Siempre que haya decisiones técnicas no obvias.** En cambios triviales puede ser una nota corta, pero el archivo existe.                  |
| 5   | **Tasks**   | `sdd-tasks`     | `tasks.md`                                      | **Siempre.** Checklist accionable y ordenada. Sin tasks no se puede aplicar.                                                                |
| 6   | **Apply**   | `sdd-apply`     | código + tasks marcadas ✓                       | **Siempre.** Esta es la única fase donde se modifica `src/` y `tests/`.                                                                     |
| 7   | **Verify**  | `sdd-verify`    | `verify-report.md`                              | **Siempre.** Valida implementación contra spec/design/tasks. **Aquí corre el gate de `hexagonal-guard` (ver Regla #3).**                    |
| 8   | **Archive** | `sdd-archive`   | `archive-report.md` + merge a `openspec/specs/` | **Siempre.** Cierra el ciclo: mueve el change a `openspec/changes/archive/<YYYY-MM-DD>-<name>/` y mergea los delta specs en las main specs. |

### Reglas duras del workflow

- **No saltar fases.** No se puede ir de Propose directo a Apply. No se puede archivar sin Verify.
- **No tocar `src/` o `tests/` fuera de la fase Apply.** Si descubrís durante Apply que la spec estaba mal, volvés a Spec — no parchás silencioso.
- **Un change = un objetivo.** Si en medio de Apply aparece otro problema, NO lo arregles "de paso". Abrí otro change. Commits quirúrgicos (≤ 8 archivos) — ver [`agents/coding-style.md`](./agents/coding-style.md).
- **El change activo vive en `openspec/changes/<name>/`.** Una vez archivado, se mueve a `openspec/changes/archive/<YYYY-MM-DD>-<name>/`. Ver ejemplos en esa carpeta.
- **Si necesitás un fix urgente sin spec previo** (incidente en prod, build roto): igual abrís un change, aunque sea minimal (proposal de 5 líneas + spec delta + tasks). El workflow no es burocracia, es trazabilidad.

### Gate de PR — todos los changes archivados

**Un Pull Request no se abre (ni se mergea) si queda algún change activo en `openspec/changes/`.** Activo = cualquier carpeta directa bajo `openspec/changes/` que no sea `archive/`. Si la encontrás, significa que el ciclo SDD no está cerrado: falta Verify, falta Archive, o quedaron tasks sin marcar.

Antes de abrir el PR, validá:

```bash
# Tiene que listar SOLO la carpeta "archive". Si hay cualquier otra, el PR no entra.
ls openspec/changes/
```

Reglas concretas:

- **PR con un solo change:** el change tiene que haber pasado por `sdd-archive` y estar bajo `openspec/changes/archive/<YYYY-MM-DD>-<name>/`. El PR incluye el código + el archive completo + el merge de delta specs en `openspec/specs/`.
- **PR que toca varios changes:** todos archivados. No se acepta "este lo archivamos después del merge". Si querés mergear de a tandas, abrí un PR por change.
- **Excepción única — release branch / cut-over coordinado:** si el equipo decide explícitamente mantener un change activo en la rama para terminarlo después del merge, tiene que quedar registrado en la descripción del PR con motivo y dueño. Sin ese acuerdo escrito, el reviewer rechaza.
- **El reviewer chequea esto antes que cualquier otra cosa.** Si hay change activo, devuelve el PR sin revisar el diff.

---

## Regla #2 — Respetar la arquitectura y los estilos del proyecto

Fiovi es **hexagonal estricta en 4 capas**. Romper boundaries no es deuda menor — es deuda arquitectónica que paga compuesto.

### Lo no negociable

1. **Boundaries hexagonales.** L1 no importa nada interno. L2 solo L1. L3 importa L1+L2+Angular. LR importa L1+L2 y solo **guards** de L3 (nunca adapters HTTP/storage). Tabla completa y antipatrones en [`agents/architecture-rules.md`](./agents/architecture-rules.md).
2. **L1 y L2 son TypeScript puro.** Cero `@angular/*`, cero `rxjs`, cero browser APIs (`localStorage`, `window`, `fetch`…). Si lo necesitás, hay un puerto faltante.
3. **Clasificación de errores HTTP por `(status, endpoint, code)` — nunca por texto del `message`.** El `code` se lee SOLO si está en el zod del contrato learnex. Detalle en [`agents/api-contract.md`](./agents/api-contract.md).
4. **Cookies HttpOnly + `withCredentials: true` vía el único interceptor** en `src/L3_periphery/interceptors/credentials.interceptor.ts`. Cero `Authorization: Bearer`, cero `X-API-Key`.
5. **Strings de UI en español (es-PE) hardcoded. Código en inglés.** I18n diferida.
6. **Tenant slug parametrizado.** Viene de `environment.tenantSlug`. Cualquier mención literal de `"vonex"` en `src/` está prohibida. URLs `/t/{slug}/...` se arman vía `src/L3_periphery/http/api-paths.ts`.
7. **Naming, organización, comentarios, convención de commits.** Ver [`agents/coding-style.md`](./agents/coding-style.md).
8. **Vocabulario de dominio consistente.** Antes de inventar un término nuevo, revisá [`agents/domain-glossary.md`](./agents/domain-glossary.md).

### Checklist técnico antes de pedir review

- [ ] `ls openspec/changes/` muestra **solo** `archive/`. Cero changes activos. (Ver [Gate de PR](#gate-de-pr--todos-los-changes-archivados).)
- [ ] `npm run lint` pasa limpio (0 errores, 0 warnings).
- [ ] `npm test` pasa con cobertura ≥ objetivos (L1 ≥ 90%, L2 ≥ 80%, LR ≥ 60%).
- [ ] `npm run format:check` pasa.
- [ ] Ninguna entidad nueva es anémica.
- [ ] Ningún mapper traduce DTO ↔ entidad con la misma forma.
- [ ] Tests no matchean strings de mensajes HTTP del backend.

---

## Regla #3 — `hexagonal-guard` es obligatorio. `frontend-builder` y `test-engineer` son recomendados.

El repo tiene 3 subagentes especializados, definidos en [`.claude/agents/`](./.claude/agents/). Están ahí porque hacen un trabajo que Claude Code generalista hace peor o más lento. De los tres, **solo `hexagonal-guard` es bloqueante**; los otros dos son recomendaciones fuertes según lo que toque el change.

### Los 3 subagentes

| Subagente              | Cuándo usarlo                                                                                                                                                | Obligatoriedad                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| **`hexagonal-guard`**  | Auditor read-only de boundaries hexagonales. Detecta imports cruzados que ESLint no atrapa, entidades anémicas, mappers ceremoniales, use cases passthrough. | **OBLIGATORIO antes de `sdd-archive`. Bloqueante.**                                                                |
| **`frontend-builder`** | Implementa LR_render: pages, components, view-models con Signals, Reactive Forms, routing.                                                                   | Recomendado cuando el change toca `src/LR_render/`. No bloqueante.                                                 |
| **`test-engineer`**    | Escribe tests Vitest (L1+L2 puros, L3+LR con TestBed/HttpTestingController).                                                                                 | Recomendado cuando el change agrega/modifica entidad, value-object, use case, adapter o componente. No bloqueante. |

### El gate de `hexagonal-guard` (bloqueante)

Durante la fase **`sdd-verify`** (#7 del workflow), corre `hexagonal-guard` sobre los archivos tocados por el change. Si reporta cualquier violación:

- **Violación dura** (import cruzado L1→L2, browser API en L1/L2, LR→adapter de L3): se arregla. El change **no puede pasar a `sdd-archive`** hasta que `hexagonal-guard` salga limpio.
- **Violación blanda** (entidad anémica, mapper ceremonial, use case passthrough): se arregla o se justifica explícitamente en `verify-report.md` con un párrafo del por qué. Sin justificación, **no se archiva**.

`hexagonal-guard` es **read-only** — solo reporta. El fix lo hace el implementador (vos, `frontend-builder`, o `jd-fix-agent` si el repo lo usa).

### Cuándo NO usar un subagente

- Si la tarea es un rename trivial o un fix de typo: no spawneás `frontend-builder` para eso, lo hacés directo. Pero igual abrís el change SDD (Regla #1).
- Si vas a leer 3 archivos puntuales: usás `Read` directo, no spawneás `Explore`.

El criterio es: **subagentes para protección de boundaries o paralelismo real, no como decoración.**

---

## Resumen ejecutivo (si solo lees una sección, leé esta)

1. **SDD obligatorio.** 8 fases: Explore (opcional) → Propose → Spec → Design → Tasks → Apply → Verify → Archive. Sin spec no hay código.
2. **Gate de PR.** Antes de abrir un PR, `ls openspec/changes/` tiene que mostrar solo `archive/`. Cero changes activos.
3. **Arquitectura hexagonal estricta.** L1/L2 puros. Boundaries no se cruzan. Reglas en [`agents/architecture-rules.md`](./agents/architecture-rules.md).
4. **`hexagonal-guard` corre en Verify y es bloqueante para Archive.** `frontend-builder` y `test-engineer` se usan según lo que toque el change.

Cualquier cambio que rompa una de estas cuatro reglas se rechaza y se reabre como nuevo change con SDD correcto.
