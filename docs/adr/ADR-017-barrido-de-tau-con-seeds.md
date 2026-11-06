# ADR-017: Barrido de τ sobre los seeds (calibración, no validación)
**Fecha:** 2026-11-06
**Estado:** propuesto

**Contexto:**
ADR-015 fijó τ = 0.5 como valor provisional (`TAU_PROVISIONAL`) y pidió reportar el porcentaje enrutado a `revisión clínica` con τ 0.4, 0.5 y 0.6. F049 pide la curva "% a revisión frente a τ" sobre los seeds de ADR-016. Este ADR registra lo medido con `npm run seeds:tau`; no cambia τ, las bandas ni ninguna versión. Es calibración, no validación: τ provisional, no validado; los 46 seeds son sintéticos y provisionales y con menos de 100 seeds los porcentajes no son una cifra estadística. Cobertura de criterios: conformidad con criterios publicados; validación clínica pendiente.

**Decisión:**
1. Los seeds se dividen de forma determinística por hash del id: unos 30 % quedan reservados. Subconjunto de calibración: 36 seeds; reservado: 10 (solo el número; ese subconjunto NO se ha leído). Se corrió un proceso de la API por cada τ de la rejilla 0.1 a 1.0 en pasos de 0.1.
2. Curva del subconjunto de calibración (36 seeds, puntaje determinístico de certeza):

| τ | seeds | a revisión | % a revisión | críticos esperados | detectados | en revisión | no detectados | requieren confirmación |
|---|---|---|---|---|---|---|---|---|
| 0.1 | 36 | 3 | 8.3 % | 13 | 13 | 0 | 0 | 2 |
| 0.2 | 36 | 5 | 13.9 % | 13 | 13 | 0 | 0 | 2 |
| 0.3 | 36 | 7 | 19.4 % | 13 | 13 | 0 | 0 | 3 |
| 0.4 | 36 | 7 | 19.4 % | 13 | 13 | 0 | 0 | 3 |
| 0.5 | 36 | 7 | 19.4 % | 13 | 13 | 0 | 0 | 5 |
| 0.6 | 36 | 17 | 47.2 % | 13 | 13 | 0 | 0 | 8 |
| 0.7 | 36 | 17 | 47.2 % | 13 | 13 | 0 | 0 | 9 |
| 0.8 | 36 | 17 | 47.2 % | 13 | 13 | 0 | 0 | 9 |
| 0.9 | 36 | 17 | 47.2 % | 13 | 13 | 0 | 0 | 10 |
| 1.0 | 36 | 17 | 47.2 % | 13 | 13 | 0 | 0 | 10 |

   Ningún crítico esperado queda en revisión ni sin detectar en ningún τ. Referencia sobre los 46 seeds (no sobre el subconjunto): 9 enrutados en τ 0.5 y 23 en τ 0.6; 16 de 16 críticos detectados en 0.4, 0.5 y 0.6.
3. Salto estructural 0.5 a 0.6: de 7 a 17 de 36 (19.4 % a 47.2 %). No es una meseta ni un hallazgo de calibración: es la consecuencia de ADR-015 punto 7 (Glasgow entero con banda 1 limita el margen a 0.5 con GCS 15 conocido, así que para τ mayor que 0.5 ningún caso completo es `sin alerta`). Por eso "estable ante ±0.1" no puede cumplirse en 0.5 con las bandas actuales.
4. Regla de estabilidad PROVISIONAL (`STABILITY_MAX_DELTA`, 10 puntos porcentuales): ningún crítico en revisión ni perdido en τ y sus dos vecinos, y la variación de casos derivados entre τ y cada vecino de a lo sumo 10 puntos. Es una regla de ingeniería provisional, pendiente de criterio clínico; el 10 no tiene respaldo clínico.
   - Candidato 0.5 (el valor por defecto): seguro sí; variación máxima 27.8 puntos (7/36 en 0.4 y 0.5, 17/36 en 0.6); estable NO. Falla por el salto estructural del punto 3.
   - Candidato 0.4: seguro sí; vecinos 0.3, 0.4 y 0.5 con 7/36 cada uno; variación 0.0; estable SÍ.
   - Candidato 0.3 (medido también): seguro sí; variación máxima 5.6 puntos (5/36, 7/36, 7/36); estable sí.
5. Código de salida de `seeds:tau`: es una señal binaria sobre TODOS los seeds, incluidos los reservados; no distingue en qué subconjunto ocurrió el fallo.
6. Recomendación (solo para revisión, no es una decisión): **candidato 0.4 para revisión clínica**. Evidencia: pasa la regla provisional, ningún crítico en revisión ni sin detectar en 0.3 a 0.5, y su enrutamiento (7/36) coincide con el de 0.5 en el subconjunto de calibración. Límites: 36 seeds sintéticos con etiquetas provisionales; la igualdad 0.4 y 0.5 en este subconjunto no se extiende a otros datos; el subconjunto reservado no se ha leído; la regla del 10 es de ingeniería. Compromiso de seguridad clínica: bajar τ enruta menos casos a revisión, es decir, más casos límite o con datos faltantes conservan su clase automática (`sin alerta` o `vigilancia`) sin mirada humana; en la curva se ve en la fila 0.1 (3/36) frente a 0.5. Ese compromiso lo decide un clínico, no este ADR. Con las mismas evidencias 0.3 también pasa; no se recomienda por tener menos margen frente a esa pérdida de revisión.

**Alternativas consideradas:**
- Mantener τ = 0.5: queda en el borde estructural y no pasa la regla provisional; se conserva solo porque cambiarlo es una decisión pendiente.
- Subir τ a 0.6 o más: enruta a revisión todo caso completo con Glasgow 15 que no sea crítico (47.2 %); satura la cola y reintroduce fatiga de alertas.
- Cambiar la banda de Glasgow para eliminar el salto: cambia `CERTAINTY_VERSION`; es decisión clínica, fuera de esta feature.
- Elegir τ optimizando contra las etiquetas: descartado (F049: no optimizar sobre las etiquetas).

**Consecuencias:**
- Mejora: hay una curva reproducible (`npm run seeds:tau`) y una regla explícita de estabilidad.
- Más difícil: el criterio F049 "τ elegido" NO se cumple; F049 sigue `failing` hasta que el usuario y un clínico elijan τ y se lea el subconjunto reservado una sola vez.
- Riesgo aceptado: la regla de estabilidad y las etiquetas son provisionales; el conjunto es pequeño y sintético; el código de salida es binario.

**Decisiones abiertas:**
- (a) Cambiar o no `TAU_PROVISIONAL` (hoy 0.5; este ADR no lo cambia).
- (b) Cambiar o no la banda de Glasgow (sube `CERTAINTY_VERSION`; decisión clínica).
- (c) Quién corre `--held-out` y cuándo (una sola vez, después de elegir τ).
- (d) Revisión clínica de la regla de estabilidad y de `STABILITY_MAX_DELTA`.

**Referencias:** ADR-014, ADR-015 (puntos 6, 7, 8), ADR-016, ADR-003, `tests/runner/sweep-run.ts`, `seeds/README.md`, plan `docs/superpowers/plans/2026-11-06-f049-tau-sweep.md`.
