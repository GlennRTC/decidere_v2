---
description: Corre una revisión de seguridad clínica y cumplimiento sobre el diff actual o un área específica del código
argument-hint: [área o archivo opcional; si se omite, revisa el diff actual contra main]
---

Invoca al subagente `clinical-safety-compliance-reviewer` sobre lo siguiente:

Alcance: ${ARGUMENTS:-el diff actual (git diff contra la rama base)}

Antes de invocarlo, reúne el contexto necesario: si no se especificó un área, corre `git diff` (o `git diff main...HEAD` si hay una rama base) para obtener el diff real; no le pidas al subagente que adivine qué cambió.

Después de recibir los hallazgos, si hay hallazgos bloqueantes, pregunta al usuario si quiere que se corrijan ahora (con `backend-engineer` o `ai-ml-engineer` según corresponda) o si los deja registrados como pendientes. No cierres la revisión asumiendo que los hallazgos bloqueantes se resolverán solos.
