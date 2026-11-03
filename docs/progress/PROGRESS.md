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

## 2026-11-03 — Sesión 2 (F031: CI con verify, escaneo PHI y de secretos)
**Feature(s) trabajada(s):** F031 — CI con el mismo comando, secret scanning y hook PHI
**Qué se hizo:** Plan en `docs/superpowers/plans/2026-11-03-f031-ci-verify.md`, un subagente por tarea con revisión por tarea y revisión final. `scripts/scan_phi.py` reutiliza los patrones del hook PHI (`npm run scan:phi`); `.github/workflows/ci.yml` corre `npm run verify`, `scan:phi` y gitleaks v8.30.1 (binario con SHA-256 verificado, historial completo, `--redact`). Actions fijadas por SHA, permisos `contents: read`. AGENTS.md documenta los gates.
**Verificación realizada:** Run de CI en el PR #3 (Actions 41662189281): éxito. Node v22.18.0; verify con 26/26 pruebas; `scan:phi` "scanned 13 files, skipped 33, hits 0, errors 0"; checksum de gitleaks OK; "20 commits scanned, no leaks found". Localmente, gitleaks con el mismo comando falló (exit 1, regla github-pat, valor redactado) en un repo desechable con un secreto sintético y pasó (exit 0) en uno limpio. Esto cierra la brecha de F030: `node --test` descubre los `.ts` en Node 22.18.
**Estado al cerrar:** F031 passing. PR #3 con base `chore/f030-monorepo-verify` (apilado); tras el merge de F030 requiere rebase.
**Pendiente / hallazgos menores sin arreglar:** `persist-credentials: false` en checkout; allowlist por substring en `scan:phi` (p. ej. `test` coincide con `latest`); nombres con tilde o espacios rompen `$(git ls-files)`; sin aserción del número de pruebas descubiertas; sin vía para falsos positivos; un PR puede suprimir gitleaks con `.gitleaksignore`. Siguiente: F032 (Fastify `/health`) y F033 (spike json-logic).

## 2026-11-03 — Sesión 3 (F032: API Fastify con GET /health e init.sh verificado)
**Feature(s) trabajada(s):** F032 — Esqueleto de API Fastify con GET /health e init.sh verificado
**Qué se hizo:** Plan en `docs/superpowers/plans/2026-11-03-f032-fastify-health.md` (revisado por backend-engineer y api-architect), ejecutado con un subagente por tarea, revisión por tarea y revisión final. `apps/api` (`@decidere/api`): `buildApp()` con `GET /health` (`{"status":"ok"}`), forma de error única con mensajes fijos y `request_id`, `x-request-id` UUID generado por el servidor, `Cache-Control: no-store`, logs solo con método y path (sin query, headers ni IP; `/health` no se registra), `server.ts` con `PORT` y `API_HOST` validados y cierre ordenado. Dependencia aprobada: `fastify ^5.12.8` (MIT). Flags de tsconfig aprobados: `verbatimModuleSyntax`, `erasableSyntaxOnly`. `scripts/init.sh` ahora es un smoke check (`npm ci` salvo `SKIP_INSTALL=1`, falla si el puerto ya responde, falla rápido si la API muere, mata el grupo de procesos al salir) con 4 tests de integración.
**Verificación realizada:** `npm run verify` exit=0 (apps/api 24/24; tests 30 con 1 omitida, la de scaffold que se salta sola con `apps/api` presente). Revisión final con Node 22.18.0 real: verify exit 0, `npm ci` limpio, scan:phi 0 hits, gitleaks sin leaks, pruebas de fuga con valores sintéticos sin hallazgos. `./scripts/init.sh` real: exit=0, "OK: http://127.0.0.1:3000/health responded", sin procesos colgados y sin cambios en `package-lock.json`.
**Estado al cerrar:** F032 passing. Rama `feat/f032-fastify-health`, apilada sobre `chore/f031-ci-verify`.
**Decisión:** `init.sh` verifica y desmonta la API (ya lo hacía antes); para un servidor que siga arriba, `npm run dev -w apps/api`. Documentado en AGENTS.md.
**Pendiente / menores sin arreglar:** `curl` sin `--max-time` en `init.sh`; `LOG_FILE` no se borra; el check de `.env` de `init.sh` fallará cuando exista `.env.example`; rama 4xx del manejador de errores sin test (F036); `setsid` solo Linux; log del path crudo en 404 (considerar la plantilla de ruta). Siguiente: F033 (spike json-logic), F034 (Vercel con `/health` y handler propio).

## 2026-11-03 — Sesión 4 (F033: spike del evaluador de condiciones)
**Feature(s) trabajada(s):** F033 — Spike: json-logic-engine vs evaluador propio
**Qué se hizo:** Plan en `docs/superpowers/plans/2026-11-03-f033-condition-evaluator-spike.md`, consultado con backend-architect, clinical-informatics-auditor y clinical-ux-designer. Spike desechable en un directorio fuera del repo (no se agregó ninguna dependencia al proyecto; `json-logic-engine@5.0.7` se instaló solo ahí): oráculo de fuerza bruta para lógica de tres valores, comparador propio (70 líneas) y `json-logic-engine` con un wrapper. Decisión del usuario: comparador propio. Resultado y apéndices en `docs/adr/ADR-007-evaluador-de-condiciones.md` (estado "propuesto").
**Verificación realizada:** Sin wrapper, el motor falla las filas 1-4 (`x < 3` da true con dato ausente, sin Kleene, cortocircuito sin traza, sin `atLeast`); con wrapper pasa, pero el wrapper (44 líneas, sin validación equivalente) hace la lógica. Comparador: 10/10 tests base y 13 de filas 5-8 (determinismo con 1000 corridas y segundo proceso, bordes, validación, prototipos); fuzz 3^3 y 3^4 contra el oráculo; 4 mutaciones atrapadas; typecheck estricto con tsc 7. Dos bugs encontrados y corregidos en el código del apéndice C (ids no string o vacíos; cadena de `not` de 10 000 niveles daba RangeError, ahora límite de profundidad 64, arbitrario). El spike discriminó solo en parte: lo decidió la fila 1 más Kleene; las filas 5-8 del motor no se ejecutaron (regla de parada).
**Estado al cerrar:** F033 passing (decisión del usuario tomada). ADR-007 sigue "propuesto" hasta su aceptación.
**Pendiente:** Aceptar ADR-007. Proponer la actualización de ADR-002 (dice "sujeto al spike F033" y "json-logic"): pide aprobación. Preguntas para el clínico: SIRS con PaCO2 ausente, clase cuando solo los desconocidos alcanzan el umbral, límites de plausibilidad, GCS < 15 como estado mental alterado, ventana de antigüedad, qSOFA >= 2 solo como crítico. Ids de combinadores posicionales: añadir id opcional escrito en la regla (F037/F005). Verificar con YAML real y en Node 22.18. Siguiente: F034 (Vercel) o F035 (schema estricto); F002 (aceptar ADR) antes de mergear F035, F005 y F040.

## 2026-11-03 — Sesión 5 (F035: schema del mensaje v1.0, corte qSOFA)
**Feature(s) trabajada(s):** F035 — Schema reducido v1.0 para el primer corte (qSOFA), estricto
**Qué se hizo:** Plan en `docs/superpowers/plans/2026-11-03-f035-message-schema.md` (consultado con clinical-informatics-auditor y backend-architect), ejecutado con un subagente por tarea, revisión por tarea y revisión final. `packages/schema` (`@decidere/schema`): schema cerrado con `resp_rate`, `sbp`, `gcs`, offsets relativos acotados, tipos derivados con `json-schema-to-ts`, validación con Ajv propio, errores `{path, code}` de tabla cerrada sin valores ni nombres desconocidos, rechazo de mediciones duplicadas, `currentInstances()`. Dependencias aprobadas: `ajv ^8.20.0`, `json-schema-to-ts ^3.1.1` (dev). Opción B del contrato aprobada. ADR-008 (propuesto). Cambio a un test existente aprobado por el usuario: helper `variables(n)` con offsets distintos.
**Verificación realizada:** `npm run verify` exit=0 (api 24/24, schema 34/34, tests 29/30 con 1 omitida preexistente); `scan:phi` 0 hallazgos. Mutaciones atrapadas en cada tarea (coerción, bounds, additionalProperties, lectura de params, duplicados); 117 sondas adversarias sin filtración. Revisión final: aprobada, 0 Critical; el hallazgo Important (guarda estructural débil) se corrigió con `guard.test.ts`. CI aún no corrió (rama sin push).
**Estado al cerrar:** F035 passing. Revisión formal `/clinical-review` pendiente (la feature requiere compliance review).
**Decisiones:** la allowlist de emisores por tenant (`source`) se valida en F040. Unicidad de `instance_id` no exigida en 1.0.
**Pendiente / abiertos:** ver "Límites conocidos" en ADR-008 (`source` no es opaco por patrón, claves JSON duplicadas, precisión de `JSON.parse`, rangos provisionales, Node 22.18 y Vercel sin verificar). Hallazgos menores: test de ReDoS sobredenominado, dos tests dependen del orden de keywords de Ajv. Siguiente: F036 (errores estructurados en la API), F034 (Vercel, bloqueada por residencia de datos).
