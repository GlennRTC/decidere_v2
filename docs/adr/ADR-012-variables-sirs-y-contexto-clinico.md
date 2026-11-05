# ADR-012: Variables de SIRS y contexto clínico en el contrato 1.1
**Fecha:** 2026-11-05
**Estado:** propuesto

**Contexto:**
F045 (SIRS) necesita frecuencia cardíaca, temperatura, leucocitos, PaCO2 y bandas; F046 (cultivos/antibióticos) y el historial ICD-10 necesitan un lugar en el mensaje. El catálogo (F042) ya define las variables; el contrato 1.0 solo acepta `resp_rate`, `sbp` y `gcs` como enteros. Sin decidir, F045/F046 tendrían que cambiar el contrato a medias.

**Decisión:**
1. **Cinco variables, solo en 1.1** (vía mapeo de códigos locales, ADR-011): `heart_rate`, `temperature`, `wbc`, `paco2`, `bands_pct`. 1.0 no cambia: sus valores son enteros y la temperatura es decimal; en 1.0 una de estas variables da 422 `invalid_value`. Una regla sobre una variable solo-1.1 carga, pero nunca dispara para un mensaje 1.0 ni para una fuente sin ese código mapeado.
2. **Cotas estructurales provisionales** (rechazan lo imposible, no deciden umbrales clínicos):

| Variable | Mín | Máx | Unidad UCUM |
|---|---|---|---|
| `heart_rate` | 0 | 350 | `/min` |
| `temperature` | 25 | 45 | `Cel` |
| `wbc` | 0 | 1000 | `10*3/uL` |
| `paco2` | 0 | 300 | `mm[Hg]` |
| `bands_pct` | 0 | 100 | `%` |

3. **PaCO2 y bandas son opcionales y la completitud cuenta criterios, no variables.** El criterio de FR de SIRS se cubre con `resp_rate` O `paco2`; el de leucocitos, con `wbc` O `bands_pct`. Que falten `paco2` o `bands_pct` no baja la completitud mientras `resp_rate`/`wbc` estén presentes. **Handoff a F047** (certeza), que la implementa; requiere confirmación clínica.
4. **Contexto por instancia, solo 1.1:** `orders` (máx. 20; `type` en `blood_culture`|`antibiotic`; `t_offset_min`) y `diagnoses_icd10` (máx. 20, únicos, patrón `^[A-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$`). Se validan, pero **no se reflejan en la respuesta, no se registran en logs y no se clasifican** hasta F046. El mapeo produce una salida con forma 1.0, así que no llegan al motor.
5. **Honestidad sobre la fuente del formato ICD-10:** el patrón se verificó solo en parte contra las ICD-10-CM Official Guidelines FY2025 del CMS, Sección I.A.2 (letras/dígitos, 3 a 7 caracteres; leído 2026-11-05). Letra inicial y dígito en segunda posición **no** se confirman ahí; se mantienen por convención y son más estrictos que la fuente: un código válido pero exótico recibiría un 422 explícito (falla ruidosa, no silenciosa).
6. **ICD-10 es dato de salud (ADR-001).** Solo se persistirá, sin identificadores, más adelante (F012/F055). Las preguntas de jurisdicción siguen abiertas; no se asume ningún marco.
7. **Conversión `10*9/L` a `10*3/uL`, factor 1**, en `knowledge/mappings/sim-1.yaml`. Leído en `ucum-essence.xml` (repositorio ucum-org/ucum): L = 1 l, prefijo u = 1e-6, `10*` = 10. **No se leyó** la gramática del exponente (`10*9` = 10^9 en la especificación); se asumió. Verificado 2026-11-05 (ver `source_note`).

**Alternativas consideradas:**
- Ampliar 1.0 — rompe a los emisores existentes y su regla de enteros.
- Completitud por variable — penaliza un SIRS completo por faltar PaCO2/bandas, que son alternativas de un criterio.
- Texto libre para diagnósticos u órdenes — riesgo de reidentificación (ADR-001).

**Consecuencias:**
- F045/F046 pueden construirse sin tocar el contrato otra vez.
- Un código ICD-10 válido pero fuera del patrón se rechaza hasta ampliar el patrón.
- Riesgo aceptado: cotas, el trato de bandas y la regla de completitud son provisionales.

**Preguntas clínicas abiertas:** cotas correctas; bandas por conteo manual o automatizado; si las órdenes necesitan resultado (cultivo positivo, antibiótico administrado vs. ordenado); la regla de completitud por criterios.

**Referencias:** ADR-001, ADR-008, ADR-011; `docs/superpowers/plans/2026-11-05-f044-sirs-contract.md`; CMS ICD-10-CM Guidelines FY2025 Sección I.A.2; UCUM `ucum-essence.xml`.
