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

## 2026-11-03 — Sesión 0c (descomposición del MVP)
**Qué se hizo:** Brainstorming con revisión de agentes clínico, UX, compliance y product owner. Se agregaron F030–F067 (todas `failing`) y se anotó en las originales en qué se dividieron o absorbieron. F017 (edición de mapeo) diferida a v1.1. Diseño en `docs/superpowers/specs/2026-11-03-mvp-decomposition-design.md`. Dos supuestos míos: el rol usuario también marca visto/atendido y anota; la anotación es texto libre acotado y requiere ADR-006 y revisión de compliance antes de implementarse.
**Verificación realizada:** feature-list.json parseado (67 features, todas failing).
**Estado al cerrar:** N/A — solo planificación.
**Pendiente para la próxima sesión:** F030 (scaffold, requiere aprobar dependencias) y F033 (spike json-logic). Escribir ADR-001 a 004 y ADR-006 (F002). Definiciones clínicas abiertas (sospecha de infección, τ, bandas). Reclutar etiquetadores. Consultar a un abogado sobre residencia de datos.

## 2026-11-03 — Sesión 0d (ADRs)
**Qué se hizo:** Se redactaron y aprobaron en chat ADR-001, 002, 003, 004 y 006 (estado "propuesto"). ADR-001 se guardó como `ADR-001-no-persistencia-de-datos-personales.md` porque una regla de permisos deniega leer rutas con "phi" en el nombre. Se reformularon las menciones a Colombia en AGENTS.md, feature-list.json y el diseño: primer despliegue y mercado de referencia, sin que el diseño dependa de él. Se quitó de AGENTS.md la nota de que los ADR no existían.
**Verificación realizada:** feature-list.json parseado; ADR creados con el formato del comando /adr. Sin código ni tests.
**Estado al cerrar:** F002 sigue `failing` hasta que los ADR pasen de "propuesto" a "aceptado" (aprobación del usuario).
**Pendiente para la próxima sesión:** F030 (scaffold, requiere aprobar dependencias) y F033 (spike json-logic).

## 2026-11-03 — Sesión 1 (F030: monorepo y comando único de verificación)
**Feature(s) trabajada(s):** F030 — Monorepo con workspaces y comando único de verificación
**Qué se hizo:** Plan en `docs/superpowers/plans/2026-11-03-f030-monorepo-verify.md`, ejecutado con un subagente por tarea y revisión por tarea más revisión final. Workspaces (`apps/*`, `packages/*`, `engine`, `tests`), TypeScript (typecheck), Biome (lint), `npm run verify` = lint && typecheck && test && build, guarda en `scripts/init.sh` y comandos registrados en `AGENTS.md`. Dependencias aprobadas por el usuario: typescript, @types/node (mayor 22), @biomejs/biome. Se reescribió el lockfile al registro público de npm.
**Verificación realizada:** `npm run verify` exit=0 (lint, typecheck, 9/9 pruebas, build). Con un archivo de prueba con variable sin usar, `verify` termina con exit=1 en el lint y no corre ninguna prueba. `./scripts/init.sh` exit=0 con el mensaje de F032. `npm ls --workspaces` lista `@decidere/tests`.
**Estado al cerrar:** F030 passing. Brecha aceptada: `node --test` sin archivos descubiertos sale con 0, y el descubrimiento de `*.test.ts` en Node 22.18 no está verificado; se verifica con la versión de Node fijada en F031.
**Pendiente para la próxima sesión:** F031 (CI con `npm run verify`), F032 (API Fastify `/health`) y F033 (spike json-logic). Si `npm install` se corre con un espejo de npm configurado localmente, puede reescribir las URLs del lockfile. Decisión abierta: agregar `Bash(npm run verify*)` a los permisos de `.claude/settings.json`.
**Commit:** 34cace8, 97779c7 (correcciones) sobre ccc91cc..706b014.
