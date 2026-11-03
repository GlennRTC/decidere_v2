# ADR-001: No se persiste PII/PHI
**Fecha:** 2026-11-03
**Estado:** propuesto

**Contexto:** El sistema recibe variables clínicas y tiempos que, combinados, pueden reidentificar a una persona. La demo es pública y usa datos sintéticos. El marco legal de protección de datos y de salud depende de la jurisdicción de cada despliegue y puede haber varios a la vez. Almacenar menos reduce la superficie de riesgo y facilita cumplir cualquier marco aplicable.

**Decisión:**
- No se almacena PII/PHI.
- `case_id` lo genera el sistema de forma aleatoria; nunca se deriva ni se hashea a partir de un identificador del emisor.
- El tiempo es solo un offset relativo en minutos, acotado. No hay fechas absolutas.
- El contrato v1 no acepta texto libre del emisor. La única excepción es ADR-006, y no viene del emisor.
- El payload crudo vive solo en memoria durante el request: no va a logs, errores, nombres de archivo ni almacenamiento.
- Se persisten la interpretación, las variables sin identificadores (en la traza, solo las que sustentan la regla), los mapeos, las revisiones y las versiones.
- Verificación: schema con `additionalProperties:false`; errores que no reflejan valores ni nombres de campos desconocidos; test canario con un valor centinela en logs y errores.

**Alternativas consideradas:**
- Persistir con cifrado o seudonimización: se descarta, porque sigue siendo dato personal en la mayoría de los marcos y amplía el alcance regulatorio.
- Hashear los identificadores: se descarta, porque se invierten por enumeración.
- Guardar el payload crudo para depurar: se descarta, porque contradice el objetivo.

**Consecuencias:** Mejora la privacidad y simplifica el cumplimiento en cualquier jurisdicción. Se vuelve más difícil depurar sin el payload y vincular un caso con una historia clínica real; una integración futura exigirá un ADR nuevo. Se acepta que la combinación de valores clínicos puede reidentificar aun sin PII, por lo que edad y sexo irían en bandas.
