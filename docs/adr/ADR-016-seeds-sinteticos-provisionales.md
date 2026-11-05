# ADR-016: Seeds sintéticos provisionales (formato, ids, etiquetas y divergencia con la certeza)
**Fecha:** 2026-11-06
**Estado:** propuesto

**Contexto:**
El hito exige decenas de casos sintéticos con clase esperada y criterio citado (F018) para que el runner (F050) calcule cobertura, sensibilidad de crítico y conformidad. Todavía no hay etiquetadores clínicos reales ni aprobación clínica. Sin una decisión explícita, un lector podría tomar las etiquetas por un gold standard o una divergencia con la capa de certeza por un fallo del motor. Todo lo de abajo es provisional.

**Decisión:**
1. **Formato:** `seeds/cases.json` (`SeedFile`) y `seeds/build.ts` (`SeedCase`, `buildMessage` al contrato 1.1). 46 casos: `clear_positive` 9, `clear_negative` 8, `boundary` 13, `missing_data` 9, `contradictory` 7; por clase: `critical` 16, `no_alert` 14, `watch` 9, `review` 7. Solo FR, TAS y Glasgow (variables de qSOFA), una instancia `current` por caso, históricas opcionales, tiempos como offsets relativos en minutos. Detalle en `seeds/README.md`.
2. **Ids determinísticos:** `message_id` e `instance_id` son UUID con forma v4 derivados de SHA-256 de `<tipo>:<id del caso>:<índice>`; los ids de caso son slugs legibles. Limitación: es un seudónimo reversible por diccionario si el formato se reutilizara con ids reales de un emisor; aceptable solo para datos sintéticos (ADR-001). No se hace aleatorio para que el runner y la idempotencia sean repetibles.
3. **Etiquetas provisionales:** `labeling: "provisional"`, etiquetadores `placeholder-A`, `placeholder-B`, sin árbitro, `clinical_approval.status: "pending"`. Se etiqueta con qSOFA (Singer 2016, Box 4) y la tabla de ADR-010 sin consultar el motor.
4. **Oráculo independiente (test):** `tests/seeds-cases.test.ts` recalcula la clase con una implementación que no importa el motor y la compara con cada etiqueta (46 de 46 coinciden; una auditoría con script aparte dio 0 diferencias). Limitación honesta: el oráculo es circular respecto a ADR-010. Codifica la misma tabla que el motor, escrita por el mismo equipo; prueba consistencia con la política provisional, no corrección clínica. Redacción obligatoria: "conformidad con criterios publicados; validación clínica pendiente". Con menos de 100 seeds, cero discrepancias no es una cifra estadística.
5. **Divergencia casos límite frente a certeza:** los casos cercanos al umbral se etiquetan por criterios; con τ = 0.5 (ADR-015) el motor enruta a `revisión clínica` los valores a menos de media banda de un umbral por ambos lados (lado sin alerta: FR 21 y TAS 101-104; lado vigilancia: FR 22 y 23, TAS 96-100). F050 debe: derivar estas divergencias de la RESPUESTA (esperado `watch` o `no_alert`, resultado `revisión clínica`, `routed_from` igual a la clase esperada y `reason_code` `low_certainty`; vale para cualquier categoría y τ, e incluye `con-sbp-low-01`), reportarlas aparte, imprimir τ y las marcas provisionales (`labeling`, placeholders, aprobación pendiente) en el encabezado del reporte y NO reetiquetar. Línea base medida con el motor real en τ = 0.5: 9 de 46 seeds enrutados con `routed_from` igual a la clase esperada (bnd-rr-21-01, bnd-rr-22-01, bnd-sbp-101-01, bnd-sbp-100-01, bnd-21-101-15-01, bnd-22-101-15-01, bnd-21-101-14-01, bnd-21-100-15-01, con-sbp-low-01); los 16 críticos esperados se devuelven como `crítico` en τ 0.4, 0.5 y 0.6. Las divergencias esperadas dependen de τ: con τ <= 0.5 son esas 9 (los `clear_negative` quedan en certeza exactamente 0.500 = τ); en τ = 0.6 todo caso completo con Glasgow 15 `sin alerta` o `vigilancia` (certeza 0.5) se enruta: 23 divergencias, 8 de 8 `clear_negative`, por el salto estructural de τ de ADR-015. Un `boundary` crítico conserva su clase (ADR-003) y no diverge; un crítico esperado que cae en revisión hace fallar el runner (ADR-010). No se agregó un campo `known_divergence` en los datos (decisión del controlador): F050 lo deriva.
6. **Hook PHI:** las rutas `seeds/` no están en la lista de exención del hook; `scan_phi` cubre `seeds/`. Un directorio con nombre tipo `seeds/test-*` quedaría exento del hook (no de `scan_phi`): no crearlo. El texto sintético con forma de correo del test del hook vive en `tests/`, ruta exenta por diseño. Un heredoc de Bash con ese texto fue bloqueado por el hook; no se evadió y el archivo se escribió con la herramienta Write.

**Alternativas consideradas:**
- Ids aleatorios: descartados; el runner y la idempotencia dejarían de ser repetibles.
- Campo `known_divergence` en los casos: descartado por ahora; F050 lo deriva de categoría y clase esperada.
- Reetiquetar los límite al comportamiento del motor: descartado; ocultaría la divergencia y haría circular la métrica.
- Incluir seeds SIRS o temporales: fuera de alcance (abajo).

**Consecuencias:**
- Mejora: el runner tiene casos repetibles, con criterio citado, sin datos de personas ni material de MIMIC o PhysioNet.
- Cuesta: las etiquetas no tienen valor clínico independiente hasta F019/F051; el reporte no puede presentar cero discrepancias como evidencia.
- Riesgo aceptado: las marcas provisionales viven solo en el JSON y en un test; si F050 no las imprime, el reporte puede leerse como validado.
- Pendientes: `/seeds/` tiene un solo propietario interino en CODEOWNERS (el autor puede aprobarse); la protección de rama es un ajuste del repositorio, no verificable aquí.
- Fuera de alcance: seeds SIRS (regla inactiva, ADR-013), seeds temporales de peor valor frente al último (ADR-010 pregunta 8), doble etiquetado real y kappa (F019/F051).

**Revisión de cumplimiento (agente de IA `clinical-safety-compliance-reviewer`; no es asesoría legal ni un clínico):** 0 bloqueantes, 2 mayores, 7 menores.
- Mayor 1: casos límite sin marca en los datos; resuelto con el punto 5 (documentación, sin campo nuevo).
- Mayor 2: el oráculo no es un segundo etiquetador; resuelto con el punto 4.
- Menores: ids derivados (punto 2); sin test de que `criterion`/`note` no contengan secuencias de 6 o más dígitos, `@` ni formato de fecha (hoy solo hook y `scan_phi`; no corregido); hueco de exención del hook en `seeds/test-*` (punto 6; el test cubre solo dos archivos fijos; no corregido); texto con forma de correo en `tests/` (punto 6; opcional construirlo en tiempo de ejecución; no corregido); marcas provisionales solo en JSON y test (punto 5); no presentar 99% como estadística; CODEOWNERS de un solo propietario.
- Preguntas legales nuevas: ninguna; SaMD (INVIMA/FDA) sigue pendiente para cualquier uso clínico.

**Preguntas clínicas abiertas:**
1. Aprobación clínica de las etiquetas y nombres reales de etiquetadores y árbitro.
2. Si los límite deben etiquetarse `review` cuando caen a menos de media banda (hoy se etiquetan por criterios).
3. ADR-010 pregunta 8 (peor valor frente al último) para seeds temporales.

**Handoffs:** F050 (punto 5), F019/F051 (reemplazar los placeholders), F039/F070 sin cambios.

**Referencias:** ADR-001, ADR-003, ADR-010, ADR-013, ADR-015; Singer et al., JAMA 2016 (Sepsis-3), Box 4; `docs/superpowers/plans/2026-11-06-f018-synthetic-seeds.md`.
