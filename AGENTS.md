# AGENTS.md — Decidere AI

> Formato estándar cross-tool (Codex, Cursor, Claude Code y otros lo leen). Es la fuente universal de este proyecto; lo específico de Claude Code (hooks, permisos, comandos) vive en `CLAUDE.md` y `.claude/settings.json`.
>
> Estructura basada en ["Effective harnesses for long-running agents"](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) (Anthropic, ingeniería) — el problema que resuelve: un agente que trabaja en sesiones sucesivas no tiene memoria compartida entre una sesión y la siguiente. Este archivo, más `docs/progress/feature-list.json` y `docs/progress/PROGRESS.md`, son el puente entre sesiones.

## Qué es este proyecto

Sistema que alerta al médico de urgencias cuando un paciente presenta una condición que requiere intervención (en el MVP: sepsis o cuadro infeccioso) y explica por qué alertó. El médico atiende varios pacientes a la vez; el sistema prioriza por gravedad y muestra siempre la regla que disparó y los valores que la sustentan.

- **Usuarios**: primarios, médicos de urgencias y enfermeros de turno. Secundarios, equipo clínico revisor (casos ambiguos) y administrador de la demo.
- **Mercado**: Colombia (INVIMA como referencia regulatoria; ver "Región/mercado").
- **Hito objetivo**: un sistema de prueba recibe los seeds (decenas de casos sintéticos), clasifica todos, y el reporte automático compara contra el gold standard según las métricas de abajo.

### Flujo central (el único que debe funcionar de punta a punta)

1. Un emisor envía un mensaje JSON con una o más instancias (episodios) mediante `POST /v1/messages`.
2. La API valida el schema y el mapper traduce códigos locales a variables canónicas.
3. El motor de reglas evalúa las reglas activas (definidas por clínicos, versionadas) y devuelve clase, traza de evaluación y certeza.
4. La respuesta síncrona del POST contiene la interpretación. En paralelo el dashboard se entera por polling (posteriormente push (SSE) pero de momento fuera del alcance).
5. Clases de salida: `crítico`, `vigilancia`, `sin alerta`, `revisión clínica`. Los casos con certeza baja van a la cola de revisión.

### Métricas de éxito del MVP

- **Cobertura**: 100% de los mensajes válidos termina en una clase o en revisión. Ningún caso se pierde.
- **Sensibilidad de la clase crítico sobre seeds**: 100%. Un crítico no detectado es el error inaceptable.
- **Conformidad con criterios publicados** (Sepsis-3/SSC): 99% (a confirmar). Con menos de 100 casos, 99% equivale a cero discrepancias; definir con el clínico si se acepta 1 o 2.
- **Casos en revisión clínica**: se reportan, no se penalizan. Un caso ambiguo bien derivado es resultado correcto.

### Gold standard

- Casos sintéticos escritos por clínicos. No se usan datasets con acuerdos de uso restrictivos (p. ej. MIMIC) en la instancia pública; verificar sus términos antes de cualquier uso derivado.
- Dos clínicos independientes etiquetan sin ver la salida del motor ni las reglas (urgencias o medicina crítica, más infectología). Un tercero adjudica desacuerdos.
- Se reporta el acuerdo entre etiquetadores (kappa de Cohen). Los casos en desacuerdo se conservan como seeds de ambigüedad.
- Al menos un etiquetador no debe haber participado en la redacción de las reglas. Si no es posible, se declara como limitación (la métrica medirá consistencia, no corrección clínica independiente).
- Composición mínima: positivos claros, negativos claros, casos límite en umbrales, datos faltantes, señales contradictorias.

### Dentro del alcance (v1)

- Schema JSON con varias instancias por mensaje (actuales e históricas): variables clínicas, paraclínicos, órdenes y resultados, diagnósticos previos ICD-10.
- `POST /v1/messages` con parseo, validación y evaluación por reglas; respuesta con interpretación; mapeo en el visor de alertas.
- Dashboard de críticos (polling 2-3 s, ADR-005) y cola de revisión clínica.
- Módulo de revisión y edición del mapeo de variables.
- Autenticación simple con tres roles: superadministrador (capacidades absolutas), experto (audita/verifica reglas) y usuario (ve interpretaciones en el dashboard).
- WebApp pública de demostración para inversores.
- Visor de evaluación de reglas con apariencia de perceptrón multicapa: entradas (variables) → condiciones → reglas → clase, generado directamente de la traza.
- Dashboard con analítica básica (distribución de clases, volumen, tasa de revisión, reglas más disparadas).
- Reglas de sepsis/infección como archivos YAML versionados.
- Suite de pruebas e2e que ejecuta los seeds y calcula las métricas.

### Fuera del alcance (NO construir, aunque parezca útil)

- Almacenar PII/PHI.
- Jev AI de Typesafe ni ningún componente con costo por token o licencia (producto no verificado; descartado para v1).
- Editor visual de reglas: los clínicos revisan los YAML (o una vista legible generada) y aprueban por PR.
- Otras patologías (ERC, IAM, diabetes, anemia en hemodiálisis).
- Integración real con EHR/LIS. El emisor es un simulador; Mirth Connect (HL7 v2/FHIR → JSON → POST) queda para después sin cambiar el contrato.
- Modelos de ML/NLP entrenados.

## Stack

- Backend: TypeScript/Node, API Fastify (`apps/api`), desplegada en Vercel.
- Motor de reglas: paquete puro sin I/O (`engine/`); certeza determinística.
- Servicio IA/NLP: ninguno en v1 (ADR-003: sin LLM ni costo por token).
- Capa de interoperabilidad: ninguna real en v1. Un simulador de seeds hace POST; Mirth Connect (HL7 v2 ORU/ADT o FHIR → JSON → POST) queda para después, sin cambiar el contrato.
- Frontend/staff: React + Vite (`apps/web`), en Vercel.
- Estado y auth: Supabase Postgres (interpretaciones, mapeos, reglas activas, revisiones) y Supabase Auth en el front; la API valida el JWT y aplica roles. Ninguna instancia de la API guarda estado en memoria entre requests.
- Hosting: Vercel + Supabase (demo pública con datos sintéticos).

### Arquitectura (resumen de una pantalla)

```
Emisor (simulador de seeds / futuro Mirth)
   │ POST /v1/messages (JSON, N instancias)
   ▼
API Fastify ─ valida schema ─► Mapper (código local → variable canónica)
      ─► Motor de reglas (YAML versionado → clase + traza)
      ─► Evaluador de certeza (determinístico)
      ─► persiste interpretación (sin PII) en Supabase Postgres
   │ response síncrono: interpretación + traza
   ▼
WebApp: Dashboard de críticos (polling 2-3 s) │ Cola de revisión │
        Revisión de mapeo │ Analítica │ Visor de evaluación de reglas
```

```
decidere-mvp/
├── apps/api/        # Fastify: ingesta POST, validación, orquestación, auth (valida JWT)
├── apps/web/        # React + Vite: dashboard, cola de revisión, mapeo, analítica, visor de reglas
├── packages/schema/ # schema del mensaje (episodios/instancias) y tipos compartidos
├── engine/          # evaluador puro (sin I/O): traza + certeza
├── knowledge/       # reglas YAML versionadas + cita de la guía
├── seeds/           # generador + casos simulados + clase esperada + criterio citado
├── tests/           # e2e: corre seeds y calcula métricas (+ prueba de realismo local)
└── docs/adr/        # decisiones
```

### Decisiones ya tomadas y no negociables (ADR)

- **ADR-001**: no se persiste PII/PHI. Los seeds son sintéticos y los IDs son opacos.
- **ADR-002**: las reglas son datos versionados, no código. Cada interpretación guarda `rule_set_version` y la traza de evaluación.
- **ADR-003**: la certeza se calcula de forma determinística, sin LLM ni costo por token.
- **ADR-004**: la API es el único punto de entrada y el motor no hace I/O.

> Los ADR-001 a 004 están resumidos aquí pero aún no existen como archivos en `docs/adr/` (solo la plantilla). Pendiente: redactarlos con `/adr`.

## Protocolo de inicio de sesión (léelo primero, cada vez)

Si estás retomando este proyecto sin contexto de una sesión anterior, sigue este orden — no lo saltes ni empieces a escribir código antes de completarlo:

1. `pwd` — confirma el directorio de trabajo real, no asumas.
2. Lee `git log --oneline -20` y `docs/progress/PROGRESS.md` para entender qué se hizo en la sesión anterior y por qué (no solo qué archivos cambiaron).
3. Lee `docs/progress/feature-list.json` y elige la feature de mayor prioridad con `"status": "failing"`. No trabajes en varias features a la vez — una por sesión, terminada y verificada, es mejor que tres a medias.
4. Corre `./scripts/init.sh` para levantar el entorno (servidor dev, dependencias) — no asumas que el entorno ya está corriendo de la sesión anterior.
5. Corre una verificación básica end-to-end (no solo `npm test`) antes de tocar código, para detectar si algo ya está roto de forma no documentada. Si algo está roto y no está en `PROGRESS.md`, documéntalo antes de seguir.
6. Implementa la feature elegida. Al terminar: corre los tests, marca `"status": "passing"` en `feature-list.json` **solo si la verificaste tú mismo, no porque "debería funcionar"**, actualiza `PROGRESS.md` con qué se hizo y qué queda pendiente, y haz commit con mensaje descriptivo.

### Cómo trabajar

1. **Una feature por sesión**, tomada de `feature-list.json`. Si descubres otra, regístrala como `failing`; no la implementes de paso.
2. **Planear antes de codificar** si el cambio toca más de ~3 archivos o un contrato de datos: propón el plan y espera confirmación.
3. **Tests primero** para lógica de negocio y parsers/interpretación. Regla propia de proyecto: _pendiente de definir_ (p. ej. "no mocks de la base de datos").
4. **Cambios pequeños y verificables**: un cambio lógico por commit.
5. Antes de elegir una librería o patrón nuevo, busca si el repo ya tiene uno equivalente.

### Definición de "terminado"

Una feature está terminada solo si se cumple todo:

- [ ] Verificación: el comando único de verificación (lint + tests + build; ver "Comandos de proyecto") pasa. El mismo comando corre en CI.
- [ ] Criterios de aceptación de la feature verificados con evidencia (salida del comando, no "debería funcionar").
- [ ] `feature-list.json` actualizado (`passing` solo si lo verificaste) y `PROGRESS.md` con lo hecho y lo pendiente.
- [ ] Si toca datos de paciente: revisión con `/clinical-review` o el agente `clinical-safety-compliance-reviewer`.
- [ ] Sin cambios fuera del alcance de la feature.

## Reglas no negociables sobre `feature-list.json`

- Es JSON, no Markdown, a propósito — el modelo tiende a editarlo con más cuidado en JSON que en texto libre.
- **Nunca borres ni edites un test para que una feature pase.** Si un test está mal escrito, dilo explícitamente y pide confirmación antes de tocarlo — no lo cambies en silencio para que el status cambie a passing.
- Solo se edita el campo `status` (y `notes` si aplica) de una feature existente. No reestructures el archivo completo sin que se te pida.
- Una feature nueva que descubras durante el trabajo (no estaba en la lista original) se agrega con `"status": "failing"`, no se implementa "de paso" sin registrarla.

## Reglas no negociables de dominio (salud + interoperabilidad)

- Ingestión de datos clínicos: en v1 el contrato es el JSON propio de `POST /v1/messages` (`packages/schema`), alimentado por un simulador de seeds. Mirth traduce upstream (HL7 v2/FHIR R4 → JSON) en una fase posterior, sin cambiar el contrato (ver ADR relevante en `docs/adr/`).
- Interpretación: determinística, sin LLM (ADR-003). Un LLM solo se reconsideraría como fallback de baja confianza con un ADR nuevo; hoy está fuera de v1. No se acepta texto libre en el contrato.
- Cualquier dato con PHI: nunca en logs, nunca en mensajes de error expuestos, nunca en nombres de archivo temporales. No se persiste PII/PHI (ADR-001): identificadores opacos (`case_id`); el payload crudo vive solo en memoria durante el request.
- Se persisten: interpretación, variables clínicas sin identificadores, mapeos, revisiones, versión de reglas.
- Tiempo: solo offsets relativos en minutos; nunca fechas exactas ni texto libre (riesgo de reidentificación).
- Multi-tenant: todo query/job corre con scope de un solo tenant, nunca cruza tenants.
- Residencia de datos y marco legal aplicable: Colombia (Ley 1581 de 2012 como marco de protección de datos). Un software de alerta de sepsis probablemente califica como dispositivo médico (SaMD) ante FDA e INVIMA: no bloquea una demo con datos sintéticos, pero es requisito previo a cualquier uso clínico. Residencia concreta de Vercel/Supabase: decisión pendiente.

### Certeza y derivación a revisión (determinística)

La certeza se calcula con tres componentes:

- **Completitud**: proporción de criterios evaluables sobre los totales (datos faltantes la reducen).
- **Margen**: cercanía de los valores a los umbrales de decisión.
- **Conflicto**: reglas que apuntan a clases distintas.

Si la certeza cae bajo un umbral configurable, el caso va a revisión clínica. La fórmula exacta y el umbral se calibran con los casos límite del gold standard.

### Reglas clínicas (sepsis / infección)

- Variables mínimas: FC, FR, TA, temperatura, SpO2, Glasgow, lactato, leucocitos, creatinina, bilirrubina, plaquetas, PaO2/FiO2 (si existe), cultivos y antibióticos ordenados, ICD-10 previos.
- Criterios candidatos: qSOFA, SIRS, SOFA, NEWS2, con referencia a Sepsis-3 y Surviving Sepsis Campaign. Umbrales y combinación final: decisión clínica, citada en cada regla (versión y sección de la guía).
- Reglas con id estable y versionado (ej. `sepsis.qsofa.v1`); variables canónicas con código LOINC y unidad UCUM; reglas en `knowledge/`, casos en `seeds/`.
- Para limitar la fatiga de alertas, el dashboard prioriza por gravedad y muestra siempre la regla que disparó y los valores que la sustentan.

### Convenciones del proyecto

- Errores: un mensaje inválido nunca se descarta en silencio. Devuelve una respuesta de error estructurada y queda contabilizado (la cobertura debe ser 100%). Nunca lanzar strings.
- Logging: logger estructurado; se registran `message_id`, `case_id`, clase, certeza e ids de reglas disparadas. Nunca el payload completo, ni PHI, ni valores clínicos de la solicitud.
- Textos de la UI: el visor de evaluación de reglas se llama **"red de evaluación de reglas"**. No es una red neuronal entrenada y no se describe como IA, ML ni red neuronal; la demo no debe sugerirlo.
- Config y secretos: por variable de entorno; nombres en `.env.example`. Nunca valores reales en el repo.
- Datos de prueba: sintéticos siempre. Los datasets de pacientes reales desidentificados (PhysioNet) se usan solo en local, no se commitean ni se publican.

## Región/mercado: agnóstico por defecto, se adapta cuando se le indica

Este harness no asume ningún país, idioma o marco regulatorio por defecto — el dominio (salud digital) es el mismo en cualquier región, pero la ley de protección de datos, el idioma del producto, y los patrones de residencia de datos NO lo son. Regla para todos los agentes:

- **Si este `AGENTS.md` (sección anterior) o el usuario especifica una región/mercado concreto**, todos los agentes deben adaptarse a esa jurisdicción: marco legal (HIPAA, GDPR, LGPD, Ley 1581 de Colombia, u otro), idioma del producto, convenciones de formato (fecha, teléfono, identificadores nacionales), y requisitos de residencia de datos. Para este proyecto: Colombia (ver "Reglas no negociables de dominio").
- **Si no se ha especificado ninguna**, ningún agente debe asumir una por defecto (ni Estados Unidos/HIPAA, ni ninguna otra) — se trata como una decisión de producto pendiente y se señala explícitamente en vez de inventar un marco legal o un idioma.
- Un mismo proyecto puede operar en varias jurisdicciones a la vez (ej. clientes en dos países con leyes distintas) — en ese caso el diseño debe soportar reglas de compliance/residencia por tenant, no una sola regla global.

## Comandos de proyecto

Aún no hay código ni `package.json`: los comandos no están definidos y no se deben inventar. Cuando existan, registrarlos aquí; el comando único de verificación (lint + tests + build) debe ser el mismo que corre en CI.

```bash
<comando de test>
<comando de lint>
<comando de build/dev>
<comando único de verificación: lint + tests + build>
```

## Equipo de subagentes especializados

Ver `.claude/agents/` y `docs/AGENT_TEAM.md` para el razonamiento completo. Estos son revisores/especialistas que invocas *dentro* de una sesión de trabajo, no reemplazan el protocolo de sesión de arriba — el agente principal sigue siendo quien lee `feature-list.json` y `PROGRESS.md` y decide qué hacer.

| Cuándo | Agente |
|---|---|
| Definir qué construir | `health-product-owner` |
| Contrato de datos clínicos (HL7/FHIR/Mirth) | `interoperability-architect` |
| Implementación backend | `backend-engineer` |
| Cualquier cosa con un LLM en el loop | `ai-ml-engineer` |
| Antes de mergear algo que toca datos de paciente | `clinical-safety-compliance-reviewer` |
| Antes de release a piloto / revisión adversarial de tests | `qa-test-engineer` |
| Flujos de staff o mensajes a paciente | `clinical-ux-designer` |
| Infra/despliegue | `devops-sre` |

**Nota honesta del artículo de Anthropic:** ellos mismos dejan esto como pregunta abierta, no como respuesta resuelta — "*whether specialized sub-agents... might outperform a single general-purpose agent across contexts*". No asumas que fragmentar en 8 subagentes es automáticamente mejor que un solo agente general con este mismo `AGENTS.md`; es una apuesta razonable para este dominio (los costos de error son muy distintos entre "bug de backend" y "fuga de PHI"), pero no está probada como universalmente superior — si en la práctica notas que la coordinación entre agentes cuesta más de lo que aporta, vuelve a un agente general y usa los `.md` de `.claude/agents/` como checklist de revisión manual en vez de subagentes invocados.

## Límites de autonomía

- Pedir aprobación antes de: agregar dependencias, cambiar el esquema de base de datos, cambiar un contrato de datos (ver ADR), borrar archivos, push.
- Nunca: commitear a `main`, force-push, leer o imprimir secretos, relajar un test para que pase.
- Si algo está ambiguo o contradice este archivo, preguntar; no asumir.

## Qué NO hacer

- No construir nada de "Fuera del alcance (NO construir)".
- No llamar "concordancia" ni "validación clínica" a la métrica del hito: es **"conformidad con criterios publicados (Sepsis-3/SSC); validación clínica pendiente"**.
- No cambiar la clase esperada de un seed para que pase. Si un seed falla, primero se decide si el bug está en el motor o en la clase esperada.
- No comparar 1:1 con PhysioNet/CinC 2019: sus etiquetas están adelantadas 6 horas respecto al inicio de sepsis, son binarias y vienen de UCI por hora. Las clases `vigilancia` y `revisión clínica` no existen en ninguna fuente externa: las define el equipo y deben citar el criterio aplicado.
- No usar fechas exactas, texto libre, ni loguear payloads o valores clínicos.
- Con menos de 100 seeds, 99% de conformidad equivale a cero discrepancias: no presentarlo como una cifra estadística.

## Referencias

- PRD / BRD: documento "Decidere MVP: Definición v2" (`claude/mvp-definicion-v2.md` en el proyecto de Claude).
- Diseño / mockups: pendiente. Tracker de issues: pendiente.
- Guías clínicas: Sepsis-3 y Surviving Sepsis Campaign (citar versión y sección en cada regla).
- Datasets: PhysioNet/CinC Challenge 2019 (verificar licencia en la página oficial antes de usar); Synthea, módulo de sepsis (opcional).
- APIs externas: ninguna en v1.

---

## Si este proyecto necesita algo Claude-específico

Si necesitas hooks, permisos granulares (`.claude/settings.json` ya los trae), o cualquier capacidad que no sea portable a otras herramientas, no lo metas aquí — crea un `CLAUDE.md` corto en la misma carpeta que solo cubra eso. Claude Code prioriza `CLAUDE.md` sobre `AGENTS.md` cuando ambos existen, así que puedes usar `AGENTS.md` como la fuente universal y `CLAUDE.md` como el complemento Claude-only, en vez de duplicar todo.
