# CLAUDE.md — Decidere AI

@AGENTS.md

Todo lo universal (alcance, dominio, protocolo de sesión, límites de autonomía) vive en `AGENTS.md`. Aquí solo lo específico de Claude Code:

| Tema | Dónde |
|---|---|
| Permisos (`deny` en `.env`/PHI, `ask` en push/deploy) y hook PHI | `.claude/settings.json`, `.claude/hooks/check_phi_patterns.py` |
| Subagentes | `.claude/agents/` (ver tabla en `AGENTS.md`), `docs/AGENT_TEAM.md` |
| Slash commands | `/session-start`, `/new-feature`, `/clinical-review`, `/adr`, `/initialize-project` (`.claude/commands/`) |
| Features, progreso, ADRs | `docs/progress/feature-list.json`, `docs/progress/PROGRESS.md`, `docs/adr/` |

- Al empezar una sesión usa `/session-start`; para una feature no planeada, `/new-feature`.
- Si el hook PHI bloquea una acción, no lo evadas: revisa el dato y usa uno sintético.
