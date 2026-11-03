# Harness de Claude Code — Salud digital + IA (boilerplate reutilizable)

Plantilla base para arrancar cualquier proyecto nuevo de Glenn en el espacio de salud digital/interoperabilidad, combinando:

1. El equipo de 8 subagentes especializados (dev/PO/diseño/compliance) del proyecto anterior.
2. La arquitectura de ["Effective harnesses for long-running agents"](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) (Anthropic) para sesiones de trabajo que no comparten memoria entre sí — un agente inicializador que corre una vez, y un protocolo de inicio/cierre de sesión que cada sesión posterior sigue.

## Por qué cambió de CLAUDE.md a AGENTS.md

`AGENTS.md` es un formato estándar cross-tool (lo leen Codex, Cursor, Claude Code y otros). En Claude Code específicamente, **no reemplaza a `CLAUDE.md` — es un fallback**: si existe un `CLAUDE.md` en la carpeta, ese se usa; `AGENTS.md` solo se lee cuando no hay `CLAUDE.md`. Pueden coexistir (ver nota al final de `AGENTS.md`).

Dos cosas a tener presentes:
- El soporte de `AGENTS.md` en Claude Code depende de un feature flag de Anthropic y **no está disponible en despliegues con Amazon Bedrock, Google Vertex AI, o con telemetría desactivada** — en esos casos Claude Code ignora `AGENTS.md` aunque exista, y hay que usar `CLAUDE.md`.
- `CLAUDE.md` soporta algunas capacidades específicas de Claude Code que `AGENTS.md` no está diseñado para cubrir igual.

Este harness usa `AGENTS.md` como archivo principal (portabilidad entre herramientas). Si algún proyecto corre en Bedrock/Vertex, o necesita algo Claude-específico que no cabe en el formato estándar, agrega un `CLAUDE.md` corto adicional en vez de duplicar todo.

## Qué trae

```
.
├── AGENTS.md                          # memoria de proyecto + protocolo de sesión — llenar por proyecto
├── .claude/
│   ├── settings.json                  # permisos + hooks, versionable en git
│   ├── agents/                        # 8 subagentes especializados (ver docs/AGENT_TEAM.md)
│   │   ├── health-product-owner.md
│   │   ├── interoperability-architect.md
│   │   ├── backend-engineer.md
│   │   ├── ai-ml-engineer.md
│   │   ├── clinical-safety-compliance-reviewer.md
│   │   ├── qa-test-engineer.md
│   │   ├── clinical-ux-designer.md
│   │   └── devops-sre.md
│   ├── commands/
│   │   ├── initialize-project.md      # /initialize-project — setup de una sola vez (agente inicializador)
│   │   ├── session-start.md           # /session-start — protocolo de inicio/cierre de cada sesión posterior
│   │   ├── new-feature.md             # /new-feature — da de alta una feature no planeada y la coordina PO→arq→dev→QA→compliance
│   │   ├── clinical-review.md         # /clinical-review — auditoría de PHI/consentimiento sobre un diff
│   │   └── adr.md                     # /adr — crea un ADR con el formato estándar
│   └── hooks/
│       └── check_phi_patterns.py      # hook PreToolUse heurístico (ver limitación abajo)
├── scripts/
│   └── init.sh                        # arranca el entorno + verificación end-to-end — esqueleto, adaptar por proyecto
└── docs/
    ├── AGENT_TEAM.md                  # la recomendación completa de perfiles, con el razonamiento
    ├── progress/
    │   ├── feature-list.template.json # copiar a feature-list.json al iniciar el proyecto
    │   └── PROGRESS.md                # log append-only entre sesiones
    └── adr/
        └── ADR-000-template.md
```

## Cómo usarlo en un proyecto nuevo

1. Copia toda esta carpeta a la raíz del proyecto nuevo.
2. Llena los placeholders `<...>` en `AGENTS.md` con el stack y las reglas reales de ese proyecto — no dejes placeholders sin llenar, un archivo con `<TODO>` es peor que uno corto y preciso.
3. Corre `/initialize-project` (o hazlo manualmente): copia `feature-list.template.json` a `feature-list.json` con las features reales del proyecto, todas en `"status": "failing"` al inicio, y adapta `scripts/init.sh` a los comandos reales del stack.
4. Revisa `.claude/settings.json` — el deny-list de rutas (`*.env`, `*phi*`, `secrets/**`) es un punto de partida, ajústalo a la estructura real del repo.
5. Si el proyecto no necesita los 8 agentes (ver "cuándo fusionar" en `docs/AGENT_TEAM.md`), borra los que no apliquen.
6. `git add .claude AGENTS.md scripts docs` y commitea — esto es lo que hace que el harness viaje con el repo.
7. En cada sesión posterior de trabajo, arranca con `/session-start` en vez de improvisar por dónde seguir.

## Cómo funciona el puente entre sesiones (el corazón del artículo de Anthropic)

El problema que resuelve todo esto: **cada sesión nueva de un agente no tiene memoria de la anterior.** Sin un mecanismo explícito, un agente que retoma el proyecto puede repetir trabajo, contradecir una decisión ya tomada, o asumir que algo funciona porque "se ve bien" sin verificarlo. Tres archivos cargan ese puente:

- **`docs/progress/feature-list.json`** — qué features existen y su estado (`failing`/`passing`). JSON a propósito: el modelo lo edita con más cuidado que un checklist en Markdown, y hay una regla dura de que nunca se edita o borra un test para forzar que una feature "pase".
- **`docs/progress/PROGRESS.md`** — log append-only de qué se hizo en cada sesión y **por qué**, no solo qué archivos cambiaron. Esto es lo que le dice a la sesión siguiente el contexto que el código por sí solo no cuenta.
- **`/session-start`** — el protocolo real: confirmar directorio, leer git log + PROGRESS.md, elegir UNA feature de `feature-list.json` por prioridad, levantar el entorno con `init.sh`, verificar end-to-end antes de tocar código, y al cerrar: verificar de verdad (no asumir), actualizar ambos archivos, y commitear.

Una feature por sesión, verificada antes de marcarse como lista, es el principio central del artículo — el error más común que documentan es un agente que intenta resolver todo de una vez y termina con implementaciones a medias y contexto agotado.

## Decisiones de diseño (por qué está armado así)

- **Subagentes con una responsabilidad cada uno**, no un "agente todólogo" — sigue siendo válido del diseño anterior. Ver la nota honesta en `AGENTS.md` sobre que Anthropic deja esto como pregunta abierta, no como verdad probada.
- **`.claude/settings.json` en vez de `settings.local.json`**: para que el permission set y los hooks se compartan por defecto entre cualquiera que trabaje en el repo. `settings.local.json` (no versionado) es para overrides personales de máquina.
- **`feature-list.json` es JSON y `PROGRESS.md` es Markdown, a propósito distinto**: uno es un tracker de estado que el agente edita con disciplina restringida (solo el campo `status`), el otro es un log narrativo que se va acumulando — mezclar los dos formatos en un solo archivo pierde la ventaja de cada uno.
- **El hook de PHI es heurístico a propósito, y lo dice explícitamente en su propio código.** Preferí darte algo honesto sobre sus límites que algo que suene a "protección automática" y te dé falsa confianza.
- **Agnóstico de región/mercado por defecto, se adapta cuando se le indica.** El harness original tenía sesgo implícito a LATAM (Colombia/Venezuela) heredado del contexto de recall-agent. Se generalizó: ningún agente asume país, idioma, marco legal (HIPAA/GDPR/LGPD/Ley 1581/etc.) o canal de comunicación (WhatsApp/SMS/email) por defecto — todos leen esa información de `AGENTS.md` o la marcan como decisión pendiente. Ver la sección "Región/mercado" en `AGENTS.md`.
- **Rust en el stack de `backend-engineer`, acotado a componentes específicos, no una reescritura.** Entra donde el throughput/latencia de parsing de protocolos clínicos (HL7/ASTM/DICOM) o la seguridad de memoria en el camino crítico de PHI lo justifican — nunca como reemplazo del servicio principal en TypeScript/Node sin que sea una decisión de arquitectura documentada en ADR. El agente incluye el costo real de un segundo lenguaje (toolchain, contratación, superficie de integración), no solo el beneficio.
- **Valkey en vez de Redis para cache/coordinación.** Valkey es un fork de Redis 7.2.4 (marzo 2024, cuando Redis Ltd. cambió de BSD a un license dual RSALv2/SSPLv1) bajo licencia BSD-3-Clause permisiva, con gobernanza de Linux Foundation y respaldo de AWS/Google/Oracle -- compatible a nivel de wire protocol, los clientes Redis existentes funcionan sin cambios. Redis volvió a una licencia open source (AGPLv3) en 2025, pero AGPLv3 sigue siendo copyleft con obligaciones que pueden ser relevantes si ofreces el producto como servicio -- Valkey evita esa ambigüedad de licencia hacia adelante. Si los términos de cualquiera de las dos cambian, revisa las condiciones vigentes antes de asumir que siguen igual a como están documentadas aquí.

## Limitaciones que debes conocer (no las escondo)

1. **Ningún subagente aquí reemplaza revisión humana en decisiones de riesgo clínico o legal.** `clinical-safety-compliance-reviewer` es una primera pasada consistente, no una opinión legal.
2. **El hook `check_phi_patterns.py` es un regex, no DLP real.** Falsos positivos y negativos son esperados — su único trabajo es forzar una pausa visible.
3. **`AGENTS.md` no funciona en Claude Code sobre Bedrock/Vertex o con telemetría desactivada** (ver arriba) — si ese es tu caso, usa `CLAUDE.md` en su lugar; el contenido es el mismo, solo cambia el nombre del archivo.
4. **Los subagentes corren en contexto aislado entre sí.** No "se enteran" de lo que otro decidió a menos que esté en `AGENTS.md`, en `PROGRESS.md`, en el resultado que les pases explícitamente, o en archivos del repo que ambos lean (ej. los ADRs). Si un agente parece "no saber" algo que otro decidió, falta escribirlo en un artefacto compartido, no es un bug.
5. **El artículo de Anthropic está optimizado para desarrollo web full-stack**, no específicamente para salud/interoperabilidad — la adaptación de dominio (compliance, subagentes clínicos) es mía, no de Anthropic; trátala con el mismo escepticismo que cualquier extensión no probada en producción real todavía.
6. **`scripts/init.sh` es un esqueleto comentado, no un script funcional** — `/initialize-project` debería adaptarlo, pero si lo saltas y lo usas tal cual, no hace nada útil.

## Mantenimiento del template

Cuando aprendas algo en un proyecto real que debería estar en el template (un nuevo caso borde para `qa-test-engineer`, un paso que faltaba en el protocolo de sesión), tráelo de vuelta aquí — este boilerplate solo vale la pena si se actualiza con lo que realmente te muerde en producción.
