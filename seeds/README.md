# Seeds sintéticos (F018)

Casos sintéticos para el runner e2e (F050). Resultado de referencia: **conformidad con criterios publicados; validación clínica pendiente**. Con menos de 100 seeds (hoy 46) ninguna cifra derivada es estadística.

**Estado: PROVISIONAL.** Las etiquetas las escribió el equipo de ingeniería con etiquetadores placeholder (`placeholder-A`, `placeholder-B`, sin árbitro) y la aprobación clínica está pendiente (`clinical_approval.status: "pending"`). No son un gold standard: el doble etiquetado real y el kappa son de F019/F051.

## Archivos

- `cases.json`: un `SeedFile`.
- `build.ts`: tipos (`SeedFile`, `SeedCase`, ...), `opaqueId` y `buildMessage(case)`, que arma un mensaje del contrato 1.1 listo para `POST /v1/messages`. El runner (F050) consume estos dos archivos.

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

Los seeds `boundary` cercanos al umbral (FR 21, TAS 101-104, etc.) se etiquetan por los criterios publicados. La capa de certeza (ADR-015, τ = 0.5 provisional) enruta a `revisión clínica` los `no_alert` y `watch` con valores a menos de media banda de un umbral por AMBOS lados (lado sin alerta: FR 21 y TAS 101-104; lado vigilancia: FR 22 y 23, TAS 96-100), de modo que el motor puede devolver `review` donde la etiqueta dice `no_alert` o `watch`. No es un error del motor ni un acierto: es una divergencia conocida entre dos capas.

- El runner (F050) deriva estas divergencias de la RESPUESTA, no de la categoría: esperado `watch` o `no_alert`, resultado `revisión clínica`, `routed_from` igual a la clase esperada y `reason_code` `low_certainty`. Sirve para cualquier categoría y cualquier τ, y también atrapa `con-sbp-low-01` (caso contradictorio). Las reporta aparte y NO reetiqueta.
- Línea base medida con el motor real en τ = 0.5 (por defecto): 9 de 46 seeds se enrutan a `revisión clínica` con `routed_from` igual a la clase esperada: bnd-rr-21-01, bnd-rr-22-01, bnd-sbp-101-01, bnd-sbp-100-01, bnd-21-101-15-01, bnd-22-101-15-01, bnd-21-101-14-01, bnd-21-100-15-01, con-sbp-low-01. Los 16 seeds esperados `critical` se devuelven como `crítico` en τ 0.4, 0.5 y 0.6. En τ = 0.6 todo caso completo con Glasgow 15 que sea `sin alerta` o `vigilancia` (certeza exactamente 0.5) se enruta: 23 divergencias, incluidos 8 de 8 `clear_negative`, por el salto estructural de τ de ADR-015. El reporte imprime τ en el encabezado, junto con las marcas provisionales.
- Un `boundary` crítico conserva su clase (ADR-003; recibe `requires_confirmation`), así que no diverge.
- Un seed esperado `critical` que cae en revisión sí hace fallar el runner (ADR-010, F050); con el motor real esa ruta no es alcanzable (un crítico nunca va a revisión) y solo la cubren los tests unitarios.

## Cómo correr el runner

`npm run seeds:run [archivo]` (por defecto `seeds/cases.json`) levanta la API, envía cada seed a `POST /v1/messages` y imprime el reporte (cobertura, sensibilidad de crítico, conformidad con criterios publicados, divergencias por certeza). Estado: provisional.

Variables de entorno:
- `SEED_API_URL`: si existe, no se levanta servidor y se usa esa URL; τ se imprime desde la respuesta del servidor y, si no viene, como `desconocido` (servidor externo).
- `SEED_API_KEY`: se envía en la cabecera `x-api-key` (nombre provisional; la API no la verifica hasta F052). Nunca se imprime.
- `CERTAINTY_TAU`: τ del servidor levantado; solo se pasa si está definida y no vacía (si no, el servidor usa su valor por defecto, `0.5`). El encabezado imprime el τ que informa la respuesta.

Códigos de salida: `0` todo cubierto, ningún crítico esperado fuera de `crítico` y sin discrepancias sin explicar; `1` un crítico esperado devolvió otra clase (incluida `revisión clínica`), cobertura menor a 100% o una discrepancia sin explicar; `2` el runner no pudo correr (servidor no arranca, URL inalcanzable, archivo de seeds ilegible, vacío o con ids repetidos), con un mensaje fijo y sin payloads. El modo continuo (F021) no está construido.

## Barrido de τ (calibración, no validación)

`npm run seeds:tau [archivo]` (por defecto `seeds/cases.json`) levanta un proceso de la API por cada τ de la rejilla 0.1 a 1.0 en pasos de 0.1 y reporta la curva "% a revisión frente a τ" con la seguridad de los críticos. Es calibración, no validación; τ provisional, no validado. Resultados y decisiones abiertas: `docs/adr/ADR-017-barrido-de-tau-con-seeds.md`.

- `--candidate <τ>`: τ a evaluar con la regla provisional de estabilidad (por defecto `TAU_PROVISIONAL`, 0.5).
- `--held-out`: lee el subconjunto reservado. Se lee UNA vez, después de elegir τ con el usuario y un clínico.
- Regla de partición: hash del id del caso, cerca de 30 % reservado, determinística; los ids reservados nunca se imprimen por defecto.
- Códigos de salida: `0` sin problemas; `1` un crítico no detectado o un caso sin cobertura en algún τ: señal binaria sobre TODOS los seeds, incluidos los reservados (no indica en cuál subconjunto); `2` no pudo correr.

## Fuera de alcance

Seeds SIRS (la regla está inactiva), seeds temporales de peor valor frente al último (pendiente, ADR-010 pregunta 8), doble etiquetado real y kappa (F019/F051). Ver `docs/adr/ADR-016-seeds-sinteticos-provisionales.md`.
