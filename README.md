# vantage-pricing

Precios de lista aproximados de instancias AWS (EC2, RDS, ElastiCache, OpenSearch, Redshift) para Claude Code y Kiro, usando la API pública de [Vantage](https://instances.vantage.sh). No requiere API key.

- `src/` — servidor MCP (stdio) con las tools `get_instance_price` y `list_family`.
- `skill/vantage-pricing/SKILL.md` — skill (estándar Agent Skills) que indica al agente cuándo y cómo usarlas.

## Requisitos

Node.js ≥ 18 para usarlo (≥ 22.12 para correr los tests) y git.

## Instalar el servidor MCP

Se ejecuta directo desde GitHub con `npx`; la primera vez compila (unos segundos) y luego queda en caché.

**Claude Code:**

```bash
# macOS / Linux
claude mcp add vantage-pricing --scope user -- npx -y github:marr-cloud/vantage-pricing
# Windows
claude mcp add vantage-pricing --scope user -- cmd /c npx -y github:marr-cloud/vantage-pricing
```

**Kiro** — agregar a `~/.kiro/settings/mcp.json` (o `.kiro/settings/mcp.json` del workspace):

```json
{
  "mcpServers": {
    "vantage-pricing": {
      "command": "npx",
      "args": ["-y", "github:marr-cloud/vantage-pricing"],
      "autoApprove": ["get_instance_price", "list_family"]
    }
  }
}
```

En Windows, si Kiro no encuentra `npx`, usar `"command": "cmd"` y `"args": ["/c", "npx", "-y", "github:marr-cloud/vantage-pricing"]`.

Para tomar una versión nueva del repo, borrar la caché de npx (`~/.npm/_npx`; en Windows `%LocalAppData%\npm-cache\_npx`) y reiniciar el cliente.

## Instalar la skill

```bash
git clone https://github.com/marr-cloud/vantage-pricing.git
```

Enlazar `skill/vantage-pricing` en el directorio de skills de cada cliente:

```powershell
# Windows (junction, sin admin)
New-Item -ItemType Junction -Path "$HOME\.claude\skills\vantage-pricing" -Target "<clon>\skill\vantage-pricing"
New-Item -ItemType Junction -Path "$HOME\.kiro\skills\vantage-pricing" -Target "<clon>\skill\vantage-pricing"
```

```bash
# macOS / Linux
ln -s <clon>/skill/vantage-pricing ~/.claude/skills/vantage-pricing
ln -s <clon>/skill/vantage-pricing ~/.kiro/skills/vantage-pricing
```

## Desarrollo

```bash
npm install          # también compila (prepare)
npm test             # unit + integración con fixtures
LIVE=1 npx vitest run test/live.test.ts   # smoke contra la API real
npm run build
```

Para probar cambios locales sin pasar por GitHub, registrar el servidor con `node <clon>/dist/index.js`.

## Alcance y límites

- Precio de lista en USD; mensual = hora × 730.
- No incluye EBS, transferencia de datos, Multi-AZ, impuestos ni descuentos de cuenta.
- No cubre Lambda, S3, DynamoDB, NAT Gateway ni otros servicios no basados en instancias.
- Caché en memoria de 3 h por familia; reiniciar el servidor la limpia.
