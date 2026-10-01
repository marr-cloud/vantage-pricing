# Pruebas de la skill vantage-pricing — 2026-10-01

Método: sesiones nuevas `claude -p "<pregunta>" --allowedTools mcp__vantage-pricing__get_instance_price mcp__vantage-pricing__list_family`, cwd neutro (scratchpad), MCP `vantage-pricing` registrado a nivel usuario. Puntuación por grep sobre la respuesta final, más lectura manual.

## Escenarios

1. "¿Cuánto cuesta un m6a.xlarge al mes?"
2. "Compara db.m6g.large y db.r6g.large en PostgreSQL en sa-east-1."
3. "Necesito una instancia EC2 Graviton con al menos 32 GB de RAM, ¿cuál es la más barata de la familia m7g?"
4. "¿Cuánto me costaría Lambda con 1M invocaciones al mes?"

## RED — sin skill (control)

| Escenario | Reps | Usó tool | Región/variante | Tabla | Fuente (`source_url`) | Advertencia completa (EBS, transferencia, Multi-AZ, impuestos, descuentos) |
|---|---|---|---|---|---|---|
| 1 | 3 | 3/3 | 3/3 | 3/3 | 3/3 | 0/3 — menciona EBS y transferencia; nunca impuestos, descuentos ni Multi-AZ |
| 2 | 1 | 1/1 | 1/1 | 1/1 | 1/1 | parcial; además intentó verificar con `aws-mcp` (denegado) |
| 3 | 3 | 3/3 | 3/3 | 3/3 | 0/3 | 0/3 — ninguna advertencia |
| 4 | 1 | n/a (usó skill aws-billing-and-cost-management) | — | sí | — | cifras marcadas como no verificadas ✔ |

Diagnóstico: las descripciones de las tools ya producen buen uso de tools. Falla de tipo "omite un elemento requerido" (fuente y advertencia) → forma estructural: cierre obligatorio de dos líneas. Observado también: verificación cruzada no pedida (esc. 2) → condicional "consulta otra fuente solo si el usuario pide verificar".

## GREEN — con skill

| Escenario | Reps | Activó skill | Tools | Fuente | Advertencia completa |
|---|---|---|---|---|---|
| 1 | 3 | 3/3 | get_instance_price | 3/3 | 3/3 |
| 2 | 1 | 1/1 | get_instance_price (1 llamada, ambos tipos, sa-east-1, PostgreSQL); sin aws-mcp | 1/1 | 1/1 |
| 3 | 3 | 3/3 | list_family → get_instance_price | 3/3 | 3/3 |
| 4 | 1 | no (correcto: usó aws-billing-and-cost-management) | — | — | cifras marcadas "no pude verificar" ✔ |

Lectura manual de esc. 2 y 3: tablas correctas, región/variante explícitas, cierre literal de dos líneas. Esc. 2 señala como sospechoso db.r6g.large en sa-east-1 ($0.468/h, 2.08× us-east-1 vs 1.31× para m6g) y ofrece verificar — dato tal cual lo publica Vantage; no se pudo contrastar (aws-mcp sin conexión).

REFACTOR: no se observaron nuevos huecos; sin cambios.

## Kiro

Pendiente de verificación manual por el usuario (esc. 1 en Kiro con MCP y skill instalados).
