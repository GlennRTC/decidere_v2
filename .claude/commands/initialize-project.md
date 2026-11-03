---
description: Setup de una sola vez para un proyecto nuevo -- crea feature-list.json, PROGRESS.md, git init, y adapta init.sh. Correr UNA VEZ al arrancar el proyecto, no en cada sesión (para eso está /session-start).
argument-hint: <descripción del proyecto y sus features principales, o referencia a un BRD/PRD existente>
---

Eres el agente inicializador (rol distinto al de las sesiones normales de desarrollo -- esto corre una sola vez). Tu trabajo, siguiendo el patrón de ["Effective harnesses for long-running agents"](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents):

Contexto del proyecto: $ARGUMENTS

1. Si hay un BRD/PRD referenciado o adjunto, léelo completo antes de escribir nada. Si no hay ninguno y la descripción es vaga, invoca `health-product-owner` primero para descomponerla en historias verificables -- no inventes features de la nada.

2. Crea `docs/progress/feature-list.json` (copiando la estructura de `feature-list.template.json`) con **todas** las features identificadas, cada una con `"status": "failing"` -- incluso las obvias. El punto de marcar todo como failing desde el inicio es que las sesiones futuras tengan que verificar antes de marcar passing, no asumir.

3. Marca `requires_compliance_review: true` en cualquier feature que toque PHI, consentimiento, o comunicación directa al paciente, y `requires_clinical_data_contract: true` en cualquier feature que dependa de un mapeo HL7/FHIR aún no definido.

4. Inicializa `docs/progress/PROGRESS.md` con la entrada de Sesión 0 (ya viene en la plantilla -- solo confírmala o ajústala).

5. Adapta `scripts/init.sh` al stack real de este proyecto (comandos reales de instalar dependencias, levantar el servidor dev, y un health check end-to-end real) -- no lo dejes como esqueleto comentado.

6. Si el proyecto no tiene git inicializado, hazlo (`git init`) y crea el commit inicial con los archivos del harness.

7. Reporta al usuario: cuántas features se crearon, cuáles requieren compliance/data-contract, y si algo del BRD quedó ambiguo y necesita su input antes de que empiece la primera sesión de desarrollo real.
