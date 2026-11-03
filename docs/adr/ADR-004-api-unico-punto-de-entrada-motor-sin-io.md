# ADR-004: La API es el único punto de entrada y el motor no hace I/O
**Fecha:** 2026-11-03
**Estado:** aceptado

**Contexto:** Hay que hacer cumplir autorización, aislamiento de tenant y no persistencia de PII en un solo lugar, y el motor debe poder probarse sin infraestructura.

**Decisión:**
- Todo acceso a datos pasa por `apps/api` (Fastify). El front usa Supabase solo para Auth; la API valida el JWT y aplica los roles.
- `engine/` es un paquete puro: sin fs, red, base de datos, reloj ni aleatoriedad. Recibe variables canónicas y un rule set ya cargado, y devuelve clase, traza y certeza.
- Un test o regla de lint impide importar módulos de I/O en `engine/`.
- La API no guarda estado en memoria entre requests (Vercel).
- Cada query lleva `tenant_id`, con un test cross-tenant.

**Alternativas consideradas:**
- Front consultando Supabase directo con RLS: se descarta, porque duplica la autorización y es más difícil de auditar.
- Motor que carga reglas de la base de datos: se descarta, porque rompe la pureza y los tests.

**Consecuencias:** Hay un solo punto de control y el motor es determinista y testeable. Todo endpoint nuevo pasa por la API. Se acepta un riesgo: la API usa service role, que salta RLS, así que el aislamiento depende de nuestro código y de sus tests.
