# ADR-015: Enrutamiento a revisión clínica por certeza (τ por entorno)
**Fecha:** 2026-11-05
**Estado:** propuesto

**Contexto:**
ADR-003 manda que un caso de certeza baja vaya a revisión clínica salvo un crítico, que conserva su clase y recibe `requires_confirmation`. F047 (ADR-014) calculó la certeza y la bandera pero no movió ninguna clase. F048 hace el enrutamiento. Todo lo de abajo es provisional: τ, las bandas y la política no tienen validación clínica.

**Decisión:**
1. **Regla de enrutamiento** (`routeByCertainty`, función pura en `engine/src/certainty.ts`): si `certainty.below_tau` (valor < τ, estricto), `vigilancia` y `sin alerta` pasan a `revisión clínica`. `crítico` no se mueve nunca (conserva la clase; la bandera sigue siendo `requires_confirmation`, ADR-014). Una `revisión clínica` que ya viene de la política no se toca.
2. **`routed_from`**: cada elemento de `results[]` lleva `routed_from` (clase original si fue enrutado, `null` si no). La clase original no se pierde.
3. **`reason_code: "low_certainty"`** reemplaza al `reason_code` de la política (p. ej. `partial_criteria`, `all_criteria_clear`) en un caso enrutado. Esa pérdida se acepta por ahora y se difiere a F070 (ver hallazgo 1 de la revisión); alternativa a evaluar allí: conservar el código original en un campo aparte `routed_reason_code`. Es un cambio de contrato de la respuesta (aditivo en `routed_from`, de valor en `reason_code`).
4. **`CERTAINTY_TAU`** (variable de entorno, leída en `apps/api/src/config.ts`, `readTau`): debe cumplir `0 < τ <= 1` con regex decimal estricta; si no, la API no arranca (`invalid configuration`, mensaje fijo). Por defecto `0.5` (`TAU_PROVISIONAL`, provisional). Una cadena vacía cae al valor por defecto en silencio (un `CERTAINTY_TAU=` por error de despliegue se acepta; menor aceptado). τ no se registra al arrancar (no se agrega campo de log); es visible en cada respuesta como `certainty.tau`.
5. **Sin subir versión** de `POLICY_VERSION` ni `CERTAINTY_VERSION`: la clase decidida por la política y la fórmula de certeza no cambian; el enrutamiento es una capa posterior, con τ y `routed_from` visibles en cada respuesta, y la clase original queda en `routed_from`. Si se cambia el borde o la regla de qué se enruta, hay que revisar esta decisión.
6. **Borde τ = 0.5 y qSOFA normal completo:** el máximo de certeza de un caso normal completo es exactamente 0.5 (el margen de GCS está limitado a 0.5, ADR-014). Con `<` estricto queda en `sin alerta`. Es frágil: cualquier cambio de banda o de τ lo mueve. Con la regla qSOFA real y las bandas provisionales, en τ = 0.5 se enruta todo valor a menos de media banda de un umbral: FR 21 (banda 4: margen 0.25) y TAS 101-104 (banda 10: 101 -> 0.1, 104 -> 0.4); el margen de Glasgow está limitado a 0.5 y no se enruta en τ = 0.5. Una vigilancia definida con su criterio positivo en FR 22-23 o TAS 96-100 siempre se enruta. Verificado por el revisor: {FR 16, TAS 101, GCS 15} -> `revisión clínica` (certeza 0.1, `routed_from` `sin alerta`); {FR 14, TAS 120, GCS 15} y {FR 20, TAS 110, GCS 15} siguen `sin alerta` (0.5). Un normal con FR <= 20, TAS >= 105 y GCS 15 sigue `sin alerta`.
7. **Salto de τ por encima de 0.5 (estructural):** Glasgow es una escala entera con banda 1, así que un GCS 15 conocido limita el margen a 0.5. Para cualquier τ en (0.5, 1] un caso completo nunca puede ser `sin alerta`. Medido: 36 `sin alerta` en τ = 0.5 y 0 en 0.5000001; `vigilancia` pasa de 180 a 75; un crítico firme como {30, 80, 15} recibe `requires_confirmation` desde τ = 0.6. El borde 0.5 es por tanto estructural: el criterio de F049 "τ estable ante ±0.1" no puede cumplirse en 0.5 con las bandas actuales, y la fila del informe en τ = 0.6 mostrará 100% de los normales enrutados por diseño, no por calibración. El código NO rechaza τ > 0.5 (decisión de producto abierta): un despliegue con τ = 0.55 enruta en silencio todo `sin alerta` a revisión.
8. **Quién puede cambiar τ:** solo superadministrador o devops, y todo cambio requiere visto bueno clínico registrado en un PR. Es una variable de entorno: quien despliega podría poner τ = 1 e inundar la cola (el crítico seguiría crítico). El valor vigente se ve en cada respuesta (`certainty.tau`).

**Alternativas consideradas:**
- Enrutar solo `sin alerta` y dejar `vigilancia` intacta: evita ocultar una vigilancia definida, pero un `vigilancia` con certeza baja quedaría sin la derivación que ADR-003 pide. No se eligió sin criterio clínico (pregunta 1). Cambiarlo toca `routeByCertainty` y sus tests.
- Subir `POLICY_VERSION`/`CERTAINTY_VERSION`: descartado por el punto 5.
- Crear `.env.example` con `CERTAINTY_TAU`: `.env.example` no existe y crearlo rompe `scripts/init.sh` ("Missing .env") y 3 tests de init-sh. Hoy `CERTAINTY_TAU` se documenta en el encabezado de `apps/api/src/server.ts` y aquí. AGENTS.md dice que los nombres de variables viven en `.env.example`: queda sin cumplir hasta que el usuario decida sobre `.env.example`/`init.sh` (seguimiento).

**Consecuencias:**
- Mejora: ningún caso de certeza baja queda como `sin alerta`/`vigilancia` sin revisión; un crítico nunca baja; τ inválido impide arrancar (falla cerrada).
- **Revisión por encima de vigilancia (ADR-010 pregunta 4):** una `vigilancia` definida puede sustituirse por `revisión clínica`. Mitigaciones: `routed_from`, `highest_reachable_class`, y que la UI (F016/F023/F070) use una insignia `routed_from` y una clave de orden aparte; no debe ordenar ni rotular un caso enrutado como un review `could_escalate`.
- **Volumen de la cola sin medir:** con τ = 0.5, todo valor a menos de media banda de un umbral (FR 21, TAS 101-104) va a revisión. Hay que reportar sobre los seeds el porcentaje enrutado con τ 0.4, 0.5 y 0.6 (F018/F049). Con menos de 100 seeds no es una cifra estadística ni una afirmación de exactitud clínica.
- **Brecha de observabilidad:** la línea `message interpreted` registra la clase enrutada (`revisión clínica`) y no la original; la original solo está en la respuesta (`routed_from`).
- El orden del dashboard debe mantener arriba a un crítico con `requires_confirmation` (F023).
- Redacción obligatoria: "puntaje determinístico de certeza"; nunca IA, ML ni "confianza"; mantener `provisional: true` y el aviso "Demo con datos sintéticos; no aprobado para uso clínico; conformidad con criterios publicados, validación clínica pendiente"; decir en palabras que τ no está validado. `low_certainty`/`revisión clínica` no deben leerse como incertidumbre de un modelo (texto de la UI: F070).
- Menor: la CLASE del crítico nunca cambia por estructura (`routeByCertainty` solo toca `vigilancia`/`sin alerta`). Lo que depende de la aritmética de qSOFA (completitud >= 0.667 para un crítico) es solo si un crítico con datos faltantes recibe `requires_confirmation`, y solo para τ < 0.667; revisar al activar SIRS. `tau` es opcional en `IngestDeps`/`BuildAppOptions` y cae a 0.5 (seguro).

**Revisión de seguridad clínica (agente de IA `clinical-informatics-auditor`, NO un clínico; lectura estática; 0 bloqueantes, 4 mayores documentales/UX, 6 menores):**
1. (Mayor) El caso enrutado pierde el `reason_code` de la política; nada dice qué componente bajó la certeza. Diferido a F070 (`routed_reason_code` o mostrar completitud/margen/conflicto junto al motivo).
2. (Mayor) Una vigilancia definida puede quedar bajo `revisión clínica` (pregunta 4 de ADR-010 hecha realidad); mitigaciones arriba.
3. (Mayor) Volumen de cola frágil y sin medir con τ = 0.5 (borde exacto del normal completo); medir antes de la demo a inversores.
4. (Mayor) Sin texto sobre quién cambia τ ni entrada en `.env.example`; cubierto en los puntos 4 y 7 y en la alternativa de `.env.example`.
5-9. (Menores) Comentario de encabezado obsoleto en `certainty.ts` (corregido aquí); cadena vacía y τ sin registrar al arrancar; `tau` opcional con valor por defecto; la bandera `requires_confirmation` de un crítico con datos faltantes ligada a la aritmética de qSOFA (τ < 0.667); brecha de observabilidad del log.
10. (Redacción) Ver "Redacción obligatoria".
No verificado por el revisor: tests, `verify`, `scan:phi`, comportamiento del dashboard.

**Preguntas clínicas abiertas (el clínico debe confirmar):**
1. Si una `vigilancia` ya definida debe reenrutarse a revisión o solo `sin alerta`.
2. Si hace falta un τ aparte para la confirmación de un crítico (hoy el mismo).
3. Calibración de τ (0.5 provisional; F049), incluido el borde del normal completo.

**Handoffs:** F016 (la cola recibe `routed_from` y `reason_code: "low_certainty"`; ordenar por `highest_reachable_class`; no rankear una vigilancia enrutada como un review `could_escalate`); F023 (un crítico con `requires_confirmation` queda arriba); F049 (reportar el porcentaje enrutado con τ 0.4/0.5/0.6; calibrar τ); F070 (insignia `routed_from`, componentes de certeza junto al motivo, texto "τ sin validar", opción `routed_reason_code`); decisión del usuario sobre `.env.example`/`init.sh`.

**Referencias:** ADR-003, ADR-010, ADR-014; `docs/superpowers/plans/2026-11-05-f048-tau-routing.md`.
