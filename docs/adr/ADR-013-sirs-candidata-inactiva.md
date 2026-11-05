# ADR-013: SIRS v1 transcrita como regla candidata inactiva
**Fecha:** 2026-11-05
**Estado:** propuesto

**Contexto:**
F045 pide la regla SIRS con id estable, cita y aprobación clínica pendiente. Activarla hoy (en `knowledge/rules/`) cambiaría el comportamiento del sistema: dos tests existentes y varios de integración usan conjuntos estrechos de variables (`resp_rate`, `sbp`, `gcs`), y con SIRS activa todo mensaje normal para qSOFA pasaría a `revisión clínica` porque faltan FC, temperatura y leucocitos. Sin decidir, o se activa sin aprobación clínica o se pierde la transcripción.

**Decisión:**
1. **SIRS v1 se transcribe como candidata inactiva** en `knowledge/rules-candidate/sepsis.sirs.v1.yaml`, directorio que la API no carga (`DEFAULT_RULES_DIR` apunta a `knowledge/rules/`). `clinical_approval.status: pending`. Tests que fijan la inactividad: `packages/rules/src/sirs.test.ts` (el directorio activo solo lista `sepsis.qsofa.v1.yaml`) y `apps/api/src/rules-candidate.test.ts` (`rule_set_version` activo sigue `rs-810ea5889733ed08`, sin `sepsis.sirs.v1`).
2. **Criterios** (la regla es verdadera con al menos 2 de 4):

| Criterio | Condición | Unidad UCUM |
|---|---|---|
| Temperatura | `temperature > 38` o `< 36` | `Cel` |
| Frecuencia cardíaca | `heart_rate > 90` | `/min` |
| Respiración | `resp_rate > 20` o `paco2 < 32` | `/min`, `mm[Hg]` |
| Leucocitos | `wbc > 12` o `wbc < 4` o `bands_pct > 10` | `10*3/uL`, `%` |

3. **`severity: watch` provisional.** SIRS por sí sola es inespecífica y Sepsis-3 se alejó de ella; no hay base para `crítico`. Es una decisión del equipo, no de la fuente; el clínico debe confirmarla.
4. **Fuente verificada, con honestidad:** los umbrales se atribuyen a Bone RC et al., Chest 1992 (PMID 1303622, doi:10.1378/chest.101.6.1644), pero **no se pudo leer la tabla primaria de criterios**. Se contrastaron solo con fuentes secundarias (arXiv 1408.6553 y el paquete R `cliot`, `sirs_sepsis_criteria`); las cadenas de cita de la regla lo dicen. Un clínico debe leer el original antes de aprobar.
5. **Comportamiento fijado por `sirs-policy.test.ts`** con la política de clase vigente (ADR-010):
   - Sin gasometría ni bandas y con FR <= 20, dos criterios quedan desconocidos, la regla es desconocida y la clase es `revisión clínica`. El motor devuelve `false` cuando los criterios sin resolver ya no pueden llegar a 2; por eso la salida `sin alerta` sin gasometría solo es alcanzable con a lo sumo un criterio sin resolver.
   - Un solo criterio verdadero con todo lo demás conocido da `sin alerta` para una regla `watch`.
   - Una `revisión clínica` pesa más que una `vigilancia` en el ranking de clases: activar SIRS puede enmascarar o reordenar resultados de otras reglas.
   - Vista previa verificada: con qSOFA y SIRS cargadas, la entrada `{resp_rate: 16, sbp: 120, gcs: 15}` pasa de `sin alerta` a `revisión clínica`.

**Alternativas consideradas:**
- Activarla de inmediato en `knowledge/rules/` — cambia cada respuesta normal de qSOFA a revisión y rompe tests con `sin alerta`; sin aprobación clínica.
- No transcribirla hasta tener la fuente primaria — pierde el trabajo y el contrato (F044) quedaría sin consumidor.
- `severity: critical` — sin respaldo clínico y contra la intención de limitar la fatiga de alertas.

**Consecuencias:**
- Mejora: la regla está versionada, citada, probada y no altera el sistema vivo.
- Más difícil: dos directorios de reglas; la activación es un cambio explícito y revisable.
- Riesgo aceptado: umbrales verificados solo con fuentes secundarias.
- **Antes de activar, decidir:** (a) sin gasometría ni bandas la regla casi nunca da `sin alerta` (revisión por datos faltantes); (b) un solo criterio con todos los datos conocidos da `sin alerta`; (c) cómo interactúa con el ranking de clases (revisión sobre vigilancia).
- **Handoffs:** F046 (proxy de infección: SIRS sin criterio de infección no debería alertar por sí sola); F047 (completitud por criterios, para que la falta de `paco2`/`bands_pct` no bloquee); F048 (derivación a revisión con τ).
- **Tests a actualizar al activar** (esperan `sin alerta` con las reglas reales): `apps/api/src/interpret.test.ts`, `apps/api/src/ingest.test.ts`, `tests/post-messages.e2e.test.ts`, y la constante de versión en `apps/api/src/ingest-sirs.test.ts`. Además, `rules-candidate.test.ts` y el chequeo del directorio activo en `sirs.test.ts` deben retirarse conscientemente.

**Preguntas clínicas abiertas:** lectura de la tabla primaria de Bone 1992 y confirmación de umbrales; severidad (`watch` u otra); si SIRS debe participar sin un criterio de infección; vigencia de los criterios originales frente a la práctica actual (Sepsis-3 se alejó de SIRS).

**Referencias:** ADR-007, ADR-010, ADR-012; `docs/superpowers/plans/2026-11-05-f045-sirs-rule.md`; Bone RC et al., Chest 1992 (PMID 1303622).
