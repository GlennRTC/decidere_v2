# Seeds sintéticos (F018)

Casos sintéticos para el runner e2e (F050). Resultado de referencia: **conformidad con criterios publicados; validación clínica pendiente**. Con menos de 100 seeds (hoy 46) ninguna cifra derivada es estadística.

**Estado: PROVISIONAL.** Las etiquetas las escribió el equipo de ingeniería con etiquetadores placeholder (`placeholder-A`, `placeholder-B`, sin árbitro) y la aprobación clínica está pendiente (`clinical_approval.status: "pending"`). No son un gold standard: el doble etiquetado real y el kappa son de F019/F051.

## Archivos

- `cases.json`: un `SeedFile`.
- `build.ts`: tipos (`SeedFile`, `SeedCase`, ...), `opaqueId` y `buildMessage(case)`, que arma un mensaje del contrato 1.1 listo para `POST /v1/messages`. F050 debe consumir estos dos archivos.

## Formato

`SeedFile`: `labeling` (siempre `"provisional"`), `labelers` (`a`, `b`, `adjudicator`; hoy placeholders y `null`), `clinical_approval` (`status` `pending|approved`, `approver`), `cases[]`.

`SeedCase`:

| Campo | Significado |
|---|---|
| `id` | slug legible y único (p. ej. `pos-rr-sbp-01`) |
| `category` | `clear_positive`, `clear_negative`, `boundary`, `missing_data`, `contradictory` |
| `expected_class` | `critical`, `watch`, `no_alert` o `review`; es de la primera (única) instancia `current` |
| `criterion` | criterio citado: qSOFA (Singer 2016, Box 4) y fila de la tabla de ADR-010 |
| `note` | opcional, texto corto sin datos de personas |
| `instances[]` | `kind` `current` (una por caso) o `historical`; `vitals[]` con `code` (`RR`, `SBP`, `GCS`), `value` (número o `null` si falta), `unit`, `t_offset_min` opcional |

Los tiempos son solo offsets relativos en minutos (`t_offset_min <= 0`, enteros); nunca fechas ni texto libre.

## Regla de etiquetado

qSOFA (Singer 2016, Box 4): FR >= 22/min, TAS <= 100 mm Hg, Glasgow < 15. T = criterios cumplidos, U = desconocidos (dato faltante), de 3. Clase según la tabla de ADR-010:

| T / U | clase |
|---|---|
| T>=2 (cualquier U) | `critical` |
| T=1, U=0 | `watch` |
| T=1, U>=1 | `review` |
| T=0, U>=2 | `review` |
| T=0, U=1 | `review` |
| T=0, U=0 | `no_alert` |
| todo desconocido | `review` |

Los etiquetadores NO deben consultar el motor ni la API: etiquetan con la guía y la tabla. Un test (`tests/seeds-cases.test.ts`) compara cada etiqueta con un oráculo independiente que no importa el motor.

## Cómo agregar un caso

1. Elegir categoría y escribir el caso en `cases.json` con `id` nuevo y único, signos vitales sintéticos y offsets relativos.
2. Etiquetar a mano con la tabla de arriba, sin ejecutar el motor; citar el criterio en `criterion` (Singer 2016 y la fila de ADR-010).
3. No cambiar la clase esperada de un seed para que pase: si discrepa del motor, primero se decide si el error está en el motor o en la etiqueta.
4. `npm run verify` y `npm run scan:phi`.

Nunca datos de personas reales, ni derivados de MIMIC o PhysioNet. El hook PHI no se evade; si bloquea, usar un dato sintético.

## Ids opacos

`opaqueId` deriva UUID con forma v4 desde SHA-256 de `<tipo>:<id del caso>:<índice>`. Es determinístico a propósito: los mismos seeds producen siempre los mismos `message_id` e `instance_id`, lo que hace repetibles el runner y la idempotencia. Consecuencia: es un seudónimo reversible por diccionario, aceptable solo porque los datos son sintéticos; no reutilizar el formato con ids reales de un emisor.

## Casos límite frente a la capa de certeza

Los seeds `boundary` cercanos al umbral (FR 21, TAS 101-104, etc.) se etiquetan por los criterios publicados. La capa de certeza (ADR-015, τ = 0.5 provisional) enruta a `revisión clínica` los `no_alert` y `watch` con valores a menos de media banda de un umbral, de modo que el motor puede devolver `review` donde la etiqueta dice `no_alert` o `watch`. No es un error del motor ni un acierto: es una divergencia conocida entre dos capas.

- F050 deriva estas divergencias solo (categoría `boundary` con esperado `watch` o `no_alert` y resultado `revisión clínica`), las reporta aparte y NO reetiqueta.
- Un `boundary` crítico conserva su clase (ADR-003; recibe `requires_confirmation`), así que no diverge.
- Un seed esperado `critical` que cae en revisión sí hace fallar el runner (ADR-010, F050).

## Fuera de alcance

Seeds SIRS (la regla está inactiva), seeds temporales de peor valor frente al último (pendiente, ADR-010 pregunta 8), doble etiquetado real y kappa (F019/F051). Ver `docs/adr/ADR-016-seeds-sinteticos-provisionales.md`.
