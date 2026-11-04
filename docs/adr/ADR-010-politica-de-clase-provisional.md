# ADR-010: Política de clase provisional (qSOFA) y clave `severity`
**Fecha:** 2026-11-03
**Estado:** propuesto

**Contexto:** El motor (F005) devuelve por regla `true | false | unknown` con traza, pero no una clase. `RuleSetResult.fired` mezcla `unknown` con `false`, así que no sirve para decidir. Sin una política, F040 no puede responder con una de las cuatro clases (`crítico`, `vigilancia`, `sin alerta`, `revisión clínica`) y un dato faltante podría leerse como "sin alerta". La política de F039 es definida por el equipo (asesoría y revisiones de un agente de IA, `clinical-informatics-auditor`, 2026-11-03; NO es un clínico humano ni un aval clínico), NO está aprobada clínicamente y queda fuera de las métricas hasta que un clínico humano la apruebe y decida (cierra F007). La política NO tiene ventana temporal, no decide qué medición cuenta (última o peor) ni cómo se usan las instancias históricas (ADR-008 las acepta, pero el motor las ignora).

**Decisión:**
- `classify(result, severities)` en `engine/src/policy.ts`: función pura sin I/O ni dependencias. Lee `rules[].result` y `rules[].trace`; nunca `fired`. Identificadores ASCII cerrados `ClassId = critical | watch | no_alert | review`; el mapeo a los nombres en español de la respuesta es de F040/F062.
- Rango para "máxima severidad": `no_alert` 0 < `watch` 1 < `review` 2 < `critical` 3. Un crítico posible en revisión nunca debe verse menos prominente que una vigilancia; un crítico definido gana a la revisión. Empate de clase: decide la regla con mayor clase alcanzable; luego, el orden de `rules` en el resultado, que es el orden por `id` porque el cargador ordena (`defineRuleSet` no ordena).
- Tabla para qSOFA (`severity: critical`; T = criterios cumplidos, U = desconocidos, de 3):

  | T / U | resultado de la regla | clase | `reason_code` | alcanzable |
  |---|---|---|---|---|
  | T>=2 (cualquier U) | true | critical | `rule_true` | critical |
  | T=1, U=0 | false | watch | `partial_criteria` | watch |
  | T=1, U>=1 | unknown | review | `could_escalate` | critical |
  | T=0, U>=2 | unknown | review | `could_escalate` | critical |
  | T=0, U=1 | false | review | `incomplete_for_no_alert` | watch |
  | T=0, U=0 | false | no_alert | `all_criteria_clear` | no_alert |
  | todo desconocido | unknown | review | `could_escalate` | critical |

- Reglas generales por regla con severidad S: `true` -> clase S; `unknown` -> `review` (alcanzable S); `false` con alguna hoja desconocida -> `review` (`incomplete_for_no_alert`; alcanzable `watch` si S es crítica, la raíz es `atLeast` y `max >= 1`, si no `no_alert`); `false` sin desconocidas, S crítica, raíz `atLeast` y `t >= 1` -> `watch`; si no, `no_alert`. Un dato faltante y uno inválido se comportan igual (hoja `unknown`).
- Salida: `class`, `reason_code`, `provisional: true`, `policy_version: "policy-provisional-1"` (constante; cambiar la tabla exige subirla; F040 la guarda con cada interpretación), `highest_reachable_class`, `conflict` (las clases por regla no son todas iguales) y `basis[]` (por regla: resultado, severidad, clase, motivo, `unknown_leaves`, `counts` de la raíz `atLeast`). `requires_confirmation` NO se calcula aquí: es de la certeza (F047, ADR-003).
- Falla cerrada: resultado sin reglas, regla sin severidad o entrada malformada lanza `PolicyError` (códigos cerrados `empty_result`, `missing_severity`, `invalid_input`, mensajes fijos sin ids ni valores); `classify` es total (cualquier otro error se convierte en `invalid_input`). Nunca devuelve `no_alert` por defecto. Una regla `false` sin hojas en la traza es `invalid_input`.
- `severity` es una clave OPCIONAL y aditiva del archivo de reglas v1 (`critical` | `watch`). Entra en `RuleMeta`, y por tanto en `rule_set_version` solo cuando está presente; `LoadedRuleSet.severities` la expone. `knowledge/rules/sepsis.qsofa.v1.yaml` declara `severity: critical`. Sin `format_version: 2`: sería un cambio incompatible y el test existente que rechaza `format_version: 2` quedaría roto. Se editaron solo los fixtures de dos tests de F037 (con aprobación del usuario): `severity` ya no sirve como ejemplo de clave desconocida y pasó a `priority`; las aserciones no cambiaron.
- Redacción del criterio: "tamizaje de alto riesgo (qSOFA >= 2)", nunca "sepsis" (no hay precondición de infección).

**Alternativas consideradas:**
- Archivo de política separado (YAML propio): descartada para v1; los clínicos revisan umbrales y severidad juntos en un solo archivo, y un segundo archivo duplica la superficie de versionado.
- Constantes de severidad en el código: descartada; esconde una decisión clínica fuera de `knowledge/` y de la revisión por PR.
- `vigilancia` como segunda regla qSOFA duplicada (umbral 1): descartada; los umbrales existirían dos veces y podrían divergir.
- `format_version: 2`: descartada por lo ya dicho.

**Consecuencias:**
- Mejora: ningún `unknown` se vuelve `sin alerta`; el invariante de ADR-007 (si el mejor caso alcanza el umbral, nunca "sin alerta") se verifica por software (tests), no clínicamente, sobre las 27 combinaciones de qSOFA y con propiedad de monotonía de `highest_reachable_class`; el cambio de severidad cambia `rule_set_version`.
- Cuesta: es una política de una sola regla (qSOFA). La aprobación de esta política NO está en `clinical_approval` de la regla: aprobar el YAML no debe leerse como aprobar la tabla, que vive en `engine/` (fuera de `/knowledge/` en CODEOWNERS). Propuesta, sin aplicar: entrada de CODEOWNERS para `engine/src/policy.ts`.
- `vigilancia` = qSOFA 1 con todas las entradas conocidas es el principal generador de fatiga de alertas y lo primero que hay que discutir con el clínico.
- Diferencia conocida, no decidida: Seymour et al. imputaron valores normales a los datos faltantes; aquí faltante = desconocido, por lo que las cifras de desempeño publicadas no se transfieren.

- Riesgo aguas abajo: una decisión `review` con `highest_reachable_class: critical` (p. ej. FR 26 con TAS faltante) debe ser visible para el clínico de turno como "posible crítico, datos incompletos" (F015, F023); el rol `usuario` (F058) no debe quedar sin verlo; hay que definir quién revisa y en cuánto tiempo; la cola (F016) se ordena por `highest_reachable_class`, no solo por clase.
- F040 debe fallar el arranque salvo que toda regla activa tenga severidad (`loaded.severities.size === loaded.meta.length`); si no, cada POST sería `internal_error`.
- F050: para seeds esperados `crítico` que caen en `revisión clínica`, la línea de AGENTS.md "casos en revisión se reportan, no se penalizan" NO aplica (AGENTS.md ya recoge esta excepción, aprobada por el usuario): el runner debe salir con código distinto de 0 y reportarlos aparte, etiquetando con `policy_version` provisional y sin presentarlos como hito cumplido.

**Preguntas clínicas abiertas (ninguna decidida aquí; en orden de prioridad):**
1. ¿Aprobar `sepsis.qsofa.v1` aprueba también `severity: critical`, es decir, qSOFA >= 2 como `crítico` sin precondición de infección? SSC 2021 Rec. 2 advierte sobre la baja sensibilidad de qSOFA, no sobre falsas alarmas; bajarlo a vigilancia cambiaría el error inaceptable por menos fatiga.
2. `vigilancia` = qSOFA 1 con todas las entradas conocidas (principal fuente de fatiga).
3. `could_escalate` -> `revisión clínica` (crítico alcanzable) frente a `crítico` con bandera de confirmación.
4. La revisión rankea sobre la vigilancia y puede ocultar una vigilancia definida (queda solo en `basis`).
5. Completitud mínima para `sin alerta`: todas las hojas de la regla conocidas, aunque ya no puedan cambiar el resultado (el cargador rechaza condiciones sin referencia, ADR-002), lo que aumenta la carga de revisión.
6. La aprobación de la política se rastrea aparte de `clinical_approval` de la regla (ver CODEOWNERS arriba).
7. Valores normales imputados por Seymour frente a desconocido aquí.
8. Sin ventana temporal: ¿última o peor medición?, ¿cómo cuentan las instancias históricas?
9. ¿Puede qSOFA 0 con todos los datos conocidos ser `sin alerta` (falsa tranquilidad; SSC 2021 Rec. 2 trata de la baja sensibilidad)? F062: `all_criteria_clear` no se muestra como "normal" ni "descartado". F047/F048: la certeza nunca baja un `review` con crítico alcanzable a vigilancia o sin alerta.

**Referencias:** `docs/superpowers/plans/2026-11-03-f039-class-policy.md`; ADR-002, ADR-003, ADR-007; Singer et al., JAMA 2016;315(8):801-10; Seymour et al., JAMA 2016;315(8):762-74; SSC 2021 (doi:10.1007/s00134-021-06506-y).
