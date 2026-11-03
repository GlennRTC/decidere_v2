---
description: Crea un nuevo Architecture Decision Record usando el formato estándar del proyecto
argument-hint: <tema de la decisión>
---

Crea un nuevo ADR para la siguiente decisión: $ARGUMENTS

1. Revisa `docs/adr/` para el próximo número secuencial disponible y para decisiones previas relacionadas (no contradigas una decisión previa sin decirlo explícitamente).
2. Si la decisión es sobre contrato de datos clínicos (HL7/FHIR/Mirth), invoca `interoperability-architect` para redactarla. Si es sobre arquitectura general del sistema, redáctala tú directamente con el mismo formato.
3. Usa este formato exacto:

```
# ADR-XXX: <título>
**Fecha:** <fecha>
**Estado:** propuesto
**Contexto:** ¿qué problema fuerza esta decisión?
**Decisión:** ¿qué se decidió, en términos concretos y verificables?
**Alternativas consideradas:** al menos una, con por qué se descartó
**Consecuencias:** qué mejora, y explícitamente qué se vuelve más difícil o qué riesgo se acepta
```

4. Guarda el archivo en `docs/adr/ADR-XXX-<slug>.md`.
5. Si la decisión afecta reglas no negociables del proyecto, recuerda al usuario actualizar la sección correspondiente en `AGENTS.md` (o `CLAUDE.md` si el proyecto usa ese en su lugar).
