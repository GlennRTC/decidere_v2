# Equipo de agentes — Salud digital + IA

Recomendación de perfiles para un equipo de agentes (Claude Code subagents) especializado en soluciones digitales de salud con componentes de IA, basado en tu stack real (HL7v2/FHIR/Mirth, TypeScript/Node + PostgreSQL + Rust para componentes críticos, Python para NLP/LLM) y en los proyectos activos (recall-agent, composable health product, EHRLab). El equipo es agnóstico de región/mercado por defecto — se adapta a la jurisdicción que cada proyecto especifique en `AGENTS.md`, no asume ninguna (ver sección correspondiente en `AGENTS.md`).

## Principio de diseño

Un subagente de Claude Code es barato de invocar pero caro de mantener si tiene un scope difuso: cada uno debería tener **una responsabilidad y un criterio de "terminado" verificable**. Por eso la recomendación no es "un agente por título de LinkedIn" sino un equipo mínimo que cubre las decisiones que realmente cambian de naturaleza entre sí (clínica vs. arquitectura vs. implementación vs. UX vs. cumplimiento).

Construí 7. Podrías fusionar a 5 si el volumen de trabajo no lo justifica — ver "Cuándo fusionar" al final.

## Los 7 perfiles

### 1. `health-product-owner`
**Dueño de:** qué se construye y en qué orden, no cómo.
Traduce necesidad clínica/de negocio → historias de usuario con criterios de aceptación verificables. Mantiene BRD/PRD, prioriza backlog, define métricas de éxito (como el launch gate de recall-agent: conversion lift ≥2x baseline). No escribe código ni toma decisiones técnicas — cuando la ambigüedad es técnica, delega a `interoperability-architect` o `ai-ml-engineer` en vez de inventar una respuesta.

**Úsalo cuando:** empiezas una feature nueva, necesitas descomponer un épico, o dudas si algo es v1/v1.1/v1.2.

### 2. `interoperability-architect`
**Dueño de:** el contrato de datos clínicos — HL7 v2, FHIR R4, ASTM, mapeos Mirth, y las decisiones de ingestión (como ADR-001 de recall-agent: FHIR-only con Mirth traduciendo upstream).
Este es el que más se beneficia de tu SKILL.md existente — literalmente lo carga como contexto. Escribe ADRs, define resource shapes, decide qué falla duro vs. qué degrada.

**Úsalo cuando:** hay que decidir qué recurso FHIR carga qué dato, mapear un segmento HL7, o evaluar variancia entre vendors de EHR.

**Riesgo conocido:** un agente de IA puede sonar seguro sobre semántica de HL7/FHIR sin estar actualizado con el perfil específico del vendor (Epic vs. Cerner difieren en uso real de campos opcionales). Trátalo como borrador experto, no como fuente de verdad — valida contra la documentación del vendor real antes de construir sobre su output.

### 3. `backend-engineer`
**Dueño de:** implementación de servicios — TypeScript/Node + PostgreSQL, el worker Python para NLP/LLM, la máquina de estados de outreach (idempotente, como ADR-003).
Implementa lo que el architect y el PO ya decidieron; no re-decide contratos de datos por su cuenta.

**Úsalo cuando:** construyes el conector FHIR read, el scheduler, o la lógica de negocio del dominio.

### 4. `ai-ml-engineer`
**Dueño de:** todo lo que toca un LLM — el fallback constreñido (deterministic-first, LLM solo puede producir output Low-confidence, como en ADR-002), prompts, guardrails, evaluación.
Perfil separado del backend-engineer a propósito: las fallas de un LLM mal restringido en salud son cualitativamente distintas (alucinación clínica) de un bug de backend normal, y merecen quien piense explícitamente en eso.

**Úsalo cuando:** diseñas el fallback de interpretación, evalúas confidence thresholds, o decides qué nunca debe tocar el LLM (como los tokens con forma de nombre que van directo a revisión humana).

### 5. `clinical-safety-compliance-reviewer`
**Dueño de:** PHI, consentimiento, do-not-contact, retención de datos, y el mapeo al marco legal que aplique según la jurisdicción del proyecto (HIPAA, GDPR, LGPD, Ley 1581 de Colombia, u otro -- se confirma por proyecto, nunca se asume).
Es un revisor, no un implementador — su output es una lista de bloqueantes/riesgos, no código. Debería correr sobre cualquier feature que toque datos de paciente antes de merge, igual que hiciste en recall-agent con el Clinical-Informatics-Auditor skill.

**Úsalo cuando:** revisas una feature antes de producción, decides el suppression set de especialidades sensibles, o evalúas si un dato entra al registro clínico legal.

**Riesgo conocido — importante:** este agente NO reemplaza una opinión legal formal (viste esto tú mismo con la pregunta abierta, en un proyecto concreto, sobre si el contenido de WhatsApp es parte del registro clínico legal en esa jurisdicción particular). Úsalo para primera pasada y para no olvidar checks recurrentes; los hallazgos de alto riesgo van a un abogado de salud real, en la jurisdicción correspondiente al proyecto.

### 6. `qa-test-engineer`
**Dueño de:** casos borde y estrategia de pruebas — específicamente los que en salud son silenciosos hasta que duelen: duplicados/identity mismatch, fallas de entrega de WhatsApp, datos fuera de orden, condiciones de carrera en el scheduler multi-tenant.
Piensa en "qué pasa si llega dos veces", no en "el happy path funciona".

**Úsalo cuando:** antes de cualquier release a piloto, o al escribir tests para la máquina de estados de outreach.

### 7. `clinical-ux-designer`
**Dueño de:** los dos frentes de UX que tienes (staff web app + conversación de WhatsApp con paciente), con foco en quién es el usuario real: personal clínico con 30 segundos entre pacientes, y pacientes con literacidad digital variable.
Diseña el flujo, no el pixel — copy de WhatsApp, estados vacíos del dashboard, qué necesita ver un operador para decidir en 5 segundos si un caso va a revisión.

**Úsalo cuando:** diseñas la cola de revisión de staff, el digest diario, o los mensajes de WhatsApp al paciente (incluyendo consentimiento explícito).

## Cuándo fusionar (equipo de 5, si el volumen no justifica 7)

- Fusiona `qa-test-engineer` dentro de `backend-engineer` si trabajas solo — pero mantenlo como agente separado igual, invocado en modo "ahora revisa esto como QA adversarial", porque el mismo agente que escribió el código tiene sesgo de confirmación sobre su propio trabajo.
- Fusiona `clinical-ux-designer` dentro de `health-product-owner` si el producto es interno/simple.
- **No fusiones** `interoperability-architect` con `backend-engineer`, ni `clinical-safety-compliance-reviewer` con nadie — son los dos roles donde el costo de un error es más alto que el costo de coordinación extra.

## Lo que un equipo de agentes no resuelve

- No reemplaza la validación con clínicas piloto reales — recall-agent depende de 2 clínicas piloto 8+ semanas para el launch gate, y eso lo hacen personas, no agentes.
- No reemplaza tu propia revisión final: los agentes son buenos generando el primer 80% y detectando lo que un humano cansado pasa por alto, no tomando la decisión final en algo con riesgo clínico o legal.
- El "equipo" no colabora de forma autónoma entre sí por defecto — en Claude Code cada subagente corre en un contexto aislado; eres tú (o un orquestador que definas) quien decide la secuencia (PO → architect → backend → QA → compliance). Los comandos en `.claude/commands/` de este harness encapsulan esa secuencia para no tener que recordarla cada vez.
