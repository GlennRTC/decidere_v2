---
description: Kickoff de una feature nueva no planeada -- la agrega a feature-list.json y la lleva a través de la secuencia del equipo (PO -> arquitectura -> implementación -> QA -> compliance). Para retomar una feature YA existente en feature-list.json, usa /session-start en vez de este comando.
argument-hint: <descripción breve de la feature>
---

Vas a dar de alta una feature nueva que no estaba en `docs/progress/feature-list.json` y coordinarla con la secuencia correcta de agentes. No la implementes "de paso" sin registrarla -- toda feature nueva se agrega a la lista antes de tocar código (ver regla no negociable en `AGENTS.md`).

Feature: $ARGUMENTS

Pasos:

1. Invoca `health-product-owner` para producir historias de usuario con criterios de aceptación verificables y marcar explícitamente si la feature toca PHI/consentimiento/comunicación al paciente (`requires_compliance_review`) o tiene decisiones técnicas de contrato de datos abiertas (`requires_clinical_data_contract`).
2. Agrega la feature a `docs/progress/feature-list.json` con `"status": "failing"` y el siguiente ID secuencial disponible -- esto pasa **antes** de implementar, no después.
3. Si `requires_clinical_data_contract` es true, invoca `interoperability-architect` para resolver el contrato y producir el ADR correspondiente antes de continuar.
4. Si hay un componente de LLM/interpretación de texto libre, invoca `ai-ml-engineer` para definir el marco de confianza/fallback antes de que el backend implemente sobre eso.
5. Presenta al usuario un resumen de 1) la historia, 2) decisiones técnicas tomadas, 3) qué falta decidir -- y espera confirmación antes de pasar a implementación, salvo que el usuario ya haya dicho que avances sin pausa.
6. Una vez confirmado, invoca `backend-engineer` (y `clinical-ux-designer` si hay superficie de usuario) para implementar.
7. Antes de marcar la feature como `passing`, invoca `qa-test-engineer` como revisor independiente del código producido en el paso 6 -- no dejes que el mismo agente que escribió el código certifique que está bien.
8. Si `requires_compliance_review` es true, invoca `clinical-safety-compliance-reviewer` como último paso antes de marcar `passing`.
9. Marca `status: "passing"` en `feature-list.json` solo después de que QA (y compliance si aplica) confirmaron, actualiza `docs/progress/PROGRESS.md`, y haz commit.

Reporta al final: qué se construyó, qué hallazgos de QA/compliance quedaron abiertos, y qué decisión (si alguna) sigue pendiente del usuario.
