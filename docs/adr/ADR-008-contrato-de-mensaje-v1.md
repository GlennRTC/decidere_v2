# ADR-008: Contrato del mensaje v1.0 (`POST /v1/messages`)
**Fecha:** 2026-11-03
**Estado:** propuesto

**Contexto:** El contrato del mensaje es la frontera donde un dato clínico entra al sistema y donde se puede filtrar PHI (ADR-001). F035 implementa la versión 1.0 en `packages/schema` para el corte qSOFA: sin esto, el mapper, el motor y el visor no tienen un contrato estable. Los límites numéricos son estructurales y provisionales: no son criterio clínico.

**Decisión:**
- Raíz cerrada: `schema_version` ("1.0"), `message_id` (UUID v4 en minúsculas), `source` (`^[a-z0-9-]{1,32}$`), `instances` (1 a 20).
- Cada instancia: `instance_id` (UUID v4), `kind` (`current` | `historical`), `variables` (hasta 50). Las históricas se validan con la misma forma estricta; se aceptan y el motor las ignora.
- Variables discriminadas por `variable`: `resp_rate` (unidad `/min`, 0..200), `sbp` (`mm[Hg]`, 0..400), `gcs` (`{score}`, 3..15). `value` es entero o `null`. `t_offset_min` es entero en −10080..0 (solo minutos relativos). Se rechaza el par (variable, offset) duplicado dentro de una instancia (`duplicate_measurement`).
- Excluidos de 1.0: `diagnoses_icd10` (F044), `loinc`/`code`/`system` (1.1, F042/F043), etiquetas, notas y fechas.
- Validación con un Ajv propio (`strict`, sin coerción, sin strip, un solo error). Fastify no valida este cuerpo: la ruta llama a `validateMessage` y no debe usar `messageSchema` como schema de ruta, porque los defaults de Fastify coercionan y eliminan campos.
- Errores: solo `{path, code}` con códigos de una tabla cerrada (`required`, `unknown_field`, `invalid_type`, `invalid_value`, `invalid_format`, `out_of_range`, `unsupported_version`, `duplicate_measurement`, `invalid`). Nunca valores recibidos ni nombres de campos desconocidos.
- `source` se restringe a un conjunto de caracteres en 1.0; la allowlist de emisores por tenant se valida en F040 (decidido por el usuario).

**Alternativas consideradas:**
- Validar con el Ajv de Fastify: descartada, coerciona y elimina campos.
- Códigos LOINC desde 1.0: descartada, adelanta F042/F043 y amplía la superficie de PHI.
- Aceptar `diagnoses_icd10` ya: descartada, riesgo de reidentificación; diferida a F044.
- Enum de emisores en el schema: descartada para 1.0; obliga a editar el schema por cada emisor. La allowlist por tenant va en F040.

**Consecuencias:** El contrato queda cerrado y los errores no filtran datos. Agregar variables exige cambiar el schema y la versión. Es obligatorio llamar a `validateMessage`, porque los tipos derivados no codifican límites ni patrones (`instances: []` compila).

**Límites conocidos y riesgos aceptados:**
- Las claves duplicadas en el JSON no se detectan. `JSON.parse` pierde precisión: `22.0` y `2e1` pasan como enteros, y `1e-400` se vuelve 0, que en `resp_rate` se lee como apnea.
- Los rangos numéricos son provisionales; el rango GCS 3..15 es la definición de la escala, por confirmar contra la fuente primaria. La ventana de 7 días aplica también a las históricas. No hay conversión de unidades ni verificación UCUM (F042).
- El patrón de `source` no prueba opacidad: acepta, por ejemplo, un texto con nombre y fecha. Hasta F040 el riesgo queda abierto. Los UUID son v4 solo en forma y deben ir en minúsculas.
- No se exige unicidad de `instance_id` dentro del mensaje; F040 debe decidirlo (cambiarlo es cambio de contrato).
- Solo se devuelve el primer error. Un tag `variable` ausente reporta `invalid_value`, no `required`.
- Solo se soporta salida de `JSON.parse`. Getters hostiles, Proxy y claves Symbol quedan fuera del alcance HTTP.
- Las instancias históricas vuelven completas en el resultado: F040 no debe persistirlas ni loguearlas más allá de un conteo. Los límites de tamaño y profundidad del body vienen de `bodyLimit` en F040.
- Sin verificar: Node 22.18 (solo CI), el despliegue en Vercel de un paquete workspace con fuente `.ts`, y que el CI ejecute los 34 tests del paquete.

**Población:** el contrato 1.0 asume pacientes adultos. qSOFA y GCS son umbrales de adultos y los menores tienen régimen especial (Ley 1581). No hay campo de edad; hasta que haya decisión clínica y legal, el emisor no debe enviar pacientes pediátricos.

**Condiciones para F040 (la ruta `POST /v1/messages`):** estas mitigaciones no las cumple este paquete y F040 no se da por terminada sin ellas.
- `source`: validar contra una allowlist de emisores por tenant antes de loguear o persistir; si no es válido, rechazar sin repetir el valor.
- `message_id` e `instance_id` los controla el emisor y pueden codificar un identificador (ADR-001 descarta hashear identificadores): `instance_id` se descarta tras la respuesta o se mapea a un `case_id` aleatorio del sistema; `message_id` se persiste, si acaso, solo para idempotencia y con TTL. Decidir también la unicidad de `instance_id` dentro del mensaje.
- Instancias históricas: no se persisten ni se loguean más allá de un conteo; justificar su aceptación o rechazarlas hasta que una regla las use.
- Body crudo: `bodyLimit` bajo y validación previa a `JSON.parse` que rechace notación exponencial y claves duplicadas, o aceptar el riesgo con firma del clínico.
- Test con canario en logs usando un body inválido (el `SyntaxError` de V8 puede incluir un fragmento del body).

**Preguntas abiertas.**
- *Clínico:* criterios y umbrales exactos de qSOFA (los números de ADR-007 son ilustrativos); ventana de `t_offset_min` para un dato vigente y retrospectiva de las históricas; qué medición cuenta cuando hay varias de la misma variable; rangos de plausibilidad (¿0 es posible?, ¿cota superior?, ¿implausible se revisa o se rechaza?); instancia como episodio o instantánea; ¿basta el GCS total?; distinguir "no medido" de "medido pero ilegible"; unidad canónica de GCS (`{score}` o `1`); ¿solo adultos?; ICD-10 completo o categoría (F044).
- *Legal/compliance:* si los offsets relativos más los valores clínicos siguen siendo datos personales o de salud (Ley 1581 y equivalentes); si aceptar y descartar históricas es tratamiento; si `source` identifica indirectamente al paciente; si `message_id` e `instance_id` persistidos o logueados son datos seudonimizados; residencia y transferencia internacional (la demo usa São Paulo, ver ADR-009 cuando exista); si las alertas forman parte de la historia clínica y su retención; régimen de menores; SaMD ante INVIMA/FDA; registro de bases de datos.
- Los artículos de la Ley 1581 citados por la revisión de F035 no están verificados: requieren opinión legal formal.
