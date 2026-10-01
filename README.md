# vantage-pricing

Precios de lista aproximados de instancias AWS (EC2, RDS, ElastiCache, OpenSearch, Redshift) para Claude Code y Kiro, usando la API pública de [Vantage](https://instances.vantage.sh). No requiere API key.

- `mcp-server/` — servidor MCP (stdio) con las tools `get_instance_price` y `list_family`.
- `skill/vantage-pricing/SKILL.md` — skill (estándar Agent Skills) que indica al agente cuándo y cómo usarlas.

## Requisitos

Node.js ≥ 18.

## Build

```bash
cd mcp-server
npm install
npm run build
npm test            # unit + integración con fixtures
LIVE=1 npx vitest run test/live.test.ts   # smoke contra la API real
```

## Instalar en Claude Code

```bash
claude mcp add vantage-pricing --scope user -- node <ruta-absoluta>/mcp-server/dist/index.js
```

Skill (junction en Windows, sin admin):

```powershell
New-Item -ItemType Junction -Path "$HOME\.claude\skills\vantage-pricing" -Target "<ruta-absoluta>\skill\vantage-pricing"
```

macOS/Linux: `ln -s <ruta-absoluta>/skill/vantage-pricing ~/.claude/skills/vantage-pricing`

## Instalar en Kiro

Agregar a `~/.kiro/settings/mcp.json` (o `.kiro/settings/mcp.json` del workspace):

```json
{
  "mcpServers": {
    "vantage-pricing": {
      "command": "node",
      "args": ["<ruta-absoluta>/mcp-server/dist/index.js"],
      "autoApprove": ["get_instance_price", "list_family"]
    }
  }
}
```

Skill:

```powershell
New-Item -ItemType Junction -Path "$HOME\.kiro\skills\vantage-pricing" -Target "<ruta-absoluta>\skill\vantage-pricing"
```

## Alcance y límites

- Precio de lista en USD; mensual = hora × 730.
- No incluye EBS, transferencia de datos, Multi-AZ, impuestos ni descuentos de cuenta.
- No cubre Lambda, S3, DynamoDB, NAT Gateway ni otros servicios no basados en instancias.
- Caché en memoria de 3 h por familia; reiniciar el servidor la limpia.
