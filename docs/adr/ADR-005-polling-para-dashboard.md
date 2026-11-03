# ADR-005: Polling de 2-3 s para el dashboard de críticos (en lugar de SSE)
**Fecha:** 2026-11-03
**Estado:** aceptado

**Contexto:**
La definición de producto (v2) describe un push por SSE hacia el dashboard; `AGENTS.md` menciona polling de 2-3 s. La API corre como funciones serverless en Vercel y la demo debe poder hostearse allí. Las funciones serverless tienen duración máxima por invocación y no mantienen estado entre requests (ninguna instancia guarda estado en memoria), por lo que una conexión SSE de larga duración es frágil o costosa en ese entorno.

**Decisión:**
- El dashboard de críticos y la cola de revisión obtienen novedades por polling HTTP cada 2-3 s contra un endpoint de lectura de la API (con scope de rol), consultando Supabase Postgres.
- El endpoint soporta consulta incremental (p. ej. "casos posteriores a un cursor opaco") para que cada poll sea barato.
- El cursor es un identificador interno opaco, no una fecha exacta (regla de tiempos relativos).
- Criterio verificable: un crítico enviado por `POST /v1/messages` aparece en el dashboard en menos de 5 s sin recargar, medido en el despliegue real de Vercel (feature F015).
- El contrato de `POST /v1/messages` no cambia; el mecanismo de entrega al dashboard es independiente de él.

**Alternativas consideradas:**
- SSE desde funciones serverless de Vercel — descartada: límites de duración de las funciones y falta de estado compartido entre instancias; se cortaría y reconectaría constantemente.
- Realtime de Supabase (WebSocket desde el cliente) — descartada para v1: añade otra superficie de autorización (RLS y scope de tenant en el canal) y de dependencia; puede reconsiderarse si el polling no basta.
- WebSocket propio — descartado: requiere servidor persistente, incompatible con el hosting elegido.

**Consecuencias:**
- Mejora: funciona en Vercel sin infraestructura adicional; la API sigue sin estado; implementación y pruebas simples.
- Más difícil: latencia de hasta 2-3 s (aceptable para la demo, no necesariamente para uso clínico real); carga de lecturas proporcional a clientes abiertos x frecuencia, lo que puede ser relevante con muchos usuarios simultáneos y con los límites del plan de Supabase.
- Riesgo aceptado: sin evento push real, la afirmación "push por SSE" de la definición de producto queda reemplazada; el texto de AGENTS.md ("Dentro del alcance") que dice SSE debe leerse como polling. Si se necesita menor latencia, abrir un ADR nuevo (Realtime o SSE en un servicio persistente).

**Referencias:** "Decidere MVP: Definición v2" §3 y §11; `AGENTS.md` (Arquitectura); feature F015; decisión del usuario del 2026-11-03.
