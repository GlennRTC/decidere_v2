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
6. **Borde τ = 0.5 y qSOFA normal completo:** el máximo de certeza de un caso normal completo es exactamente 0.5 (el margen de GCS está limitado a 0.5, ADR-014). Con `<` estricto queda en `sin alerta`. Es frágil: cualquier cambio de banda o de τ lo mueve, y cualquier caso con un valor a una unidad de un umbral (p. ej. FR 21) pasa a revisión.
7. **Quién puede cambiar τ:** solo superadministrador o devops, y todo cambio requiere visto bueno clínico registrado en un PR. Es una variable de entorno: quien despliega podría poner τ = 1 e inundar la cola (el crítico seguiría crítico). El valor vigente se ve en cada respuesta (`certainty.tau`).

**Alternativas consideradas:**
- Enrutar solo `sin alerta` y dejar `vigilancia` intacta: evita ocultar una vigilancia definida, pero un `vigilancia` con certeza baja quedaría sin la derivación que ADR-003 pide. No se eligió sin criterio clínico (pregunta 1). Cambiarlo toca `routeByCertainty` y sus tests.
- Subir `POLICY_VERSION`/`CERTAINTY_VERSION`: descartado por el punto 5.
- Crear `.env.example` con `CERTAINTY_TAU`: `.env.example` no existe y crearlo rompe `scripts/init.sh` ("Missing .env") y 3 tests de init-sh. Hoy `CERTAINTY_TAU` se documenta en el encabezado de `apps/api/src/server.ts` y aquí. AGENTS.md dice que los nombres de variables viven en `.env.example`: queda sin cumplir hasta que el usuario decida sobre `.env.example`/`init.sh` (seguimiento).

**Consecuencias:**
- Mejora: ningún caso de certeza baja queda como `sin alerta`/`vigilancia` sin revisión; un crítico nunca baja; τ inválido impide arrancar (falla cerrada).
- **Revisión por encima de vigilancia (ADR-010 pregunta 4):** una `vigilancia` definida puede sustituirse por `revisión clínica`. Mitigaciones: `routed_from`, `highest_reachable_class`, y que la UI (F016/F023/F070) use una insignia `routed_from` y una clave de orden aparte; no debe ordenar ni rotular un caso enrutado como un review `could_escalate`.
- **Volumen de la cola sin medir:** con τ = 0.5, todo normal con un valor a una unidad de un umbral va a revisión. Hay que reportar sobre los seeds el porcentaje enrutado con τ 0.4, 0.5 y 0.6 (F018/F049). Con menos de 100 seeds no es una cifra estadística ni una afirmación de exactitud clínica.
- **Brecha de observabilidad:** la línea `message interpreted` registra la clase enrutada (`revisión clínica`) y no la original; la original solo está en la respuesta (`routed_from`).
- El orden del dashboard debe mantener arriba a un crítico con `requires_confirmation` (F023).
- Redacción obligatoria: "puntaje determinístico de certeza"; nunca IA, ML ni "confianza"; mantener `provisional: true` y el aviso "Demo con datos sintéticos; no aprobado para uso clínico; conformidad con criterios publicados, validación clínica pendiente"; decir en palabras que τ no está validado. `low_certainty`/`revisión clínica` no deben leerse como incertidumbre de un modelo (texto de la UI: F070).
- Menor: la invariancia del crítico depende de la aritmética de qSOFA (completitud >= 0.667 > τ); revisar al activar SIRS. `tau` es opcional en `IngestDeps`/`BuildAppOptions` y cae a 0.5 (seguro).

**Revisión de seguridad clínica (agente de IA `clinical-informatics-auditor`, NO un clínico; lectura estática; 0 bloqueantes, 4 mayores documentales/UX, 6 menores):**
1. (Mayor) El caso enrutado pierde el `reason_code` de la política; nada dice qué componente bajó la certeza. Diferido a F070 (`routed_reason_code` o mostrar completitud/margen/conflicto junto al motivo).
2. (Mayor) Una vigilancia definida puede quedar bajo `revisión clínica` (pregunta 4 de ADR-010 hecha realidad); mitigaciones arriba.
3. (Mayor) Volumen de cola frágil y sin medir con τ = 0.5 (borde exacto del normal completo); medir antes de la demo a inversores.
4. (Mayor) Sin texto sobre quién cambia τ ni entrada en `.env.example`; cubierto en los puntos 4 y 7 y en la alternativa de `.env.example`.
5-9. (Menores) Comentario de encabezado obsoleto en `certainty.ts` (corregido aquí); cadena vacía y τ sin registrar al arrancar; `tau` opcional con valor por defecto; invariancia del crítico ligada a qSOFA; brecha de observabilidad del log.
10. (Redacción) Ver "Redacción obligatoria".
No verificado por el revisor: tests, `verify`, `scan:phi`, comportamiento del dashboard.

**Preguntas clínicas abiertas (el clínico debe confirmar):**
1. Si una `vigilancia` ya definida debe reenrutarse a revisión o solo `sin alerta`.
2. Si hace falta un τ aparte para la confirmación de un crítico (hoy el mismo).
3. Calibración de τ (0.5 provisional; F049), incluido el borde del normal completo.

**Handoffs:** F016 (la cola recibe `routed_from` y `reason_code: "low_certainty"`; ordenar por `highest_reachable_class`; no rankear una vigilancia enrutada como un review `could_escalate`); F023 (un crítico con `requires_confirmation` queda arriba); F049 (reportar el porcentaje enrutado con τ 0.4/0.5/0.6; calibrar τ); F070 (insignia `routed_from`, componentes de certeza junto al motivo, texto "τ sin validar", opción `routed_reason_code`); decisión del usuario sobre `.env.example`/`init.sh`.

**Referencias:** ADR-003, ADR-010, ADR-014; `docs/superpowers/plans/2026-11-05-f048-tau-routing.md`.
