# ADR-002: Reglas como datos versionados
**Fecha:** 2026-11-03
**Estado:** aceptado

**Contexto:** Los clínicos deben poder revisar las reglas y aprobarlas, y cada resultado debe poder reconstruirse. Las reglas cambian con el tiempo.

**Decisión:**
- Las reglas son archivos YAML en `knowledge/`, con id estable (`sepsis.qsofa.v1`) y cita de guía (versión y sección).
- Las condiciones se evalúan con el comparador propio de ADR-007 (decidido en el spike F033; json-logic descartado).
- `rule_set_version` se calcula desde las reglas activas: cambia si cambia cualquiera.
- Cada interpretación guarda `rule_set_version`, la traza y `mapping_version`.
- Cada regla lleva `clinical_approval` (estado, aprobador, versión de la guía). Mientras esté `pending`, la respuesta y la UI lo muestran.
- Los cambios entran por PR con revisión clínica (CODEOWNERS); ninguna regla se edita desde la app.
- Un rule set inválido impide el arranque.

**Alternativas consideradas:**
- Reglas en código TypeScript: se descarta, porque los clínicos no revisan código.
- CQL: se descarta para el MVP por su curva alta.
- Reglas editables en base de datos o editor visual: se descarta, por la falta de trazabilidad por PR y por estar fuera del alcance.

**Consecuencias:** Hay reproducibilidad y auditoría. Cada cambio de umbral requiere PR y despliegue. Se acepta que una regla pendiente esté en uso mientras se muestre como tal. Nota: `mapping_version` extiende lo que decía la definición de producto (solo `rule_set_version`), porque el mapeo también cambia la clasificación.

## Formato de archivo v1 y rule_set_version

Implementado en `packages/rules` (`@decidere/rules`, F037). El cargador y el cálculo de versión son I/O fuera del motor (ADR-004).

- **Archivos:** `knowledge/rules/<id>.yaml`, uno por regla. El nombre debe coincidir con `id`. Sin recursión: solo archivos regulares `*.yaml` directamente en el directorio; cualquier otra entrada (subdirectorio, symlink, otra extensión) se rechaza. Límites: 65536 bytes por archivo y 200 archivos.
- **Esquema cerrado en todos los niveles** (una clave desconocida se rechaza, no se descarta): `format_version: 1`, `id` (`^[a-z0-9][a-z0-9._-]{0,63}$`), `title`, `citation: {source, version, section}`, `clinical_approval: {status, approver, guideline_version}`, `enabled` (opcional, por defecto `true`), `conditions` (cada una exactamente `id, label, variable, op, value, unit`) y `combine` (id de condición, o exactamente uno de `all`/`any`/`not`/`atLeast: {n, of}`). Cadenas no vacías de hasta 200 caracteres. No hay `severity`: la política de clase es F039 y agregarla es un cambio de `format_version`.
- **Seguridad de YAML:** YAML 1.2 core, claves únicas, un solo documento, sin alias ni anclas (se rechazan antes de expandir), sin etiquetas desconocidas. Los errores son `RuleLoadError` con código cerrado, nombre de archivo, ruta posicional y mensaje fijo; nunca se copia un valor, clave o mensaje del parser.
- **Reglas activas:** `enabled: true`, ordenadas por `id` (no por nombre ni orden de archivo). Las deshabilitadas se validan pero se excluyen del motor y de la versión. Cero activas es un error (`no_active_rules`).
- **`rule_set_version`:** `"rs-"` + los primeros 16 hex de SHA-256 sobre el JSON canónico (claves ordenadas, sin espacios) de `{v: 1, rules: [{rule, meta}...]}` ordenado por `id`, donde `rule` es la regla congelada del motor y `meta` es `{id, title, citation, clinical_approval}`. No depende de comentarios, orden de claves ni nombres de archivo; cualquier cambio real la cambia. El truncamiento a 64 bits es una concesión deliberada: una colisión accidental es despreciable y una deliberada requiere acceso de escritura al repositorio de reglas, que ya basta para cambiar las reglas.
- **`approval`:** `"approved"` solo si todas las reglas activas están aprobadas; si no, `"pending"`. `approved` exige `approver` y `guideline_version` no vacíos; `pending` permite `null`. Sin fechas ni notas libres.
- **Pendiente (F040):** llamar a `loadRuleSet(dir, {variables})` antes de escuchar, fallar el arranque ante `RuleLoadError`, y devolver `rule_set_version` y `approval` en la respuesta del POST.
