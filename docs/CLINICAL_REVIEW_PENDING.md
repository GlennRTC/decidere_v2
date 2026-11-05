# Revisión clínica pendiente

**Estado:** el MVP funciona con reglas, bandas y umbrales **provisionales y sin validar**. Todo lo de abajo lo decidió el equipo con asesoría de agentes de IA (no clínicos). Un clínico humano debe revisarlo **antes de cualquier uso fuera de la demo con datos sintéticos**. Mientras tanto la demo declara: "Demo con datos sintéticos; no aprobado para uso clínico; conformidad con criterios publicados, validación clínica pendiente".

Decisión del usuario (2026-11-05): los hallazgos de las revisiones de IA no bloquean el MVP; se registran aquí para el clínico.

## Qué debe confirmar el clínico

| # | Tema | Valor provisional hoy | Detalle |
|---|---|---|---|
| 1 | Reglas qSOFA y SIRS | `sepsis.qsofa.v1` activa; `sepsis.sirs.v1` candidata inactiva, `clinical_approval: pending` | Umbrales de SIRS verificados solo con fuentes secundarias; leer la tabla primaria (Bone 1992). Ver ADR-013 |
| 2 | Severidad y política de clase | qSOFA ≥ 2 = crítico; qSOFA 1 completo = vigilancia; SIRS = vigilancia | ADR-010 (preguntas 1-9): sin ventana temporal, faltante = desconocido, qSOFA 0 completo = `sin alerta` |
| 3 | Bandas de margen por variable | FR 4, PAS 10, GCS 1, FC 10, T 0.5, leucocitos 2, PaCO2 4, bandas 2 | ADR-014. FR y GCS son poco fiables entre evaluadores; sin regla activa para FC, leucocitos, PaCO2, bandas |
| 4 | Margen de GCS (escala entera) | borde de medio entero: GCS 14 y 15 dan 0.5 | ADR-014 `certainty-provisional-2` |
| 5 | Definición de margen | mínimo sobre **todas** las hojas conocidas | Una hoja no contribuyente cerca del umbral puede marcar un crítico; alternativa: solo las hojas que deciden |
| 6 | Completitud | por criterios (hijos de la raíz `atLeast`) | Con qSOFA, datos faltantes nunca marcan un crítico si τ ≤ 0.667 |
| 7 | τ de certeza | 0.5 (`CERTAINTY_TAU`) | ADR-014/015. Con τ > 0.5 ningún caso completo puede ser `sin alerta`; el código no lo impide. Cambiar τ exige aprobación clínica en un PR |
| 8 | Enrutamiento a revisión | `vigilancia` y `sin alerta` con certeza < τ pasan a `revisión clínica` | ADR-015. Decidir si una vigilancia definida debe reenrutarse; volumen de la cola sin medir (reportar con τ 0.4/0.5/0.6 sobre los seeds) |
| 9 | Semántica de la bandera `requires_confirmation` | crítico con certeza < τ | Debe leerse "confirmar a la cabecera, tratar como crítico"; nunca bajar en el orden del dashboard |
| 10 | Falso consuelo en `sin alerta` | certeza máxima 0.5 con qSOFA | La UI debe decir "qSOFA no excluye sepsis" y llamar a la certeza "puntaje determinístico de certeza" (no probabilidad, no IA) |
| 11 | Proxy de sospecha de infección | no definido (F046 bloqueada) | SIRS sin criterio de infección no debería alertar sola |
| 12 | Cotas de plausibilidad de valores | cotas del schema provisionales (p. ej. temperatura mínima 25 Cel) | Falta un chequeo de rango clínico (F069) |
| 13 | Valores convertidos | sin redondear (13.3 kPa → ~99.76 mm[Hg]) | Decidir redondeo (ADR-011) |
| 14 | Independencia de etiquetadores del gold standard | por definir (F019) | Al menos uno que no haya escrito las reglas; kappa de Cohen |

## Requisitos previos a uso clínico (no bloquean la demo)
SaMD ante INVIMA/FDA, residencia de datos, marco legal aplicable, CODEOWNERS/aprobación rastreada para la política de clase y las bandas, F065 (uso previsto y limitaciones) y F028 (clasificación regulatoria).

## Dónde está el detalle
ADR-010, ADR-011, ADR-012, ADR-013, ADR-014, ADR-015; `docs/progress/PROGRESS.md` (sesiones 15-20); `feature-list.json` (F028, F046, F049, F069, F070).
