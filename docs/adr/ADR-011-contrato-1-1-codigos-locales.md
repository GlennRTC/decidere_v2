# ADR-011: Contrato 1.1 con códigos locales y mapper
**Fecha:** 2026-11-05
**Estado:** propuesto

**Contexto:** El contrato 1.0 (ADR-008) solo acepta variables canónicas y unidades canónicas. Un emisor real usa sus propios códigos y unidades (p. ej. SBP en kPa). F043 agrega el mapper; sin él, el emisor tendría que traducir y el mapeo no sería auditable ni versionado. El mapeo también cambia la clasificación, y ADR-002 solo versiona reglas.

**Decisión:**
- Contrato 1.1 (aditivo; 1.0 sigue aceptado sin cambios): cada variable trae `code` (`^[A-Za-z0-9._-]{1,32}$`), `value` (número o `null`), `unit` y `t_offset_min`, en lugar de `variable`. La respuesta del POST agrega `mapping_version` y `results[].unmapped`.
- `source` es el espacio de nombres de los códigos: la tabla `knowledge/mappings/<source>.yaml` traduce código local a variable canónica (catálogo F042) y declara conversiones de unidad (`factor`, `offset`). Un `source` en la allowlist sin tabla responde 200 con todos los códigos sin mapear.
- Código sin mapeo: no se descarta ni se registra. Queda visible en `results[].unmapped` (solo el código) y el caso se clasifica con lo que sí se mapeó; una instancia con todo sin mapear llega al motor con `variables` vacío (verificado: 200). El valor del código nunca entra al log: la lista de mensajes y campos de logging no cambia.
- Unidad incompatible, valor fuera de rango tras convertir o medición duplicada: 422 `validation_failed` con `{path, code}` (`incompatible_unit`, `out_of_range`, `duplicate_measurement`); nunca se refleja el código ni la unidad recibidos.
- Sin redondeo: el valor convertido pasa al motor tal cual. Pregunta clínica abierta: 13,3 kPa se convierte a ~99,76 mm[Hg] y dispara qSOFA `sbp <= 100`, mientras que el mismo dato redondeado a 100 o a 99,8 podría leerse distinto. Hay que decidir con el clínico si se redondea y a cuántos decimales. La pregunta cubre también valores en unidad canónica que NO se convierten: 1.1 acepta decimales donde 1.0 exige enteros. Ejemplos: FR 21,7 (no cumple `>=22`; en 1.0 sería 422) y Glasgow 14,5 (se acepta y dispara `gcs_bajo`; Glasgow es ordinal). Decisión abierta para el usuario y el clínico: rechazar no enteros cuando no hay conversión (paridad con 1.0) o aceptarlos y documentarlo.
- `mapping_version` (`map-` + 16 hex de SHA-256 del contenido canónico de las tablas) se estampa en cada interpretación, junto a `rule_set_version` (extiende ADR-002). `map-empty` aparece solo cuando la app se construye sin mapeos; un `MAPPINGS_DIR` vacío da `map-<hash>`. El camino interno sin mapeo usa `identity`. El hash cubre `source` y las entradas en el orden del archivo (code, variable, units con unit/factor/offset), con -0 normalizado; NO incluye `source_note` (a diferencia de `citation` en `rule_set_version`, ADR-002) ni el UCUM canónico del catálogo.
- Corrección de factor: UCUM define `m[Hg]` como 133,3220 kPa, es decir `mm[Hg]` = 133,322 Pa, y kPa = 1000 Pa; el factor kPa a mm[Hg] es 1000 / 133,322 = 7,5006376. El texto del plan F043 decía 133,3224: estaba equivocado y no se usó.
- El arranque carga las tablas (`MAPPINGS_DIR`, por defecto `knowledge/mappings`) antes de escuchar; un fallo registra el mensaje fijo `rules failed to load` y sale con 1.

**Alternativas consideradas:**
- Que el emisor traduzca a canónico (sigue siendo 1.0) — descartado: no es auditable y cada emisor repite la lógica.
- Mapeo por código dentro del motor — descartado: el motor es puro y sin I/O (ADR-004).
- Redondear al convertir — pospuesto: es decisión clínica, no técnica.

**Consecuencias:**
- Mejora: emisores con códigos y unidades propias; mapeo versionado y trazable por interpretación.
- Más difícil: dos contratos vigentes; la traza del motor muestra valores convertidos que el emisor no envió.
- Riesgo aceptado: `code` (hasta 32 caracteres) podría llevar texto libre, como ya puede `source`; solo se refleja en `unmapped` y nunca en logs ni errores. No se decide la deprecación de 1.0.

**Referencias:** ADR-002, ADR-004, ADR-008; plan `docs/superpowers/plans/2026-11-05-f043-local-code-mapper.md`; UCUM ucum-essence.xml.
