# ADR-008: Contrato del mensaje v1.0 (`POST /v1/messages`)
**Fecha:** 2026-11-03
**Estado:** aceptado

**Contexto:** El contrato del mensaje es la frontera donde un dato clínico entra al sistema y donde se puede filtrar PHI (ADR-001). F035 implementa la versión 1.0 en `packages/schema` para el corte qSOFA: sin esto, el mapper, el motor y el visor no tienen un contrato estable. Los límites numéricos son estructurales y provisionales: no son criterio clínico.

**Decisión:**
- Raíz cerrada: `schema_version` ("1.0"), `message_id` (UUID v4 en minúsculas), `source` (`^[a-z0-9-]{1,32}$`), `instances` (1 a 20).
- Cada instancia: `instance_id` (UUID v4), `kind` (`current` | `historical`), `variables` (hasta 50). Las históricas se validan con la misma forma estricta; se aceptan y el motor las ignora.
- Variables discriminadas por `variable`: `resp_rate` (unidad `/min`, 0..200), `sbp` (`mm[Hg]`, 0..400), `gcs` (`{score}`, 3..15). `value` es entero o `null`. `t_offset_min` es entero en −10080..0 (solo minutos relativos). Se rechaza el par (variable, offset) duplicado dentro de una instancia (`duplicate_measurement`).
- Excluidos de 1.0: `diagnoses_icd10` (F044), `loinc`/`code`/`system` (1.1, F042/F043), etiquetas, notas y fechas.
- Validación con un Ajv propio (`strict`, sin coerción, sin strip, un solo error). Fastify no valida este cuerpo: la ruta llama a `validateMessage` y no debe usar `messageSchema` como schema de ruta, porque los defaults de Fastify coercionan y eliminan campos.
- Errores: solo `{path, code}` con códigos de una tabla cerrada (`required`, `unknown_field`, `invalid_type`, `invalid_value`, `invalid_format`, `out_of_range`, `unsupported_version`, `duplicate_measurement`, `invalid`). Nunca valores recibidos ni nombres de campos desconocidos.
- Contrato de errores de la API (F036): cuerpo `{"error":{"code","message","request_id","details"?}}`. Los códigos son cerrados, los mensajes son fijos y `details` solo existe en `validation_failed`, como pares `{path, code}` de `@decidere/schema`. Nunca se refleja un valor, una clave ni un mensaje del parser.

  | `code` | HTTP | Cuándo | `message` fijo |
  |---|---|---|---|
  | `forbidden` | 403 | `source` bien formado pero fuera de la allowlist (F040); el valor nunca se repite | `The source is not allowed.` |
  | `bad_request` | 400 | URL malformada u otra solicitud inválida a nivel de framework | `The request is invalid.` |
  | `invalid_json` | 400 | Cuerpo JSON vacío o no parseable (incluye `__proto__` y `constructor.prototype`) | `The request body is not valid JSON.` |
  | `not_found` | 404 | Ruta inexistente | `Resource not found.` |
  | `payload_too_large` | 413 | Cuerpo sobre `bodyLimit` (262144 bytes por defecto; 131072 en `POST /v1/messages`, F040) | `The request body is too large.` |
  | `unsupported_media_type` | 415 | `content-type` no soportado | `The content type is not supported.` |
  | `validation_failed` | 422 | El mensaje no cumple el schema (`details` presente) | `The message failed validation.` |
  | `internal_error` | 500 | Cualquier error no previsto, incluido un fallo del propio manejador | `Internal server error.` |

  `request_id` lo genera el servidor (nunca se acepta `x-request-id` del cliente). Toda respuesta de error lleva `cache-control: no-store`. 403 existe desde F040; 401 y 429 no existen aún (F052/F057/F064). Para el emisor, toda respuesta no-2xx significa que el mensaje NO fue interpretado: debe reintentar o alertar por otro canal. `internal_error` y `payload_too_large` no indican si hubo evaluación parcial; F040 define la semántica de reintento. `bad_request` agrupa hoy cualquier 4xx del framework: F040 debe conservar el estado real al agregar 429. Todo rechazo debe quedar contado por código (F040/F041); un log no basta como cobertura. Los `message` de arriba deben coincidir con `MESSAGES` en `apps/api/src/errors.ts`; el código es la fuente y esta tabla se actualiza con él.
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
- `message_id` e `instance_id` los controla el emisor y pueden codificar un identificador (ADR-001 descarta hashear identificadores): `instance_id` se descarta tras la respuesta o se mapea a un `case_id` aleatorio del sistema; `message_id` se puede loguear como campo estructurado (decisión del usuario, 2026-11-03, coherente con AGENTS.md y F011), con estas salvaguardas (revisión clínica de F036): solo después de validar el formato UUID y nunca en `validation_failed`, `invalid_json` ni otra rama de error (ahí el valor no está validado); `request_id` correlaciona sin él. Condiciones de F040: documentar retención, control de acceso y destino de los logs (Vercel, residencia no resuelta) y un test con canario. No se persiste salvo para idempotencia y con TTL. Nunca se loguea `instance_id`. Decidir también la unicidad de `instance_id` dentro del mensaje.
- Instancias históricas: no se persisten ni se loguean más allá de un conteo; justificar su aceptación o rechazarlas hasta que una regla las use.
- Body crudo: `bodyLimit` bajo y validación previa a `JSON.parse` que rechace notación exponencial y claves duplicadas, o aceptar el riesgo con firma del clínico.
- Test con canario en logs usando un body inválido (el `SyntaxError` de V8 puede incluir un fragmento del body).

**Preguntas abiertas.**
- *Clínico:* criterios y umbrales exactos de qSOFA (los números de ADR-007 son ilustrativos); ventana de `t_offset_min` para un dato vigente y retrospectiva de las históricas; qué medición cuenta cuando hay varias de la misma variable; rangos de plausibilidad (¿0 es posible?, ¿cota superior?, ¿implausible se revisa o se rechaza?); instancia como episodio o instantánea; ¿basta el GCS total?; distinguir "no medido" de "medido pero ilegible"; unidad canónica de GCS (`{score}` o `1`); ¿solo adultos?; ICD-10 completo o categoría (F044).
- *Legal/compliance:* si los offsets relativos más los valores clínicos siguen siendo datos personales o de salud (Ley 1581 y equivalentes); si aceptar y descartar históricas es tratamiento; si `source` identifica indirectamente al paciente; si `message_id` e `instance_id` persistidos o logueados son datos seudonimizados; residencia y transferencia internacional (la demo usa São Paulo, ver ADR-009 cuando exista); si las alertas forman parte de la historia clínica y su retención; régimen de menores; SaMD ante INVIMA/FDA; registro de bases de datos.
- Los artículos de la Ley 1581 citados por la revisión de F035 no están verificados: requieren opinión legal formal.

## Implementación F040 (2026-11-04)
`POST /v1/messages` está implementado en `apps/api` (sin persistencia). Decisiones aprobadas por el usuario:
- **Respuesta 200:** `{ message_id, rule_set: {version, approval}, policy: {version, provisional: true}, historical_ignored, results[] }`, un resultado por instancia `current` y en el mismo orden. Cada resultado: `case_id` (UUID aleatorio por llamada), `class` (`crítico | vigilancia | sin alerta | revisión clínica`), `reason_code`, `highest_reachable_class` (id ASCII de ADR-010), `conflict`, `certainty`, `rules_fired`, `trace`. `certainty: null` significa **"no calculada"** (F047), no certeza total; un consumidor no debe leerla como confianza. La bandera "requiere confirmación" también llega con F047.
- **`instance_id`:** se descarta; no se devuelve, no se loguea. No se exige unicidad dentro del mensaje (un duplicado se evalúa dos veces, sin error): decisión de F040, revisable.
- **Históricas:** se aceptan, no se evalúan, no se persisten ni se loguean; solo `historical_ignored`. Un mensaje sin instancias `current` responde 422 (`/instances`, `invalid_value`) para que ningún caso se pierda en silencio; F050 debe contarlo como rechazo contabilizado.
- **Medición:** por variable gana, entre las mediciones con valor, la de mayor `t_offset_min` (la más cercana al presente); un `null` posterior no borra una medición anterior (revisión externa: lo contrario degradaba un crítico a revisión); solo `null` o ausente = faltante (`unknown`). **Provisional**: puede ocultar un valor crítico anterior (GCS 8 en t=-30 y 15 en t=0 dan 15). La pregunta clínica "qué medición cuenta" sigue abierta.
- **`source`:** `ALLOWED_SOURCES` (lista separada por comas, por defecto `sim-1`) es una allowlist global provisional. **No autentica al emisor** (cualquiera puede enviar `sim-1`) y el 403 frente al 422 revela qué fuentes tienen forma válida; ambos se resuelven con auth y allowlist por tenant (F052/F054). No usar con datos reales.
- **Cuerpo:** `bodyLimit` de 131072 bytes en la ruta (el mensaje válido más grande mide unos 72 KB en JSON compacto y unos 139 KB con sangría de 2 espacios: **el emisor debe enviar JSON compacto**, o recibirá 413 sin remedio por reintento); parser JSON propio (`strict-json.ts`) que rechaza notación exponencial, claves duplicadas y `__proto__`/`constructor` con `invalid_json`; `text/plain` y charsets distintos de utf-8 dan 415. Los enteros sobre 2^53 se redondean antes del parser: el schema los acota por rango.
- **Arranque:** `knowledge/rules` (o `RULES_DIR`) se carga antes de escuchar; el servidor aborta si una regla no tiene `severity`.
- **Logs:** solo `message_id` (tras validar, nunca en ramas de error), `case_id`, clase, certeza, ids de reglas disparadas y conteos. Destino, retención y control de acceso de los logs: **pendiente de documentar** (Vercel, residencia sin decidir).
- **Semántica para el emisor:** cualquier respuesta no-2xx significa que el mensaje NO fue interpretado; reintentar o alertar por otro canal. Un 5xx no indica evaluación parcial.
- **Abierto (no cerrado por F040):** contador de rechazos por código (F041/F011), unicidad de `instance_id`, preguntas clínicas y legales de arriba, solo adultos (sin campo de edad).
