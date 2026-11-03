# ADR-007: Evaluador de condiciones de las reglas
**Fecha:** 2026-11-03
**Estado:** aceptado

**Contexto:** ADR-002 dejó el formato de condiciones sujeto al spike F033 (json-logic), con un comparador propio como plan B. El evaluador es el núcleo de seguridad del sistema: un dato faltante tratado como "falso" puede ocultar un crítico, y cada condición debe aparecer en la traza que lee el médico. El spike probó `json-logic-engine` 5.0.7 y un comparador propio con los mismos casos y un oráculo de fuerza bruta. Los valores de prueba son sintéticos. Los umbrales de los fixtures son solo mecánica: no son reglas clínicas ni una transcripción de qSOFA/SIRS, que se hace en F038/F045 con aprobación clínica pendiente.

**Decisión:**
- Las condiciones se evalúan con un comparador propio, sin dependencias, en `engine/`. No se usa json-logic.
- Semántica de tres valores `true | false | unknown` (Kleene). Un valor ausente, `null`, `""`, no numérico, NaN o infinito da `unknown` con motivo `missing` o `invalid`. El 0 es un valor. Un string numérico (`"3"`) no se convierte.
- Combinadores `all`, `any`, `not` y `atLeast {n, of}`. `atLeast` es verdadero si T ≥ n, falso si T + U < n y desconocido en otro caso. La traza lleva T, U, F, mínimo y máximo (insumo de F047). Invariante: si el mejor caso alcanza el umbral, la clase nunca es `sin alerta`.
- Se evalúan todas las condiciones, sin cortocircuito. La traza las lista en el orden de declaración del YAML, con un id estable escrito en la regla.
- Operadores: tabla cerrada `>`, `>=`, `<`, `<=`, `==`. No hay `eval` ni `Function`. Un operador o variable desconocidos, ids duplicados, vacíos o no string, y referencias inexistentes se rechazan al cargar (un rule set inválido impide el arranque), con errores que no repiten valores. Hay un límite de anidamiento (en el spike, 64; valor por confirmar).
- Formato YAML plano: una condición por bloque (id, etiqueta en español, variable, operador infijo, valor, unidad) y una sección `combine` (ver ejemplo en el apéndice B).
- Vocabulario: interno `true/false/unknown`. La UI muestra "cumple / no cumple / sin dato" (F062/F024), y "sin dato" nunca comparte forma ni color con "no cumple".
- La conversión de unidades y el redondeo ocurren en el mapper, no en el evaluador.
- No se decide aquí: umbrales, límites de plausibilidad, mínimo de completitud para `sin alerta`, ventana de antigüedad de un dato y cómo se combinan los criterios (F038, F045, F047, con el clínico).

**Alternativas consideradas:**
- `json-logic-engine` 5.0.7 (MIT; un solo mantenedor en npm; 9 issues abiertos; último release 2026-04-01; sin dependencias; compila las reglas con `eval` global).
  - Sin wrapper falla las filas 1–4: `x < 3` da `true` con un valor ausente, no hay Kleene, `and`/`or` cortocircuitan sin traza y no existe `atLeast`.
  - Con wrapper pasa, pero el wrapper (44 líneas, sin validación equivalente) hace la lógica y el motor solo una comparación.
  - Se descarta: añade una dependencia, la superficie de `eval` y el riesgo de un solo mantenedor, sin aportar la lógica que importa.
  - Condicional de seguridad: si algún día las reglas llegan en runtime (carga de reglas, edición por el rol "experto", contenido en base de datos), el `eval` sería un vector de inyección. Hoy las reglas son YAML revisado por PR.
- `json-logic-js` 2.0.5 (MIT; último release 2024-07; 84 issues abiertos). En un sondeo previo de 17 casos tuvo la misma semántica ante datos faltantes que el motor. No se probó más.
- CQL: descartado en ADR-002.

**Consecuencias:** Mejora el control de la semántica, la traza completa y la ausencia de dependencias.
- Somos dueños de unas 70 líneas de lógica crítica. Se cubren con tabla de verdad, fuzz contra el oráculo y mutaciones. Todo operador nuevo requiere un PR con tests, que es el punto de revisión clínica.
- El formato propio exige un cargador YAML y una vista legible para clínicos (F037).
- Los ids de los combinadores son rutas posicionales (`combine`, `combine.0.1`): insertar un hijo desplaza los ids posteriores y ensucia la comparación entre versiones (F062). Mitigación: un id opcional escrito en la regla.
- La verificación del spike usó objetos en memoria, solo Node 26 y no YAML real. No se ejecutaron para el motor las filas de determinismo, seguridad y tamaño, por la regla de parada.
- El límite de anidamiento (64) es arbitrario hasta ver reglas reales.

## Implementación

- El código vive en `engine/` (`defineRuleSet`, `evaluateRuleSet`, `RuleSetResult`); el Apéndice C pasa a ser histórico.
- Límite de anidamiento 64, con la raíz en profundidad 0, fijado por test en `engine/src/define.test.ts`.
- Los ids de traza de combinadores `combine` y `combine.N` están reservados: un id de condición no puede usarlos.
- Límite conocido: Kleene es exacto solo si cada hoja aparece una vez por regla. Con una hoja repetida el resultado puede ser "unknown" donde existe un valor definido (p. ej. `all[a, not a]`, `any[a, not a]`). Nunca produce un valor definido erróneo, así que el error va hacia revisión. Quien redacte reglas no debe repetir una condición dentro de una regla.
- Siguen en F037: el cargador YAML, la mitigación de ids posicionales y las notas de redacción.

## Apéndice A: resultados del spike (Node v26.3.0, tsc 7.0.2, json-logic-engine 5.0.7)

| Fila | Candidato | Resultado | Evidencia |
|---|---|---|---|
| 1 dato faltante/basura → unknown | comparador | PASA | `x<3` con ausente/null/""/"abc"/"3"/NaN/Infinity; 0 se evalúa |
| 1 | motor sin wrapper | FALLA | `x<3` da true con ausente/null/""; "abc" y NaN lanzan un valor no-Error |
| 1 | motor + wrapper | PASA | el wrapper valida cada hoja |
| 2 Kleene | comparador | PASA | tabla A/B/C |
| 2 | motor sin wrapper | FALLA | `A and B` = false; `not B` = true |
| 3 traza completa | comparador | PASA | todas las hojas, en orden de declaración |
| 3 | motor sin wrapper | FALLA | cortocircuito devuelve un operando; sin API de traza |
| 4 atLeast + fuzz 3³ y 3⁴ vs oráculo | comparador | PASA | una mutación (`t+u<n` → `t<n`) rompe 4 tests |
| 4 | motor sin wrapper | FALLA | no hay atLeast; la suma con todo faltante da 0 |
| 5 determinismo | comparador | PASA | 1000 corridas = 1 hash; segundo proceso mismo sha256; claves reordenadas = salida idéntica |
| 6 bordes y decimales | comparador | PASA | (v−1, v, v+1) para los 5 operadores; 38.0/38.1/36.0/35.9 |
| 6 flotantes | comparador | documentado | (100.4−32)·5/9 === 38 exacto: `> 38` es false; `==` sobre flotantes derivados no recomendado |
| 7 validación de reglas | comparador | PASA, con 2 bugs corregidos | ver abajo |
| 7 prototipos (`__proto__`, `constructor`) | comparador | PASA | búsqueda por propiedad propia |
| 8 tamaño | comparador | 70 líneas (73 con correcciones) | |
| 8 tamaño | wrapper del motor | 44 líneas, sin validación equivalente | |
| 8 tipos estrictos | comparador | PASA | tsc 7 con la config base del repo |
| 8 costo de validar | comparador | 0,012 ms por evaluación (50 condiciones) | |
| 5, 7, 8 | motor | NO EJECUTADO | regla de parada |

Bugs encontrados en el comparador: aceptaba ids que no son string o vacíos, y una cadena de `not` de profundidad 10 000 daba `RangeError` en vez de un error de validación. Ambos están corregidos en el código del apéndice C.

**¿Discriminó el spike?** Solo en parte. La pregunta del motor se decidió en la fila 1 y en Kleene. Las filas 5–8 confirman que el comparador es viable, no comparan candidatos.

**No verificado:** filas 5, 7 y 8 del motor (inyección por `eval`, lista de operadores permitidos, tipos, tamaño); reglas cargadas desde YAML real; versiones de Node distintas de la 26; cualquier umbral, unidad o transcripción clínica; el mapper (aún no existe); rendimiento más allá de 50 condiciones; enteros mayores que 2^53 y `-0`.

## Apéndice B: formato YAML de ejemplo (forma de qSOFA, solo ilustrativo; no son reglas clínicas)

```yaml
conditions:
  - { id: fr_alta,  label: "Frecuencia respiratoria alta",   variable: resp_rate, op: ">=", value: 22,  unit: "/min" }
  - { id: ta_baja,  label: "Presión sistólica baja",         variable: sbp,       op: "<=", value: 100, unit: "mm[Hg]" }
  - { id: gcs_bajo, label: "Alteración del estado mental",   variable: gcs,       op: "<",  value: 15,  unit: "{score}" }
combine: { atLeast: { n: 2, of: [fr_alta, ta_baja, gcs_bajo] } }
```

## Apéndice C: comparador del spike con las dos correcciones (73 líneas)

Código tal cual quedó en el spike (desechable; no se conserva en el repo). Los tipos (`Tri`, `Rule`, `Node`, `TraceEntry`, `Evaluator`) y el oráculo de fuerza bruta no se incluyen: la semántica de `oracle` es "enumerar todas las asignaciones true/false de los desconocidos; si todas dan el mismo resultado, ese; si no, `unknown`".

```ts
// Plan B: dependency-free condition evaluator. Closed operator table, no eval/Function, no short-circuit.
import type { Evaluator, Node, Rule, Tri, TraceEntry } from "./oracle.ts";

const OPS = new Map<string, (a: number, b: number) => boolean>([
  [">", (a, b) => a > b], [">=", (a, b) => a >= b], ["<", (a, b) => a < b], ["<=", (a, b) => a <= b], ["==", (a, b) => a === b],
]);
const MAX_DEPTH = 64;
const KINDS = ["all", "any", "not", "atLeast"] as const;

// Load-time checks. Errors name positions only, never the offending values.
export function validateRule(rule: Rule, variables?: ReadonlySet<string>): void {
  const ids = new Set<string>();
  rule.conditions.forEach((c, i) => {
    if (typeof c.id !== "string" || c.id === "") throw new Error(`rule: invalid id in condition #${i}`);
    if (!OPS.has(c.op)) throw new Error(`rule: unknown operator in condition #${i}`);
    if (typeof c.value !== "number" || !Number.isFinite(c.value)) throw new Error(`rule: non-finite value in condition #${i}`);
    if (ids.has(c.id)) throw new Error(`rule: duplicate id at condition #${i}`);
    ids.add(c.id);
    if (variables && !variables.has(c.variable)) throw new Error(`rule: unknown variable in condition #${i}`);
  });
  const walk = (n: Node, path: string, depth = 0): void => {
    if (depth > MAX_DEPTH) throw new Error(`rule: nesting too deep at ${path}`);
    if (typeof n === "string") { if (!ids.has(n)) throw new Error(`rule: unknown condition reference at ${path}`); return; }
    const keys = n && typeof n === "object" ? Object.keys(n) : [];
    const kind = KINDS.find((k) => k === keys[0]);
    if (keys.length !== 1 || !kind) throw new Error(`rule: invalid combinator at ${path}`);
    if (kind === "not") return walk((n as { not: Node }).not, `${path}.0`, depth + 1);
    const list = kind === "atLeast" ? (n as { atLeast: { of: Node[] } }).atLeast.of : (n as { all: Node[] })[kind as "all"];
    if (!Array.isArray(list) || list.length === 0) throw new Error(`rule: empty or invalid child list at ${path}`);
    if (kind === "atLeast") {
      const k = (n as { atLeast: { n: number } }).atLeast.n;
      if (!Number.isInteger(k) || k < 1 || k > list.length) throw new Error(`rule: atLeast n out of range at ${path}`);
    }
    list.forEach((child, i) => walk(child, `${path}.${i}`, depth + 1));
  };
  walk(rule.combine, "combine");
}

export const evaluate: Evaluator = (rule, input) => {
  validateRule(rule);
  const trace: TraceEntry[] = [];
  const byId = new Map<string, Tri>();
  for (const c of rule.conditions) { // every condition, declaration order, no skipping
    const raw = Object.hasOwn(input, c.variable) ? input[c.variable] : undefined;
    const ok = typeof raw === "number" && Number.isFinite(raw);
    const result: Tri = ok ? OPS.get(c.op)!(raw, c.value) : "unknown";
    byId.set(c.id, result);
    const e: TraceEntry = { id: c.id, kind: "leaf", result, observed: ok ? raw : null, op: c.op, threshold: c.value };
    if (!ok) e.reason = raw === undefined || raw === null ? "missing" : "invalid";
    trace.push(e);
  }
  const run = (n: Node, path: string): Tri => {
    if (typeof n === "string") return byId.get(n)!;
    const kind = Object.keys(n)[0] as (typeof KINDS)[number];
    if (kind === "not") {
      const r = run((n as { not: Node }).not, `${path}.0`);
      const result: Tri = r === "unknown" ? r : !r;
      trace.push({ id: path, kind, result });
      return result;
    }
    const need = kind === "atLeast" ? (n as { atLeast: { n: number } }).atLeast.n : 0;
    const list = kind === "atLeast" ? (n as { atLeast: { of: Node[] } }).atLeast.of : (n as { all: Node[] })[kind as "all"];
    const rs = list.map((ch, i) => run(ch, `${path}.${i}`)); // evaluate all children, no short-circuit
    const t = rs.filter((r) => r === true).length, u = rs.filter((r) => r === "unknown").length, f = rs.length - t - u;
    const result: Tri =
      kind === "all" ? (f > 0 ? false : u > 0 ? "unknown" : true)
      : kind === "any" ? (t > 0 ? true : u > 0 ? "unknown" : false)
      : t >= need ? true : t + u < need ? false : "unknown";
    trace.push(kind === "atLeast" ? { id: path, kind, result, t, u, f, min: t, max: t + u } : { id: path, kind, result });
    return result;
  };
  return { result: run(rule.combine, "combine"), trace };
};
```
