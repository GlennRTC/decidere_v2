# ADR-006: Anotación clínica acotada (excepción a "sin texto libre")
**Fecha:** 2026-11-03
**Estado:** aceptado

**Contexto:** El clínico necesita registrar su decisión y justificarla cuando su criterio difiere del sistema (sobre un crítico, o al resolver un caso de la cola). Eso es texto libre, que ADR-001 excluye por riesgo de reidentificación.

**Decisión:**
- El único texto libre permitido es la justificación escrita por un usuario autenticado de la app, al marcar "criterio diferente" o al resolver un caso. El emisor del POST sigue sin poder enviar texto libre.
- Máximo 500 caracteres (propuesta), con un aviso visible de no ingresar identificadores de paciente.
- Nunca se loguea. Se guarda en una tabla de anotaciones con `tenant_id`, rol e id interno opaco.
- El audit log registra el evento y el id de la anotación, no el texto.
- No cambia la clase, ni entra al motor, a la certeza o a las métricas; no se usa para NLP.
- Revisión de compliance antes de implementar F061.

**Alternativas consideradas:**
- Solo motivos de una lista cerrada: es más seguro, pero no permite la justificación pedida. Podría complementar el texto.
- No registrar la decisión en la app: se descarta, porque pierde trazabilidad.
- Texto libre del emisor (F029): queda bloqueado hasta que exista otro ADR.

**Consecuencias:** El clínico documenta su criterio sin cambiar la clase del crítico. Se acepta el riesgo de que alguien escriba un identificador pese al aviso; la mitigación es el límite, el aviso, no loguear y la revisión. No hay detección automática (el hook PHI es heurístico). La retención queda por decidir; propuesta: el reset de la demo borra las anotaciones y conserva el audit log. Añade una entidad al esquema de base de datos (F054), que requiere aprobación del usuario.
