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
