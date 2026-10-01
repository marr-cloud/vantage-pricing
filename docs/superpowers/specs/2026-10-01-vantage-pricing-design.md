# Vantage Pricing — Diseño

**Fecha:** 2026-10-01
**Estado:** aprobado; revisado 2026-10-01 tras verificar Kiro, RDS y URLs (ver "Cambios tras verificación")

## Objetivo

Dar a agentes de código (Claude Code y Kiro, por igual) acceso a precios aproximados de instancias AWS para responder preguntas de costo durante diseño y comparación de arquitecturas, en lugar de responder de memoria.

"Aproximado" = precio de lista público en USD, por hora y por mes, sin descuentos de cuenta.

## Alcance

**Incluido (v1):** servicios basados en instancias que cubre Vantage:

| Servicio | `service` en la API | Ejemplo de tipo |
|---|---|---|
| EC2 | `ec2` | `m6a.xlarge` |
| RDS | `rds` | `db.m6g.large` |
| ElastiCache | `cache` | `cache.m6g.large` |
| OpenSearch | `opensearch` | `m6g.large.search` |
| Redshift | `redshift` | `ra3.xlplus` |

**Excluido:** Lambda, S3, DynamoDB, NAT Gateway, transferencia de datos, EBS, Azure, GCP, otras monedas, regiones China, persistencia en disco, publicación en npm.

## Decisiones

| Decisión | Elección | Razón |
|---|---|---|
| Forma | Servidor MCP + un `SKILL.md` compartido | MCP y el estándar Agent Skills (`SKILL.md`) los soportan Claude Code y Kiro; la lógica vive en un solo lugar |
| Runtime | TypeScript, Node 18+ | SDK MCP maduro; existe cliente oficial de Vantage |
| Distribución | Local (`node <ruta>/dist/index.js`) | Iteración rápida; npm queda como paso posterior opcional |
| Fuente de datos | Endpoint de familia sin autenticación | Documentado como público; una llamada trae todos los tamaños |
| Token | No se usa | El endpoint de familia no lo requiere |

## Arquitectura

```
vantage/
├── mcp-server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── pricing/            # lógica pura, sin dependencia de MCP
│   │   │   ├── errors.ts       # PricingError y subclases
│   │   ├── vantage.ts      # fetch + caché en memoria
│   │   │   ├── parse.ts        # tipo de instancia → { service, family }
│   │   │   ├── price.ts        # normalización de precios y specs
│   │   └── service.ts      # orquestación de las dos consultas
│   ├── src/server.ts           # crea el McpServer y registra las tools
│   └── src/index.ts            # entrada stdio
│   └── test/
│       ├── fixtures/           # respuestas reales recortadas por servicio
│       └── *.test.ts
├── skill/vantage-pricing/SKILL.md   # mismo archivo para Claude Code y Kiro
└── README.md                   # instalación en Claude Code y Kiro
```

`pricing/` no importa nada de MCP, para poder probarlo aislado y montar un CLI encima en el futuro sin cambiar la lógica.

## Fuente de datos

- Endpoint: `GET https://instances-api.vantage.sh/api/v1/instances/{service}/families/{family}/global`
- Sin autenticación. Respuesta: array de instancias de la familia (≈50 KB–3.3 MB).
- Headers observados: `Cache-Control: max-age=10800`.
- Uso de `fetch` nativo de Node. El cliente oficial `@vantage-sh/instances-api-client` exige API key en el constructor; no se usa en v1.

### Forma de los precios por servicio

| Servicio | Ruta del precio | Variantes | Reserved disponible |
|---|---|---|---|
| ec2 | `pricing[region][os]` | `linux`, `mswin`, `rhel`, `sles`, `ubuntu`, `dedicated`, … (se excluyen claves sin `ondemand`, como los recargos `emr` y `eks_auto_mode`) | Standard, Convertible, InstanceSavings, Savings |
| rds | `pricing[region][engine]` | `MySQL`, `PostgreSQL`, `MariaDB`, `Oracle`, `SQL Server` (se excluyen claves numéricas —códigos internos de Vantage— y las que contienen "Outpost") | Standard (a veces falta `noUpfront` a 3 años) |
| cache | `pricing[region][engine]` | `Redis`, `Memcached` | Standard |
| opensearch | `pricing[region]` | ninguna | Standard |
| redshift | `pricing[region]` | ninguna | Standard |

Cada nodo de precio: `{ ondemand, reserved: { "yrTerm{1|3}{Tipo}.{allUpfront|partialUpfront|noUpfront}": precio_hora } }`. Los valores llegan como string (EC2) o número (resto); se normalizan a número.

Specs: EC2 usa `vCPU` y `memory`; el resto `vcpu` y `memory`, a veces como string. Se normalizan a `{ vcpu: number, memory_gib: number }`.

### Caché

`Map` en memoria keyed por `service/family`, TTL 3 h. Guarda la promesa, así dos consultas simultáneas a la misma familia hacen una sola petición; los errores no se cachean. Reloj y `fetch` inyectables para pruebas. Sin persistencia.

## Inferencia de servicio y familia

La entrada se normaliza con `trim()` y minúsculas. Reglas en orden; `service` explícito siempre las sobrescribe:

| Patrón | Servicio | Familia |
|---|---|---|
| `db.<fam>.<size>` | rds | `<fam>` |
| `cache.<fam>.<size>` | cache | `<fam>` |
| `<fam>.<size>.search` | opensearch | `<fam>` |
| `<fam>.<size>` con `<fam>` ∈ {`ra3`, `dc2`, `ds2`} | redshift | `<fam>` |
| `<fam>.<size>` | ec2 | `<fam>` |

`list_family` acepta la familia con o sin prefijo (`m6g`, `db.m6g`, `cache.m6g`) y lo quita.

## Tools MCP

### `get_instance_price`

| Parámetro | Tipo | Default |
|---|---|---|
| `instance_types` | `string[]`, 1–10 | requerido |
| `region` | `string` | `us-east-1` |
| `variant` | `string` | ec2 `linux`; rds `PostgreSQL`; cache `Redis`; ignorado en opensearch/redshift. Comparación sin distinguir mayúsculas; la salida usa el nombre canónico |
| `service` | `ec2 \| rds \| cache \| opensearch \| redshift` | inferido |

Salida (texto JSON, un objeto por instancia en un array `results`):

```json
{
  "instance_type": "m6a.xlarge",
  "service": "ec2",
  "region": "us-east-1",
  "variant": "linux",
  "available_variants": ["linux", "mswin", "rhel"],
  "specs": { "vcpu": 4, "memory_gib": 16 },
  "on_demand": { "hourly": 0.1728, "monthly": 126.14 },
  "reserved": {
    "1yr_no_upfront": { "hourly": 0.1143, "monthly": 83.45, "savings_pct": 34 },
    "3yr_no_upfront": { "hourly": 0.0784, "monthly": 57.22, "savings_pct": 55 },
    "1yr_savings_plan_no_upfront": { "hourly": 0.1397, "monthly": 101.94, "savings_pct": 19 }
  },
  "source_url": "https://instances.vantage.sh/aws/ec2/m6a.xlarge"
}
```

- `reserved` incluye un precio Standard a 1 año y otro a 3 años en todos los servicios, y un Savings Plan a 1 año (`yrTerm1Savings.*`) solo en EC2. Para cada plazo se usa la primera opción disponible en este orden: `noUpfront`, `partialUpfront`, `allUpfront`; la clave de salida la refleja (`1yr_no_upfront`, `3yr_partial_upfront`, `1yr_savings_plan_no_upfront`, …). Plazos sin ninguna opción se omiten.
- Un precio vacío, no numérico o ≤ 0 se trata como ausente.
- `savings_pct` = redondeo entero de `(1 − reserved/on_demand) × 100`.
- `source_url`: `https://instances.vantage.sh/aws/{segmento}/{instance_type}` con segmento `ec2`, `rds`, `elasticache` (para `cache`), `opensearch`, `redshift` (verificados, HTTP 200).

### `list_family`

| Parámetro | Tipo | Default |
|---|---|---|
| `family` | `string` | requerido |
| `service` | igual que arriba | inferido: prefijo `db.` → rds, `cache.` → cache, familia ∈ {`ra3`, `dc2`, `ds2`} → redshift, resto → ec2 (opensearch requiere `service` explícito) |
| `region` | `string` | `us-east-1` |
| `variant` | `string` | igual que arriba |

Salida: `{ family, service, region, variant, sizes: [{ instance_type, vcpu, memory_gib, hourly, monthly }] }` ordenado por `hourly` ascendente. Tamaños sin precio en esa región/variante se omiten.

### Convenciones

- USD. Mensual = hora × 730.
- Redondeo: hora a 4 decimales, mensual a 2.
- Comparación entre regiones: llamadas separadas (la caché las abarata).

## Manejo de errores

Las tools devuelven `isError: true` con un mensaje accionable. Nunca se fabrica un precio.

| Caso | Mensaje |
|---|---|
| Familia no existe (404) | `No existe la familia "<fam>" en <service>. Revisa el nombre o pasa "service".` |
| Familia existe, tamaño no | Lista de tamaños disponibles en la familia |
| Región sin precio | Lista de regiones con precio para esa instancia |
| Variante inexistente | Lista de `available_variants` |
| Red, 5xx o timeout (10 s) | `Vantage no respondió (<detalle>).` Sin reintentos |

En `get_instance_price` con varios tipos, un fallo individual se reporta como `{ instance_type, error }` dentro de `results`; la llamada solo es `isError` si fallan todos.

## Skill

Un único `skill/vantage-pricing/SKILL.md` (estándar Agent Skills) para los dos clientes:

- Frontmatter: `name: vantage-pricing` (igual al nombre de la carpeta) y `description` (≤ 1024 caracteres) que dispara ante preguntas de costo/precio de instancias EC2, RDS, ElastiCache, OpenSearch o Redshift, comparación de tipos por precio o estimación mensual.
- Instalación: la carpeta se enlaza (junction en Windows) en `~/.claude/skills/vantage-pricing` y `~/.kiro/skills/vantage-pricing`.

El cuerpo (≈60 líneas) instruye:

1. Consultar las tools en vez de responder de memoria.
2. Indicar siempre región, variante y si es on-demand o reserved.
3. Advertir: precio de lista; no incluye EBS, transferencia, Multi-AZ, impuestos ni descuentos de cuenta.
4. Comparaciones como tabla; enlazar `source_url`.
5. Servicios fuera de alcance: decir que la skill no los cubre; cualquier cifra de memoria se marca como "no verificada".

## Pruebas

1. **Unitarias (vitest) sobre `pricing/`:** tabla de inferencia; extracción y normalización con fixtures de los 5 servicios; región/variante faltante; caché con TTL usando `fetch` y reloj inyectados.
2. **Integración MCP:** levantar el servidor con el cliente del SDK; verificar `tools/list` y una llamada a `get_instance_price` con `fetch` respaldado por fixtures.
3. **Smoke en vivo** (solo con `LIVE=1`): `m6a.xlarge` en `us-east-1` devuelve `on_demand.hourly > 0`.
4. **Prueba de la skill** (proceso de `writing-skills`): con y sin la skill, preguntar "¿cuánto cuesta un m6a.xlarge al mes?"; con la skill debe invocarse la tool e incluirse las advertencias.

## Criterio de éxito

En Claude Code y en Kiro, "¿cuánto cuesta un m6a.xlarge al mes?" responde ≈ $126.14/mes on-demand (coincide con instances.vantage.sh), muestra opciones reserved y las advertencias.

## Cambios tras verificación (2026-10-01)

- Kiro soporta el estándar Agent Skills (`.kiro/skills/`, `~/.kiro/skills/`): se elimina el steering duplicado y su test de sincronía; un solo `SKILL.md`.
- RDS: las claves numéricas son códigos internos de Vantage; se excluyen junto con las variantes "Outpost".
- RDS no siempre trae `noUpfront` a 3 años: se agrega la cadena de respaldo `noUpfront` → `partialUpfront` → `allUpfront`.
- Segmentos de `source_url` verificados.
- Configuración MCP de Kiro: `~/.kiro/settings/mcp.json` (usuario) o `.kiro/settings/mcp.json` (workspace), formato `mcpServers` con `command`/`args`.
