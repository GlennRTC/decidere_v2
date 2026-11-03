# Log de progreso entre sesiones

> Este archivo es un log append-only, no un feature tracker (eso es `feature-list.json`). Cada sesión agrega una entrada al final. No lo reescribas ni borres entradas anteriores — es la única memoria real que tiene la siguiente sesión sobre por qué se tomó una decisión, no solo qué archivo cambió.

## Formato de cada entrada

```
## <YYYY-MM-DD HH:MM> — Sesión <N>
**Feature(s) trabajada(s):** F00X — <título>
**Qué se hizo:** (2-4 líneas, enfocado en decisiones y por qué, no en "edité archivo X")
**Verificación realizada:** (qué corriste para confirmar que funciona -- no "debería funcionar")
**Estado al cerrar:** passing / failing / bloqueado — por qué
**Pendiente para la próxima sesión:** (explícito, no lo dejes implícito en el código)
**Commit:** <hash o mensaje>
```

---

## 2026-11-03 — Sesión 0 (setup inicial)
**Qué se hizo:** Proyecto inicializado a partir del harness `health-ai-agent-harness`. `feature-list.json` creado con 28 features (F001–F028), todas `failing`, derivadas de "Decidere MVP: Definición v2" y `AGENTS.md`. `scripts/init.sh` adaptado al stack (npm workspaces, API Fastify, health check); sin `package.json` aún, avisa y sale con 0. Trabajo en la rama `chore/init-harness` basada en `origin/main` (el `README.md` de la plantilla se movió a `docs/HARNESS.md` para conservar el README del proyecto).
**Verificación realizada:** `feature-list.json` parseado con python (28 features, todas failing). `init.sh` ejecutado en el estado actual (sin package.json).
**Estado al cerrar:** N/A — solo setup, ninguna feature implementada.
**Pendiente para la próxima sesión:** Resolver antes de codificar: (1) backend TS/Fastify vs Python/FastAPI, (2) SSE vs polling en Vercel (F015), (3) Supabase vs Postgres local, (4) nombrar clínicos etiquetadores y árbitro, (5) umbrales de reglas, meta de conformidad y umbral de certeza. Luego F002 (ADRs) y F001 (scaffold, requiere aprobar dependencias).

## 2026-11-03 — Sesión 0b (decisiones del usuario)
**Qué se hizo:** Se registraron las decisiones: backend TS/Fastify, polling 2-3 s (ADR-005), Supabase, YAML propio + json-logic, tres roles (superadministrador, experto, usuario), conformidad = cero discrepancias, offsets relativos confirmados, texto libre fuera del MVP pero a integrar (F029 nueva). Etiquetadores/árbitro como placeholders. Umbrales, combinación de reglas y umbral de certeza: a definir en planificación con agente especializado. `AGENTS.md` actualizado (roles, polling). Solo se tocó `notes` en features existentes.
**Verificación realizada:** feature-list.json parseado (29 features, todas failing).
**Estado al cerrar:** N/A — solo documentación.
**Pendiente para la próxima sesión:** Criterios de aceptación de F013/F016/F022 aún nombran los cuatro roles antiguos (reconciliar con tu aprobación). ADR-001 a 004 (F002). Planificación/brainstorming de umbrales, combinación y certeza (F006-F008).
