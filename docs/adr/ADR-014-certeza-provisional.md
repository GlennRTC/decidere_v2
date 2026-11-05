# ADR-014: Certeza provisional (completitud, margen, conflicto) y bandera `requires_confirmation`
**Fecha:** 2026-11-05
**Estado:** propuesto

**Contexto:**
F047 pide la certeza determinística de ADR-003: tres componentes devueltos por separado, su mínimo, y un crítico que nunca se degrada. Hasta hoy `results[].certainty` era `null`. Sin decidir las definiciones, las bandas y la bandera, F048 (enrutamiento con τ) y F049 (calibración) no tienen qué consumir. Todo lo de abajo es provisional y no tiene validación clínica.

**Decisión:**
1. **Función pura** `computeCertainty` en `engine/src/certainty.ts` (sin I/O, sin dependencias). Lee el conjunto de reglas, la traza y la `ClassDecision`; nunca cambia la clase. Constantes: `CERTAINTY_VERSION = "certainty-provisional-2"`, `TAU_PROVISIONAL = 0.5`, `VARIABLE_BANDS`.
2. **Certeza = mínimo de tres componentes**, cada uno en [0,1], devueltos por separado (ADR-003):
   - **Completitud** por regla: si la raíz es `atLeast`, `1 - u / (t + u + f)` de la entrada raíz de la traza (denominador = criterios, hijos de la raíz; SIRS 4, qSOFA 3). Si no, hojas conocidas / hojas totales. Valor del caso = mínimo sobre las reglas.
   - **Margen**: por hoja conocida, `min(1, |observado - umbral| / banda[variable])`. Para variables de escala entera (hoy solo `gcs`, conjunto provisional `INTEGER_SCALE`) la distancia se mide al borde semientero entre el último valor verdadero y el primero falso: `umbral - 0.5` para `<` y `>=`, `umbral + 0.5` para `<=` y `>`, el umbral para `==`. Con `gcs < 15` y banda 1: GCS 15 da 0.5, GCS 14 da 0.5, GCS 13 da 1. La versión `certainty-provisional-1` medía contra el umbral y daba margen 0 con GCS 15 (el mejor valor, falso, justo en el umbral), por lo que todo caso normal completo tenía certeza 0 y un crítico con GCS 15 medido recibía la bandera mientras el mismo paciente sin GCS no (invertido); corregido en `-2`. Valor del caso = mínimo sobre las hojas conocidas de todas las reglas; sin hojas conocidas da 1 (la pérdida ya la lleva la completitud). Una variable sin banda da 0 (falla conservador).
   - **Conflicto**: `(reglas con la misma clase que la decidida) / (número de reglas)` desde `ClassDecision.basis`; una regla da 1.
3. **Bandas provisionales** (una por variable): `resp_rate` 4 `/min`, `sbp` 10 `mm[Hg]`, `gcs` 1 `{score}`, `heart_rate` 10 `/min`, `temperature` 0.5 `Cel`, `wbc` 2 `10*3/uL`, `paco2` 4 `mm[Hg]`, `bands_pct` 2 `%`. **Sin validar.**
4. **τ y bandera:** `TAU_PROVISIONAL = 0.5`, exportado y pasado como parámetro. `below_tau = valor < τ`. `requires_confirmation = (clase == crítico) && below_tau`; solo un crítico puede recibirla.
5. **Cambio de contrato de la respuesta** de `POST /v1/messages`, por elemento de `results[]`: `certainty` pasa de `null` a un objeto (componentes, valor, `tau`, `below_tau`, `requires_confirmation`, `provisional: true`, versión) y se agrega `requires_confirmation` (booleano). El log lleva solo el número `certainty.value` (permitido en AGENTS.md "Logging"), nunca los componentes. Un test existente (`interpret.test.ts`, aserción `certainty === null`) se editó con aprobación del usuario.
6. **Fuera de este ADR:** τ por variable de entorno y enrutamiento de no críticos a `revisión clínica` (F048); calibración (F049); activar SIRS (sigue bloqueada por la política de clase, no por la certeza: ADR-013, ADR-010 punto 5).

**Alternativas consideradas:**
- Promedio ponderado o producto de los componentes — esconde qué componente es bajo y contradice ADR-003.
- Bandas en `knowledge/` como datos versionados — más correcto a futuro (ADR-002), pero excede F047; hoy viven en el código con versión.
- Margen solo sobre las hojas que determinan la clase — ver pregunta 3; no se eligió sin criterio clínico.

**Consecuencias:**
- Mejora: componentes visibles y verificables; un crítico conserva su clase siempre (test de propiedad sobre las 27 combinaciones de qSOFA).
- Más difícil: el cambio de forma de la respuesta obliga a consumidores y UI a manejar un objeto; hay que mantener bandas y τ hasta calibrar.
- Riesgo aceptado: bandas y τ sin validar; `passing` en F047 significa "implementado y probado", no "clínicamente validado".

**Revisión de seguridad clínica (agente de IA `clinical-informatics-auditor`, NO un clínico; lectura estática; sin bloqueantes para una demo con datos sintéticos):**
- **Falso consuelo (mayor):** qSOFA 0 con todo conocido puede leerse como "sepsis descartada" aunque la certeza sea alta. Hoy el máximo para un caso normal completo es 0.5, porque el margen de GCS está limitado a 0.5 (entero con banda 1); con τ = 0.5 ese caso queda exactamente en el borde (`0.5 < 0.5` es falso). Frágil: cualquier cambio de banda o de τ lo mueve; F048 y F049 deben revisarlo. La certeza es solo confianza en la evaluación de la regla, no una probabilidad ni un porcentaje. Para `sin alerta` la UI debe decir "qSOFA no excluye sepsis" (F062, ADR-010 pregunta 9).
- **Semántica de `requires_confirmation` (mayor):** sin definir para el médico; puede leerse como "menos urgente" y no da motivo. Un crítico con la bandera nunca debe bajar en el orden del dashboard: "confirmar a la cabecera; tratar como crítico hasta entonces". Los tests de F048/dashboard deben fijar ese orden. Falta un `confirmation_reason` de vocabulario cerrado (`low_margin` | `low_completeness`).
- **Margen sobre todas las hojas conocidas (mayor):** incluye hojas que no contribuyen. Un crítico firme (FR 30, PAS 80) puede marcarse por una hoja irrelevante (con la corrección, GCS 14 o 15 da margen 0.5, sin marcar con τ 0.5), o una hoja falsa PAS 101 está en el borde; la bandera no tiene que ver con por qué es crítico (fatiga de alertas). Alternativa: margen sobre las hojas que determinan el resultado. Decide el clínico.
- **Bandas no defendibles ni validadas (mayor; opinión del auditor, no verificada):** FR 4 (el signo vital menos fiable), GCS 1 (entero; la variabilidad entre evaluadores es ~1; con el margen al borde semientero GCS 14 y 15 dan 0.5 y solo GCS <= 13 da margen completo); las bandas de `heart_rate`, `wbc`, `paco2` y `bands_pct` no se ejercitan (ninguna regla activa las usa); una sola banda ignora contexto y artefactos. La regla qSOFA sigue con `clinical_approval` pendiente.
- **Datos faltantes nunca marcan un crítico hoy (menor):** con qSOFA, la completitud toma valores {1, 0.667, 0.333}; un crítico tiene al menos 2 criterios verdaderos, o sea a lo más 1 desconocido, o sea completitud >= 0.667 > τ 0.5. La bandera solo sale por margen (ADR-010 pregunta 3).
- **Sin plausibilidad ni manejo temporal (menor):** FR 300 da margen 1. Registrado como feature nueva (F069).
- **`PolicyError` (menor):** `computeCertainty` lanza `PolicyError("invalid_input")` dentro de `interpretMessage`, el mensaje completo falla y el manejador global (`apps/api/src/app.ts`) lo convierte en 500 `internal_error`, igual que `classify` hoy. Evaluar un modo a prueba de fallos más adelante.
- **Validación de τ (menor):** solo se rechaza NaN. F048 debe validar `0 < τ <= 1` al arrancar; con `τ <= 0` la bandera se desactiva en silencio (falla abierta).
- **PHI/logs (sin bloqueo):** el log lleva solo el número de certeza. Opcional: redondear a 2-3 decimales en log y respuesta. La auditoría de logs no la corrió el revisor (la verificación del implementador sí pasó).
- **Etiquetado regulatorio (mayor):** la UI y la documentación deben mostrar junto a la certeza "Demo con datos sintéticos; no aprobado para uso clínico; conformidad con criterios publicados, validación clínica pendiente"; mostrar `provisional: true`; no llamarla IA, ML, red neuronal, confianza ni probabilidad; usar "red de evaluación de reglas" y "puntaje determinístico de certeza". SaMD (INVIMA/FDA) es requisito previo a uso clínico; faltan CODEOWNERS/aprobación para la política y las bandas (ADR-010 pregunta 6).

**Abiertos tras la revisión final (menores, no corregidos):**
- El nombre `conflict` está duplicado: `CaseResult.conflict` (booleano) y `certainty.conflict` (número).
- El log lleva `certainty.value` sin redondear (flotante de precisión completa).
- Una condición que `combine` no referencia igual cuenta como hoja (completitud y margen).
- Aclaración del criterio 3 de F047: un crítico marcado conserva su clase y NO se reenruta (ADR-003); enviarlo a la cola de revisión es F048/F016.

**Preguntas clínicas abiertas (el clínico debe confirmar):**
1. Qué significa "certeza" y `requires_confirmation`, y que un crítico marcado queda arriba en el ranking.
2. Cada banda y que "margen completo = 1 banda"; bandas por variable frente a una sola; y la rotulación de `sin alerta`.
3. Margen sobre todas las hojas conocidas frente a las que determinan el resultado; si una hoja no contribuyente cerca del umbral debe marcar un crítico.
4. Completitud por criterios frente a hojas (el denominador); si un criterio desconocido en un crítico debe marcarlo.
5. `TAU_PROVISIONAL = 0.5`.
6. El requisito de mejor y peor caso de F047 solo se cubre del lado de escalada con `highest_reachable_class`; no hay una salida explícita de "peor caso".
7. Activar SIRS sigue bloqueado por la política de clase, no por la certeza (ADR-013).

**Handoffs:** F048 (τ por entorno con validación `0 < τ <= 1`, enrutamiento de no críticos a `revisión clínica`, consume `certainty.below_tau`, el orden del dashboard mantiene arriba al crítico marcado); F049 (bandas y `TAU_PROVISIONAL` son entradas de calibración); F069 (rango de plausibilidad); F070 (`confirmation_reason` y textos de la UI).

**Referencias:** ADR-003, ADR-007, ADR-010, ADR-012, ADR-013; `docs/superpowers/plans/2026-11-05-f047-certainty.md`.
