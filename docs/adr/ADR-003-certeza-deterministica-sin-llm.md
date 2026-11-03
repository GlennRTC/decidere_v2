# ADR-003: Certeza determinística, sin LLM
**Fecha:** 2026-11-03
**Estado:** aceptado

**Contexto:** El sistema debe decidir cuándo un caso es dudoso y derivarlo a revisión, de forma explicable y sin costo por token.

**Decisión:**
- Certeza = mínimo de completitud, margen y conflicto, cada uno en [0,1]. Es provisional hasta calibrar con el clínico.
- No se usa LLM, ni modelos entrenados, ni servicios con costo por token.
- La misma entrada produce siempre la misma salida.
- Un crítico nunca se degrada: conserva su clase y recibe la bandera "requiere confirmación". La revisión clínica solo reemplaza a vigilancia o sin alerta.
- Datos faltantes: se evalúa el mejor y el peor caso; "sin alerta" exige una completitud mínima.
- τ es configurable por entorno y se elige en una meseta estable, sin optimizar sobre las etiquetas.

**Alternativas consideradas:**
- LLM como fallback: se descarta (costo y no determinismo); solo se reconsideraría con un ADR nuevo.
- Promedio ponderado: se descarta, porque compensa componentes y oculta la causa.
- Producto: se descarta, porque penaliza doble y no es interpretable.

**Consecuencias:** El resultado es explicable y reproducible. Las bandas por variable y los pesos requieren decisión clínica. El mínimo puede enviar muchos casos a revisión. Se acepta calibrar con menos de 100 seeds, lo cual no es validación clínica.
