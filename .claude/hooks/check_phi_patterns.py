#!/usr/bin/env python3
"""
Hook PreToolUse — heurística de PHI, no DLP real.

Corre antes de Write/Edit/Bash y busca patrones que *sugieren* PHI cruda
(cédula/RUT-like, teléfono completo con prefijo de país, email de paciente
en texto plano fuera de un campo esperado) en el contenido que se va a
escribir o el comando que se va a ejecutar.

LIMITACIÓN CONOCIDA — léela antes de confiar en esto:
Esto es un regex heurístico, no un sistema de DLP. Tiene falsos negativos
(no detecta PHI que no matchea el patrón, ej. nombres propios sueltos) y
falsos positivos (puede marcar un ID de test ficticio). Su único trabajo
es hacer una pausa visible antes de una escritura sospechosa — no es una
garantía de cumplimiento y no reemplaza la revisión de
`clinical-safety-compliance-reviewer` ni una herramienta de DLP real.

Exit code 0 = permitir. Exit code 2 = bloquear y mostrar el motivo a Claude
(Claude ve el mensaje y puede decidir cómo proceder, no es un bloqueo mudo).
"""
import json
import re
import sys

# Patrones heurísticos — ajusta a tu jurisdicción real antes de confiar en esto.
PATTERNS = {
    "posible_cedula_co": re.compile(r"\b\d{1,3}\.\d{3}\.\d{3}\b"),
    "telefono_completo_con_pais": re.compile(r"\+\d{1,3}\s?\d{7,12}\b"),
    "email_en_texto_plano": re.compile(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+"),
}

# Rutas donde estos patrones son esperados y no deben bloquear (ajustar por proyecto)
ALLOWLIST_SUBSTRINGS = ["test", "fixture", "mock", "example", ".md"]


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)  # si no podemos parsear el input, no bloqueamos por error propio

    tool_name = payload.get("tool_name", "")
    tool_input = payload.get("tool_input", {}) or {}

    # Construye un blob de texto a inspeccionar según la herramienta
    if tool_name in ("Write", "Edit"):
        target_path = str(tool_input.get("file_path", ""))
        text = str(tool_input.get("content", "")) + str(tool_input.get("new_string", ""))
    elif tool_name == "Bash":
        target_path = ""
        text = str(tool_input.get("command", ""))
    else:
        sys.exit(0)

    if any(s in target_path.lower() for s in ALLOWLIST_SUBSTRINGS):
        sys.exit(0)

    hits = [name for name, pattern in PATTERNS.items() if pattern.search(text)]
    if hits:
        print(
            f"[check_phi_patterns] Posible dato sensible detectado ({', '.join(hits)}) "
            f"en una escritura hacia '{target_path or tool_name}'. Esto es una heurística, "
            f"no una confirmación — verifica si es PHI real antes de continuar, o si es un "
            f"falso positivo (dato de prueba, ejemplo en docs) procede conscientemente.",
            file=sys.stderr,
        )
        sys.exit(2)

    sys.exit(0)


if __name__ == "__main__":
    main()
