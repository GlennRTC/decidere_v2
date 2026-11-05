# ADR-012: Variables de SIRS y contexto clínico en el contrato 1.1
**Fecha:** 2026-11-05
**Estado:** propuesto

**Contexto:**
F045 (SIRS) necesita frecuencia cardíaca, temperatura, leucocitos, PaCO2 y bandas; F046 (cultivos/antibióticos) y el historial ICD-10 necesitan un lugar en el mensaje. El catálogo (F042) ya define las variables; el contrato 1.0 solo acepta `resp_rate`, `sbp` y `gcs` como enteros. Sin decidir, F045/F046 tendrían que cambiar el contrato a medias.

**Decisión:**
1. **Cinco variables, solo en 1.1** (vía mapeo de códigos locales, ADR-011): `heart_rate`, `temperature`, `wbc`, `paco2`, `bands_pct`. 1.0 no cambia: sus valores son enteros y la temperatura es decimal; en 1.0 una de estas variables da 422 `invalid_value`. Una regla sobre una variable solo-1.1 carga, pero nunca dispara para un mensaje 1.0 ni para una fuente sin ese código mapeado.
2. **Cotas estructurales provisionales** (rechazan valores estructuralmente inverosímiles, no deciden umbrales clínicos; el mínimo de 25 Cel no es "imposible": una hipotermia profunda por debajo de 25 Cel es sobrevivible, así que es una cota provisional que el clínico y el usuario deben revisar):

| Variable | Mín | Máx | Unidad UCUM |
|---|---|---|---|
| `heart_rate` | 0 | 350 | `/min` |
| `temperature` | 25 | 45 | `Cel` |
| `wbc` | 0 | 1000 | `10*3/uL` |
| `paco2` | 0 | 300 | `mm[Hg]` |
| `bands_pct` | 0 | 100 | `%` |

3. **PaCO2 y bandas son opcionales y la completitud cuenta criterios, no variables.** El criterio de FR de SIRS se cubre con `resp_rate` O `paco2`; el de leucocitos, con `wbc` O `bands_pct`. Que falten `paco2` o `bands_pct` no baja la completitud mientras `resp_rate`/`wbc` estén presentes. **Handoff a F047** (certeza), que la implementa; requiere confirmación clínica.
4. **Contexto por instancia, solo 1.1:** `orders` (máx. 20; `type` en `blood_culture`|`antibiotic`; `t_offset_min` en -10080..0) y `diagnoses_icd10` (máx. 20, únicos, patrón `^[A-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$`). Se validan, pero **no se reflejan en la respuesta, no se registran en logs y no se clasifican** hasta F046. El mapeo copia solo `instance_id`, `kind` y `variables`, así que no llegan al motor.
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
- Un valor de contexto o de variable nueva que falla la validación o el mapeo (fuera de las cotas provisionales, unidad incompatible como WBC en `10*3/mm3` o FC en una unidad distinta de /min, ICD-10 sin punto como `A419`) rechaza el mensaje COMPLETO con 422, incluida una instancia crítica por qSOFA; los mensajes 1.1 de sim-1 que traían esos códigos antes de F044 recibían 200 con el código en `unmapped`. Es ruidoso y contado, nunca silencioso.
- **Aviso para F045:** una regla sobre una variable que solo entrega 1.1 se evalúa como desconocida en todo mensaje 1.0; eso puede derivar mensajes 1.0 a revisión, pero nunca a `sin alerta`.
- **Riesgo aceptado (revisión de cumplimiento, mayor 1):** `orders` y `diagnoses_icd10` se validan y luego se ignoran hasta F046, sin ninguna señal en la respuesta; un emisor puede suponer que se evaluaron. No se agrega campo de respuesta (cambio de contrato, sin consumidor aún). Decisión abierta para el usuario: un campo fijo sin contenido, como `context_ignored` (booleano o conteo, nunca tipos, códigos ni offsets).
- **Reidentificación (mayor 2):** antes de persistir, F012/F055 deben evaluar el riesgo de reidentificación por la combinación de hasta 20 códigos ICD-10 (incluidos los raros) más hasta 20 órdenes con offsets relativos (p. ej. cardinalidad máxima, agrupación o lista de códigos permitidos). ADR-001 y AGENTS.md cubren fechas, no combinaciones de códigos.
- **Pregunta legal abierta (no se resuelve aquí; no se asume marco):** si los códigos ICD-10 y las órdenes por instancia, aun sin identificadores directos, son datos de salud sensibles en la jurisdicción de cada despliegue, y qué cardinalidad o agrupación es aceptable persistir.
- `code` (32 caracteres) y `unit` (16) aún pueden llevar texto libre, mismo riesgo residual que ADR-011; `unmapped` no debe persistirse sin revisión en F012.
- El patrón ICD valida solo la forma, no la existencia del código ni la lista de códigos (`A99.ZZZZ` pasa).
- Órdenes duplicadas (mismo tipo y offset) se aceptan y pueden ser ruido para F046.
- El patrón ICD, más estricto que la fuente, debe confirmarse con el clínico antes de F046.
- **Handoff (mayor 3):** cuando F046 consuma órdenes/ICD-10, extender `apps/api/src/testing/log-audit.ts` con una comprobación de cadenas ICD-10 y tipos de orden en stdout y stderr; hoy la garantía descansa solo en `ingest-sirs.test.ts`.

**Preguntas clínicas abiertas:** cotas correctas; bandas por conteo manual o automatizado; si las órdenes necesitan resultado (cultivo positivo, antibiótico administrado vs. ordenado); la regla de completitud por criterios.

**Referencias:** ADR-001, ADR-008, ADR-011; `docs/superpowers/plans/2026-11-05-f044-sirs-contract.md`; CMS ICD-10-CM Guidelines FY2025 Sección I.A.2; UCUM `ucum-essence.xml`.
