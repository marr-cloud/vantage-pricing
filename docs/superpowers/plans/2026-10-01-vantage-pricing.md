# Vantage Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un servidor MCP local en TypeScript más un `SKILL.md` compartido que dan a Claude Code y Kiro precios de lista de instancias AWS (EC2, RDS, ElastiCache, OpenSearch, Redshift) desde la API pública de Vantage.

**Architecture:** `mcp-server/src/pricing/` es lógica pura (parseo de nombres, cliente HTTP con caché, normalización de precios, orquestación) sin dependencia de MCP. `server.ts` registra dos tools (`get_instance_price`, `list_family`) sobre esa lógica e `index.ts` la expone por stdio. `skill/vantage-pricing/SKILL.md` enseña al agente cuándo usar las tools y cómo presentar resultados; se enlaza en `~/.claude/skills/` y `~/.kiro/skills/`.

**Tech Stack:** Node ≥ 18 (desarrollo en Node 24), TypeScript 7.0, `@modelcontextprotocol/sdk` 1.31, `zod` 4, `vitest` 5. ESM.

**Spec:** `docs/superpowers/specs/2026-10-01-vantage-pricing-design.md`

## Global Constraints

- Fuente de datos: `GET https://instances-api.vantage.sh/api/v1/instances/{service}/families/{family}/global`, **sin** header `Authorization`.
- Servicios y su nombre en la API: `ec2`, `rds`, `cache` (ElastiCache), `opensearch`, `redshift`.
- USD. Mensual = hora × 730. Hora redondeada a 4 decimales, mensual a 2, `savings_pct` a entero. El mensual se calcula desde la hora **sin redondear**.
- Caché en memoria, TTL 3 h (10 800 000 ms), sin persistencia en disco.
- Timeout por petición: 10 s. Sin reintentos.
- `instance_types`: 1–10 elementos.
- Mensajes de error y textos de las tools en español. Identificadores de código en inglés.
- Nunca se fabrica un precio: si falta un dato se devuelve error accionable.
- `package.json` con `"type": "module"` y `"engines": { "node": ">=18" }`.
- Comandos de shell del plan en Git Bash (POSIX). Rutas absolutas del repo: `C:/Users/maurr/workspace/skills/vantage`.

## Review Focus

1. Entrada con mayúsculas/espacios (`" M6A.XLarge "`) → debe resolver igual que `m6a.xlarge`. Test en Task 1.
2. Dos tipos de la misma familia en una sola llamada (`["m6a.xlarge","m6a.2xlarge"]`) → una sola petición HTTP. Test en Task 2.
3. Variante con otro casing (`"postgresql"`, `"MSWIN"`) → resuelve al nombre canónico. Test en Task 3.
4. Precio on-demand vacío o `"0"` en los datos → error "sin precio on-demand", nunca `$0.00`. Test en Task 3.
5. Vantage responde HTML (página de error de CDN) o JSON que no es array → `UpstreamError`, no excepción sin manejar. Test en Task 2.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `mcp-server/package.json`, `tsconfig.json` | Proyecto Node/TS |
| `mcp-server/src/pricing/types.ts` | Tipos compartidos (`Service`, `RawInstance`, `Cost`, …) |
| `mcp-server/src/pricing/errors.ts` | `PricingError`, `InvalidInputError`, `NotFoundError`, `UpstreamError` |
| `mcp-server/src/pricing/parse.ts` | Nombre de instancia/familia → `{ service, family }` |
| `mcp-server/src/pricing/vantage.ts` | `VantageClient`: fetch + caché + errores HTTP |
| `mcp-server/src/pricing/price.ts` | Specs, regiones, variantes, nodo de precio, resumen reserved |
| `mcp-server/src/pricing/service.ts` | `getInstancePrices`, `listFamily`, `sourceUrl` |
| `mcp-server/src/server.ts` | `createServer(client)`: registra tools MCP |
| `mcp-server/src/index.ts` | Entrada stdio |
| `mcp-server/test/fixtures/*.json` | Datos reales recortados de la API (capturados 2026-10-01) |
| `mcp-server/test/helpers.ts` | `fixtureFetch` falso |
| `skill/vantage-pricing/SKILL.md` | Skill compartida Claude Code / Kiro |
| `README.md` | Instalación y uso |

---

### Task 1: Scaffold del proyecto, tipos, errores y parseo de nombres

**Files:**
- Create: `mcp-server/package.json`, `mcp-server/tsconfig.json`
- Create: `mcp-server/src/pricing/types.ts`, `mcp-server/src/pricing/errors.ts`, `mcp-server/src/pricing/parse.ts`
- Test: `mcp-server/test/parse.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `type Service = "ec2" | "rds" | "cache" | "opensearch" | "redshift"` y `const SERVICES: readonly Service[]`
  - `interface RawInstance { instance_type: string; vCPU?: number | string; vcpu?: number | string; memory?: number | string; pricing?: Record<string, unknown> }`
  - `interface Cost { hourly: number; monthly: number }`, `interface ReservedCost extends Cost { savings_pct: number }`, `interface Specs { vcpu: number | null; memory_gib: number | null }`
  - `class PricingError extends Error`, `class InvalidInputError extends PricingError`, `class NotFoundError extends PricingError`, `class UpstreamError extends PricingError`
  - `interface ParsedName { service: Service; family: string; instanceType: string }`
  - `parseInstanceType(input: string, service?: Service): ParsedName`
  - `parseFamily(input: string, service?: Service): Omit<ParsedName, "instanceType">`

- [ ] **Step 1: Crear el proyecto e instalar dependencias**

```bash
mkdir -p /c/Users/maurr/workspace/skills/vantage/mcp-server/src/pricing /c/Users/maurr/workspace/skills/vantage/mcp-server/test/fixtures
cd /c/Users/maurr/workspace/skills/vantage/mcp-server
cat > package.json <<'EOF'
{
  "name": "vantage-pricing-mcp",
  "version": "0.1.0",
  "private": true,
  "description": "MCP server con precios de lista de instancias AWS desde Vantage",
  "type": "module",
  "bin": { "vantage-pricing-mcp": "dist/index.js" },
  "engines": { "node": ">=18" },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "start": "node dist/index.js"
  }
}
EOF
cat > tsconfig.json <<'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true
  },
  "include": ["src"]
}
EOF
npm i @modelcontextprotocol/sdk@^1.31.0 zod@^4.6.5
npm i -D typescript@^7.0.2 @types/node vitest@^5.0.3
```

Expected: `node_modules/` creado, sin errores de npm.

- [ ] **Step 2: Escribir tipos y errores**

`mcp-server/src/pricing/types.ts`:

```ts
export const SERVICES = ["ec2", "rds", "cache", "opensearch", "redshift"] as const;
export type Service = (typeof SERVICES)[number];

/** Una instancia tal como la devuelve el endpoint de familia de Vantage. */
export interface RawInstance {
  instance_type: string;
  vCPU?: number | string;
  vcpu?: number | string;
  memory?: number | string;
  pricing?: Record<string, unknown>;
}

export interface Cost {
  hourly: number;
  monthly: number;
}

export interface ReservedCost extends Cost {
  savings_pct: number;
}

export interface Specs {
  vcpu: number | null;
  memory_gib: number | null;
}
```

`mcp-server/src/pricing/errors.ts`:

```ts
/** Error esperado cuyo mensaje se puede mostrar tal cual al agente. */
export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidInputError extends PricingError {}
export class NotFoundError extends PricingError {}
export class UpstreamError extends PricingError {}
```

- [ ] **Step 3: Escribir el test de parseo (falla)**

`mcp-server/test/parse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseInstanceType, parseFamily } from "../src/pricing/parse.js";
import { InvalidInputError } from "../src/pricing/errors.js";

describe("parseInstanceType", () => {
  it.each([
    ["m6a.xlarge", "ec2", "m6a", "m6a.xlarge"],
    ["t3.micro", "ec2", "t3", "t3.micro"],
    ["db.m6g.large", "rds", "m6g", "db.m6g.large"],
    ["cache.m6g.large", "cache", "m6g", "cache.m6g.large"],
    ["m6g.large.search", "opensearch", "m6g", "m6g.large.search"],
    ["ra3.xlplus", "redshift", "ra3", "ra3.xlplus"],
    ["dc2.large", "redshift", "dc2", "dc2.large"],
  ])("%s → %s/%s", (input, service, family, instanceType) => {
    expect(parseInstanceType(input)).toEqual({ service, family, instanceType });
  });

  it("normaliza mayúsculas y espacios", () => {
    expect(parseInstanceType("  M6A.XLarge ")).toEqual({
      service: "ec2",
      family: "m6a",
      instanceType: "m6a.xlarge",
    });
  });

  it("respeta service explícito", () => {
    expect(parseInstanceType("m6g.large", "opensearch")).toEqual({
      service: "opensearch",
      family: "m6g",
      instanceType: "m6g.large",
    });
  });

  it.each(["", "m6a", "db.", ".xlarge"])("rechaza %j", (input) => {
    expect(() => parseInstanceType(input)).toThrow(InvalidInputError);
  });
});

describe("parseFamily", () => {
  it.each([
    ["m6a", "ec2", "m6a"],
    ["db.m6g", "rds", "m6g"],
    ["cache.m6g", "cache", "m6g"],
    ["ra3", "redshift", "ra3"],
    [" T3 ", "ec2", "t3"],
  ])("%s → %s/%s", (input, service, family) => {
    expect(parseFamily(input)).toEqual({ service, family });
  });

  it("respeta service explícito", () => {
    expect(parseFamily("m6g", "opensearch")).toEqual({ service: "opensearch", family: "m6g" });
  });

  it.each(["", "db.", "m6a.xlarge"])("rechaza %j", (input) => {
    expect(() => parseFamily(input)).toThrow(InvalidInputError);
  });
});
```

- [ ] **Step 4: Ejecutar y verificar que falla**

Run: `cd /c/Users/maurr/workspace/skills/vantage/mcp-server && npx vitest run test/parse.test.ts`
Expected: FAIL — `Failed to load url ../src/pricing/parse.js` (el módulo no existe).

- [ ] **Step 5: Implementar `parse.ts`**

`mcp-server/src/pricing/parse.ts`:

```ts
import { InvalidInputError } from "./errors.js";
import type { Service } from "./types.js";

export interface ParsedName {
  service: Service;
  family: string;
  instanceType: string;
}

const REDSHIFT_FAMILIES = new Set(["ra3", "dc2", "ds2"]);
const PREFIXES: ReadonlyArray<[string, Service]> = [
  ["db.", "rds"],
  ["cache.", "cache"],
];

function stripPrefix(name: string): { rest: string; prefixService?: Service } {
  for (const [prefix, service] of PREFIXES) {
    if (name.startsWith(prefix)) return { rest: name.slice(prefix.length), prefixService: service };
  }
  return { rest: name };
}

export function parseInstanceType(input: string, service?: Service): ParsedName {
  const instanceType = input.trim().toLowerCase();
  const { rest, prefixService } = stripPrefix(instanceType);
  const parts = rest.split(".");
  if (parts.length < 2 || parts.some((p) => p === "")) {
    throw new InvalidInputError(
      `Tipo de instancia inválido: "${input}". Ejemplos: m6a.xlarge, db.m6g.large, cache.m6g.large.`,
    );
  }
  const family = parts[0];
  const inferred: Service =
    prefixService ??
    (instanceType.endsWith(".search")
      ? "opensearch"
      : REDSHIFT_FAMILIES.has(family)
        ? "redshift"
        : "ec2");
  return { service: service ?? inferred, family, instanceType };
}

export function parseFamily(input: string, service?: Service): Omit<ParsedName, "instanceType"> {
  const name = input.trim().toLowerCase();
  const { rest: family, prefixService } = stripPrefix(name);
  if (family === "" || family.includes(".")) {
    throw new InvalidInputError(`Familia inválida: "${input}". Ejemplos: m6a, db.m6g, cache.m6g, ra3.`);
  }
  const inferred: Service = prefixService ?? (REDSHIFT_FAMILIES.has(family) ? "redshift" : "ec2");
  return { service: service ?? inferred, family };
}
```

- [ ] **Step 6: Ejecutar y verificar que pasa; compilar**

Run: `cd /c/Users/maurr/workspace/skills/vantage/mcp-server && npx vitest run test/parse.test.ts && npx tsc --noEmit`
Expected: todos los tests PASS; `tsc` sin salida.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/maurr/workspace/skills/vantage
git add mcp-server/package.json mcp-server/package-lock.json mcp-server/tsconfig.json mcp-server/src mcp-server/test/parse.test.ts
git commit -m "feat(mcp): scaffold project and instance name parsing"
```

---

### Task 2: Cliente Vantage con caché, fixtures y fetch falso

**Files:**
- Create: `mcp-server/src/pricing/vantage.ts`
- Create: `mcp-server/test/helpers.ts`
- Create: `mcp-server/test/fixtures/ec2-m6a.json`, `rds-m6g.json`, `cache-m6g.json`, `opensearch-m6g.json`, `redshift-ra3.json`
- Test: `mcp-server/test/vantage.test.ts`

**Interfaces:**
- Consumes: `Service`, `RawInstance` (types.ts); `NotFoundError`, `UpstreamError` (errors.ts).
- Produces:
  - `interface FetchResponse { ok: boolean; status: number; json(): Promise<unknown> }`
  - `type FetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<FetchResponse>`
  - `interface VantageClientOptions { fetch?: FetchFn; now?: () => number; ttlMs?: number; timeoutMs?: number; baseUrl?: string }`
  - `class VantageClient { constructor(opts?: VantageClientOptions); getFamily(service: Service, family: string): Promise<RawInstance[]> }`
  - `const DEFAULT_BASE_URL = "https://instances-api.vantage.sh"`
  - test helper `fixtureFetch(calls?: string[]): FetchFn` y `FIXTURES: Record<string, RawInstance[]>` (clave `"{service}/{family}"`)

- [ ] **Step 1: Crear los fixtures**

Datos reales de la API recortados a pocas instancias, regiones y claves (capturados 2026-10-01). No regenerarlos: los tests dependen de estos valores exactos.

`mcp-server/test/fixtures/ec2-m6a.json`:

```json
[
  {
    "instance_type": "m6a.2xlarge",
    "vCPU": 8,
    "memory": 32,
    "pricing": {
      "us-east-1": {
        "linux": { "ondemand": "0.3456", "reserved": { "yrTerm1Standard.noUpfront": "0.22861", "yrTerm3Standard.noUpfront": "0.15676" } }
      }
    }
  },
  {
    "instance_type": "m6a.xlarge",
    "vCPU": 4,
    "memory": 16,
    "pricing": {
      "us-east-1": {
        "linux": {
          "ondemand": "0.1728",
          "reserved": {
            "yrTerm1Savings.noUpfront": "0.13965",
            "yrTerm1Standard.noUpfront": "0.11431",
            "yrTerm1Standard.partialUpfront": "0.108882",
            "yrTerm3Standard.noUpfront": "0.07838",
            "yrTerm3Standard.partialUpfront": "0.072591"
          }
        },
        "mswin": { "ondemand": "0.3568", "reserved": { "yrTerm1Standard.noUpfront": "0.29831", "yrTerm3Standard.noUpfront": "0.26238" } },
        "emr": { "emr": "0.0432" }
      },
      "eu-west-1": {
        "linux": { "ondemand": "0.1926", "reserved": { "yrTerm1Standard.noUpfront": "0.1274", "yrTerm3Standard.noUpfront": "0.08736" } }
      }
    }
  }
]
```

`mcp-server/test/fixtures/rds-m6g.json` (la clave `"2"` es un código interno real de Vantage; la variante Outpost se incluye para probar el filtro):

```json
[
  {
    "instance_type": "db.m6g.large",
    "vcpu": "2",
    "memory": "8",
    "pricing": {
      "us-east-1": {
        "2": { "ondemand": 0.152, "reserved": { "yrTerm1Standard.noUpfront": 0.0973 } },
        "MySQL": { "ondemand": 0.152, "reserved": { "yrTerm1Standard.noUpfront": 0.0973, "yrTerm3Standard.partialUpfront": 0.06236438356164384 } },
        "PostgreSQL": {
          "ondemand": 0.159,
          "reserved": {
            "yrTerm1Standard.noUpfront": 0.1018,
            "yrTerm1Standard.partialUpfront": 0.09701598173515982,
            "yrTerm3Standard.partialUpfront": 0.0652103500761035
          }
        },
        "PostgreSQL (on-premise for Outpost)": { "ondemand": 0.082, "reserved": {} }
      }
    }
  },
  {
    "instance_type": "db.m6g.xlarge",
    "vcpu": "4",
    "memory": "16",
    "pricing": {
      "us-east-1": {
        "PostgreSQL": { "ondemand": 0.318, "reserved": { "yrTerm1Standard.noUpfront": 0.2037, "yrTerm3Standard.partialUpfront": 0.13038264840182648 } }
      }
    }
  }
]
```

`mcp-server/test/fixtures/cache-m6g.json`:

```json
[
  {
    "instance_type": "cache.m6g.large",
    "vcpu": "2",
    "memory": "6.38",
    "pricing": {
      "us-east-1": {
        "Memcached": { "ondemand": 0.149, "reserved": { "yrTerm1Standard.noUpfront": 0.102, "yrTerm3Standard.noUpfront": 0.077 } },
        "Redis": { "ondemand": 0.149, "reserved": { "yrTerm1Standard.noUpfront": 0.102, "yrTerm3Standard.noUpfront": 0.077 } }
      }
    }
  }
]
```

`mcp-server/test/fixtures/opensearch-m6g.json`:

```json
[
  {
    "instance_type": "m6g.large.search",
    "vcpu": "2",
    "memory": "8",
    "pricing": {
      "us-east-1": { "ondemand": 0.128, "reserved": { "yrTerm1Standard.noUpfront": 0.088, "yrTerm3Standard.noUpfront": 0.067 } }
    }
  }
]
```

`mcp-server/test/fixtures/redshift-ra3.json`:

```json
[
  {
    "instance_type": "ra3.xlplus",
    "vcpu": "4",
    "memory": "32",
    "pricing": {
      "us-east-1": { "ondemand": 1.086, "reserved": { "yrTerm1Standard.noUpfront": 0.7602, "yrTerm3Standard.noUpfront": 0.4725 } }
    }
  }
]
```

- [ ] **Step 2: Crear el helper de fetch falso**

`mcp-server/test/helpers.ts`:

```ts
import ec2 from "./fixtures/ec2-m6a.json";
import rds from "./fixtures/rds-m6g.json";
import cache from "./fixtures/cache-m6g.json";
import opensearch from "./fixtures/opensearch-m6g.json";
import redshift from "./fixtures/redshift-ra3.json";
import type { FetchFn } from "../src/pricing/vantage.js";
import type { RawInstance } from "../src/pricing/types.js";

export const FIXTURES: Record<string, RawInstance[]> = {
  "ec2/m6a": ec2 as RawInstance[],
  "rds/m6g": rds as RawInstance[],
  "cache/m6g": cache as RawInstance[],
  "opensearch/m6g": opensearch as RawInstance[],
  "redshift/ra3": redshift as RawInstance[],
};

/** Responde con FIXTURES según la URL; 404 si no hay fixture. Registra cada URL en `calls`. */
export function fixtureFetch(calls: string[] = []): FetchFn {
  return async (url) => {
    calls.push(url);
    const m = url.match(/\/instances\/([^/]+)\/families\/([^/]+)\/global$/);
    const data = m ? FIXTURES[`${m[1]}/${m[2]}`] : undefined;
    if (!data) return { ok: false, status: 404, json: async () => ({ error: "Family not found" }) };
    return { ok: true, status: 200, json: async () => structuredClone(data) };
  };
}
```

- [ ] **Step 3: Escribir el test del cliente (falla)**

`mcp-server/test/vantage.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { VantageClient, type FetchFn } from "../src/pricing/vantage.js";
import { NotFoundError, UpstreamError } from "../src/pricing/errors.js";
import { fixtureFetch } from "./helpers.js";

describe("VantageClient.getFamily", () => {
  it("pide la URL de familia global y devuelve el array", async () => {
    const calls: string[] = [];
    const client = new VantageClient({ fetch: fixtureFetch(calls) });
    const data = await client.getFamily("ec2", "m6a");
    expect(calls).toEqual(["https://instances-api.vantage.sh/api/v1/instances/ec2/families/m6a/global"]);
    expect(data.map((i) => i.instance_type)).toEqual(["m6a.2xlarge", "m6a.xlarge"]);
  });

  it("no envía header Authorization", async () => {
    let seenInit: unknown;
    const spy: FetchFn = async (_url, init) => {
      seenInit = init;
      return { ok: true, status: 200, json: async () => [] };
    };
    await new VantageClient({ fetch: spy }).getFamily("ec2", "m6a");
    expect(JSON.stringify(seenInit ?? {})).not.toMatch(/authorization/i);
  });

  it("cachea por service/family durante el TTL y luego vuelve a pedir", async () => {
    const calls: string[] = [];
    let t = 0;
    const client = new VantageClient({ fetch: fixtureFetch(calls), now: () => t, ttlMs: 1000 });
    await client.getFamily("ec2", "m6a");
    t = 999;
    await client.getFamily("ec2", "m6a");
    expect(calls).toHaveLength(1);
    t = 1000;
    await client.getFamily("ec2", "m6a");
    expect(calls).toHaveLength(2);
  });

  it("deduplica peticiones simultáneas a la misma familia", async () => {
    const calls: string[] = [];
    const client = new VantageClient({ fetch: fixtureFetch(calls) });
    await Promise.all([client.getFamily("ec2", "m6a"), client.getFamily("ec2", "m6a")]);
    expect(calls).toHaveLength(1);
  });

  it("404 → NotFoundError con mensaje accionable", async () => {
    const client = new VantageClient({ fetch: fixtureFetch() });
    await expect(client.getFamily("ec2", "x9z")).rejects.toThrow(NotFoundError);
    await expect(client.getFamily("ec2", "x9z")).rejects.toThrow(
      'No existe la familia "x9z" en ec2. Revisa el nombre o pasa "service".',
    );
  });

  it("5xx → UpstreamError y no se cachea el error", async () => {
    let n = 0;
    const flaky: FetchFn = async () => {
      n++;
      return n === 1
        ? { ok: false, status: 503, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => [] };
    };
    const client = new VantageClient({ fetch: flaky });
    await expect(client.getFamily("ec2", "m6a")).rejects.toThrow("Vantage no respondió (HTTP 503).");
    await expect(client.getFamily("ec2", "m6a")).resolves.toEqual([]);
  });

  it("error de red → UpstreamError", async () => {
    const broken: FetchFn = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(new VantageClient({ fetch: broken }).getFamily("ec2", "m6a")).rejects.toThrow(
      "Vantage no respondió (fetch failed).",
    );
  });

  it("respuesta no-JSON (HTML de CDN) → UpstreamError", async () => {
    const html: FetchFn = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token '<'");
      },
    });
    await expect(new VantageClient({ fetch: html }).getFamily("ec2", "m6a")).rejects.toThrow(UpstreamError);
  });

  it("JSON que no es array → UpstreamError", async () => {
    const obj: FetchFn = async () => ({ ok: true, status: 200, json: async () => ({ error: "x" }) });
    await expect(new VantageClient({ fetch: obj }).getFamily("ec2", "m6a")).rejects.toThrow(
      "Vantage no respondió (respuesta inesperada).",
    );
  });
});
```

- [ ] **Step 4: Ejecutar y verificar que falla**

Run: `cd /c/Users/maurr/workspace/skills/vantage/mcp-server && npx vitest run test/vantage.test.ts`
Expected: FAIL — no se puede cargar `../src/pricing/vantage.js`.

- [ ] **Step 5: Implementar `vantage.ts`**

`mcp-server/src/pricing/vantage.ts`:

```ts
import { NotFoundError, PricingError, UpstreamError } from "./errors.js";
import type { RawInstance, Service } from "./types.js";

export interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
export type FetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<FetchResponse>;

export interface VantageClientOptions {
  fetch?: FetchFn;
  now?: () => number;
  ttlMs?: number;
  timeoutMs?: number;
  baseUrl?: string;
}

export const DEFAULT_BASE_URL = "https://instances-api.vantage.sh";
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

export class VantageClient {
  private readonly fetchFn: FetchFn;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;
  private readonly cache = new Map<string, { at: number; data: Promise<RawInstance[]> }>();

  constructor(opts: VantageClientOptions = {}) {
    this.fetchFn = opts.fetch ?? ((url, init) => fetch(url, init));
    this.now = opts.now ?? Date.now;
    this.ttlMs = opts.ttlMs ?? THREE_HOURS_MS;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  }

  getFamily(service: Service, family: string): Promise<RawInstance[]> {
    const key = `${service}/${family}`;
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.data;

    const data = this.load(service, family);
    this.cache.set(key, { at: this.now(), data });
    data.catch(() => {
      if (this.cache.get(key)?.data === data) this.cache.delete(key);
    });
    return data;
  }

  private async load(service: Service, family: string): Promise<RawInstance[]> {
    const url = `${this.baseUrl}/api/v1/instances/${service}/families/${encodeURIComponent(family)}/global`;
    let body: unknown;
    try {
      const res = await this.fetchFn(url, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (res.status === 404) {
        throw new NotFoundError(`No existe la familia "${family}" en ${service}. Revisa el nombre o pasa "service".`);
      }
      if (!res.ok) throw new UpstreamError(`Vantage no respondió (HTTP ${res.status}).`);
      body = await res.json();
    } catch (err) {
      if (err instanceof PricingError) throw err;
      throw new UpstreamError(`Vantage no respondió (${err instanceof Error ? err.message : String(err)}).`);
    }
    if (!Array.isArray(body)) throw new UpstreamError("Vantage no respondió (respuesta inesperada).");
    return body as RawInstance[];
  }
}
```

- [ ] **Step 6: Ejecutar y verificar que pasa**

Run: `cd /c/Users/maurr/workspace/skills/vantage/mcp-server && npx vitest run && npx tsc --noEmit`
Expected: todos PASS; `tsc` sin salida.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/maurr/workspace/skills/vantage
git add mcp-server/src/pricing/vantage.ts mcp-server/test/helpers.ts mcp-server/test/fixtures mcp-server/test/vantage.test.ts
git commit -m "feat(mcp): Vantage family client with in-memory cache"
```

---

### Task 3: Normalización de precios

**Files:**
- Create: `mcp-server/src/pricing/price.ts`
- Test: `mcp-server/test/price.test.ts`

**Interfaces:**
- Consumes: `Service`, `RawInstance`, `Cost`, `ReservedCost`, `Specs` (types.ts); `NotFoundError` (errors.ts); `FIXTURES` (test/helpers.ts).
- Produces:
  - `const HOURS_PER_MONTH = 730`
  - `const DEFAULT_VARIANT: Record<Service, string | null>` → `{ ec2: "linux", rds: "PostgreSQL", cache: "Redis", opensearch: null, redshift: null }`
  - `toCost(hourly: number): Cost`
  - `specsOf(raw: RawInstance): Specs`
  - `regionsOf(raw: RawInstance): string[]` (ordenadas)
  - `variantsOf(service: Service, raw: RawInstance, region: string): string[]` (ordenadas)
  - `interface PriceNode { ondemand: number; reserved: Record<string, number> }`
  - `interface ResolvedPrice { variant: string | null; available_variants: string[]; node: PriceNode }`
  - `resolvePrice(service: Service, raw: RawInstance, region: string, variant?: string): ResolvedPrice` — lanza `NotFoundError`
  - `reservedSummary(service: Service, node: PriceNode): Record<string, ReservedCost>`

- [ ] **Step 1: Escribir el test (falla)**

Valores esperados calculados con las fórmulas de Global Constraints sobre los fixtures.

`mcp-server/test/price.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  toCost,
  specsOf,
  regionsOf,
  variantsOf,
  resolvePrice,
  reservedSummary,
} from "../src/pricing/price.js";
import { NotFoundError } from "../src/pricing/errors.js";
import type { RawInstance } from "../src/pricing/types.js";
import { FIXTURES } from "./helpers.js";

const find = (key: string, type: string) => FIXTURES[key].find((i) => i.instance_type === type)!;
const m6aXl = find("ec2/m6a", "m6a.xlarge");
const pgLarge = find("rds/m6g", "db.m6g.large");

describe("toCost", () => {
  it("redondea hora a 4 y mensual (desde hora sin redondear) a 2", () => {
    expect(toCost(0.1728)).toEqual({ hourly: 0.1728, monthly: 126.14 });
    expect(toCost(0.13965)).toEqual({ hourly: 0.1397, monthly: 101.94 });
  });
});

describe("specsOf", () => {
  it("lee vCPU (EC2) y vcpu/memory como string (resto)", () => {
    expect(specsOf(m6aXl)).toEqual({ vcpu: 4, memory_gib: 16 });
    expect(specsOf(find("cache/m6g", "cache.m6g.large"))).toEqual({ vcpu: 2, memory_gib: 6.38 });
  });
  it("null si falta", () => {
    expect(specsOf({ instance_type: "x.y" })).toEqual({ vcpu: null, memory_gib: null });
  });
});

describe("regionsOf / variantsOf", () => {
  it("lista regiones ordenadas", () => {
    expect(regionsOf(m6aXl)).toEqual(["eu-west-1", "us-east-1"]);
  });
  it("EC2: excluye recargos sin on-demand (emr)", () => {
    expect(variantsOf("ec2", m6aXl, "us-east-1")).toEqual(["linux", "mswin"]);
  });
  it("RDS: excluye claves numéricas y Outpost", () => {
    expect(variantsOf("rds", pgLarge, "us-east-1")).toEqual(["MySQL", "PostgreSQL"]);
  });
  it("OpenSearch/Redshift: sin variantes", () => {
    expect(variantsOf("opensearch", find("opensearch/m6g", "m6g.large.search"), "us-east-1")).toEqual([]);
  });
});

describe("resolvePrice", () => {
  it("usa la variante por defecto del servicio", () => {
    const r = resolvePrice("ec2", m6aXl, "us-east-1");
    expect(r.variant).toBe("linux");
    expect(r.node.ondemand).toBe(0.1728);
    expect(r.node.reserved["yrTerm1Standard.noUpfront"]).toBe(0.11431);
  });

  it("variante sin distinguir mayúsculas → nombre canónico", () => {
    expect(resolvePrice("rds", pgLarge, "us-east-1", "postgresql").variant).toBe("PostgreSQL");
    expect(resolvePrice("ec2", m6aXl, "us-east-1", "MSWIN").variant).toBe("mswin");
  });

  it("servicios sin variante ignoran el parámetro", () => {
    const r = resolvePrice("redshift", find("redshift/ra3", "ra3.xlplus"), "us-east-1", "linux");
    expect(r.variant).toBeNull();
    expect(r.node.ondemand).toBe(1.086);
  });

  it("región sin precio → NotFoundError con regiones disponibles", () => {
    expect(() => resolvePrice("ec2", m6aXl, "sa-east-1")).toThrow(
      new NotFoundError("m6a.xlarge no tiene precio en sa-east-1. Regiones disponibles: eu-west-1, us-east-1."),
    );
  });

  it("variante inexistente → NotFoundError con variantes válidas", () => {
    expect(() => resolvePrice("rds", pgLarge, "us-east-1", "Aurora")).toThrow(
      new NotFoundError('Variante "Aurora" no existe para db.m6g.large en us-east-1. Variantes: MySQL, PostgreSQL.'),
    );
  });

  it.each([[""], ["0"], ["NA"]])("on-demand %j → NotFoundError, nunca $0", (od) => {
    const raw: RawInstance = {
      instance_type: "m6a.metal",
      pricing: { "us-east-1": { linux: { ondemand: od, reserved: {} } } },
    };
    expect(() => resolvePrice("ec2", raw, "us-east-1")).toThrow(
      new NotFoundError("m6a.metal no tiene precio on-demand en us-east-1 (linux)."),
    );
  });
});

describe("reservedSummary", () => {
  it("EC2: 1yr y 3yr Standard noUpfront + Savings Plan 1yr", () => {
    const { node } = resolvePrice("ec2", m6aXl, "us-east-1");
    expect(reservedSummary("ec2", node)).toEqual({
      "1yr_no_upfront": { hourly: 0.1143, monthly: 83.45, savings_pct: 34 },
      "3yr_no_upfront": { hourly: 0.0784, monthly: 57.22, savings_pct: 55 },
      "1yr_savings_plan_no_upfront": { hourly: 0.1397, monthly: 101.94, savings_pct: 19 },
    });
  });

  it("RDS: cae a partialUpfront cuando falta noUpfront a 3 años", () => {
    const { node } = resolvePrice("rds", pgLarge, "us-east-1");
    expect(reservedSummary("rds", node)).toEqual({
      "1yr_no_upfront": { hourly: 0.1018, monthly: 74.31, savings_pct: 36 },
      "3yr_partial_upfront": { hourly: 0.0652, monthly: 47.6, savings_pct: 59 },
    });
  });

  it("omite plazos sin datos y no incluye Savings Plan fuera de EC2", () => {
    expect(reservedSummary("cache", { ondemand: 0.149, reserved: { "yrTerm1Savings.noUpfront": 0.1 } })).toEqual({});
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `cd /c/Users/maurr/workspace/skills/vantage/mcp-server && npx vitest run test/price.test.ts`
Expected: FAIL — no se puede cargar `../src/pricing/price.js`.

- [ ] **Step 3: Implementar `price.ts`**

`mcp-server/src/pricing/price.ts`:

```ts
import { NotFoundError } from "./errors.js";
import type { Cost, RawInstance, ReservedCost, Service, Specs } from "./types.js";

export const HOURS_PER_MONTH = 730;

export const DEFAULT_VARIANT: Record<Service, string | null> = {
  ec2: "linux",
  rds: "PostgreSQL",
  cache: "Redis",
  opensearch: null,
  redshift: null,
};

export interface PriceNode {
  ondemand: number;
  reserved: Record<string, number>;
}

export interface ResolvedPrice {
  variant: string | null;
  available_variants: string[];
  node: PriceNode;
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

/** Número positivo o null (vacío, no numérico o ≤ 0 cuentan como ausente). */
function positive(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function toCost(hourly: number): Cost {
  return { hourly: round(hourly, 4), monthly: round(hourly * HOURS_PER_MONTH, 2) };
}

export function specsOf(raw: RawInstance): Specs {
  return { vcpu: positive(raw.vCPU ?? raw.vcpu), memory_gib: positive(raw.memory) };
}

export function regionsOf(raw: RawInstance): string[] {
  return Object.keys(raw.pricing ?? {}).sort();
}

const hasVariants = (service: Service) => DEFAULT_VARIANT[service] !== null;

/** Claves con precio on-demand propio (excluye recargos como emr/eks_auto_mode); en RDS además excluye códigos numéricos y Outpost. */
export function variantsOf(service: Service, raw: RawInstance, region: string): string[] {
  if (!hasVariants(service)) return [];
  const regionNode = asRecord(raw.pricing?.[region]) ?? {};
  return Object.keys(regionNode)
    .filter((k) => asRecord(regionNode[k])?.ondemand !== undefined)
    .filter((k) => service !== "rds" || (!/^\d+$/.test(k) && !/outpost/i.test(k)))
    .sort();
}

export function resolvePrice(service: Service, raw: RawInstance, region: string, variant?: string): ResolvedPrice {
  const type = raw.instance_type;
  const regionNode = asRecord(raw.pricing?.[region]);
  if (!regionNode) {
    throw new NotFoundError(
      `${type} no tiene precio en ${region}. Regiones disponibles: ${regionsOf(raw).join(", ")}.`,
    );
  }

  let resolved: string | null = null;
  let available: string[] = [];
  let node: Record<string, unknown> | null = regionNode;
  if (hasVariants(service)) {
    available = variantsOf(service, raw, region);
    const wanted = (variant ?? DEFAULT_VARIANT[service]!).toLowerCase();
    resolved = available.find((v) => v.toLowerCase() === wanted) ?? null;
    if (!resolved) {
      throw new NotFoundError(
        `Variante "${variant ?? DEFAULT_VARIANT[service]}" no existe para ${type} en ${region}. Variantes: ${available.join(", ")}.`,
      );
    }
    node = asRecord(regionNode[resolved]);
  }

  const ondemand = positive(node?.ondemand);
  if (ondemand === null) {
    throw new NotFoundError(`${type} no tiene precio on-demand en ${region}${resolved ? ` (${resolved})` : ""}.`);
  }
  const reserved: Record<string, number> = {};
  for (const [k, v] of Object.entries(asRecord(node?.reserved) ?? {})) {
    const n = positive(v);
    if (n !== null) reserved[k] = n;
  }
  return { variant: resolved, available_variants: available, node: { ondemand, reserved } };
}

const OPTIONS = [
  ["noUpfront", "no_upfront"],
  ["partialUpfront", "partial_upfront"],
  ["allUpfront", "all_upfront"],
] as const;

const TERMS: ReadonlyArray<{ prefix: string; label: string; ec2Only: boolean }> = [
  { prefix: "yrTerm1Standard", label: "1yr", ec2Only: false },
  { prefix: "yrTerm3Standard", label: "3yr", ec2Only: false },
  { prefix: "yrTerm1Savings", label: "1yr_savings_plan", ec2Only: true },
];

export function reservedSummary(service: Service, node: PriceNode): Record<string, ReservedCost> {
  const out: Record<string, ReservedCost> = {};
  for (const term of TERMS) {
    if (term.ec2Only && service !== "ec2") continue;
    for (const [option, suffix] of OPTIONS) {
      const hourly = node.reserved[`${term.prefix}.${option}`];
      if (hourly === undefined) continue;
      out[`${term.label}_${suffix}`] = {
        ...toCost(hourly),
        savings_pct: Math.round((1 - hourly / node.ondemand) * 100),
      };
      break;
    }
  }
  return out;
}
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `cd /c/Users/maurr/workspace/skills/vantage/mcp-server && npx vitest run && npx tsc --noEmit`
Expected: todos PASS; `tsc` sin salida.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/maurr/workspace/skills/vantage
git add mcp-server/src/pricing/price.ts mcp-server/test/price.test.ts
git commit -m "feat(mcp): price normalization with reserved fallback"
```

---

### Task 4: Orquestación — `getInstancePrices` y `listFamily`

**Files:**
- Create: `mcp-server/src/pricing/service.ts`
- Test: `mcp-server/test/service.test.ts`

**Interfaces:**
- Consumes: `parseInstanceType`, `parseFamily` (parse.ts); `VantageClient` (vantage.ts); `specsOf`, `resolvePrice`, `reservedSummary`, `toCost`, `DEFAULT_VARIANT` (price.ts); `NotFoundError`, `PricingError` (errors.ts); `fixtureFetch` (test/helpers.ts).
- Produces:
  - `interface PriceQuery { region?: string; variant?: string; service?: Service }`
  - `interface InstancePrice { instance_type: string; service: Service; region: string; variant: string | null; available_variants: string[]; specs: Specs; on_demand: Cost; reserved: Record<string, ReservedCost>; source_url: string }`
  - `interface InstancePriceError { instance_type: string; error: string }`
  - `type InstancePriceResult = InstancePrice | InstancePriceError`
  - `getInstancePrices(client: VantageClient, instanceTypes: string[], q?: PriceQuery): Promise<InstancePriceResult[]>`
  - `interface FamilySize { instance_type: string; vcpu: number | null; memory_gib: number | null; hourly: number; monthly: number }`
  - `interface FamilyListing { family: string; service: Service; region: string; variant: string | null; sizes: FamilySize[] }`
  - `listFamily(client: VantageClient, family: string, q?: PriceQuery): Promise<FamilyListing>` — lanza `PricingError`
  - `sourceUrl(service: Service, instanceType: string): string`
  - `const DEFAULT_REGION = "us-east-1"`

- [ ] **Step 1: Escribir el test (falla)**

`mcp-server/test/service.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getInstancePrices, listFamily, sourceUrl } from "../src/pricing/service.js";
import { VantageClient } from "../src/pricing/vantage.js";
import { NotFoundError } from "../src/pricing/errors.js";
import { fixtureFetch } from "./helpers.js";

const client = (calls: string[] = []) => new VantageClient({ fetch: fixtureFetch(calls) });

describe("sourceUrl", () => {
  it.each([
    ["ec2", "m6a.xlarge", "https://instances.vantage.sh/aws/ec2/m6a.xlarge"],
    ["rds", "db.m6g.large", "https://instances.vantage.sh/aws/rds/db.m6g.large"],
    ["cache", "cache.m6g.large", "https://instances.vantage.sh/aws/elasticache/cache.m6g.large"],
    ["opensearch", "m6g.large.search", "https://instances.vantage.sh/aws/opensearch/m6g.large.search"],
    ["redshift", "ra3.xlplus", "https://instances.vantage.sh/aws/redshift/ra3.xlplus"],
  ] as const)("%s %s", (service, type, url) => {
    expect(sourceUrl(service, type)).toBe(url);
  });
});

describe("getInstancePrices", () => {
  it("m6a.xlarge con defaults (criterio de éxito de la spec)", async () => {
    const [r] = await getInstancePrices(client(), ["m6a.xlarge"]);
    expect(r).toEqual({
      instance_type: "m6a.xlarge",
      service: "ec2",
      region: "us-east-1",
      variant: "linux",
      available_variants: ["linux", "mswin"],
      specs: { vcpu: 4, memory_gib: 16 },
      on_demand: { hourly: 0.1728, monthly: 126.14 },
      reserved: {
        "1yr_no_upfront": { hourly: 0.1143, monthly: 83.45, savings_pct: 34 },
        "3yr_no_upfront": { hourly: 0.0784, monthly: 57.22, savings_pct: 55 },
        "1yr_savings_plan_no_upfront": { hourly: 0.1397, monthly: 101.94, savings_pct: 19 },
      },
      source_url: "https://instances.vantage.sh/aws/ec2/m6a.xlarge",
    });
  });

  it("región y variante explícitas", async () => {
    const [eu] = await getInstancePrices(client(), ["m6a.xlarge"], { region: "eu-west-1" });
    expect(eu).toMatchObject({ region: "eu-west-1", on_demand: { hourly: 0.1926, monthly: 140.6 } });
    const [win] = await getInstancePrices(client(), ["m6a.xlarge"], { variant: "mswin" });
    expect(win).toMatchObject({ variant: "mswin", on_demand: { hourly: 0.3568, monthly: 260.46 } });
  });

  it("cubre los 5 servicios", async () => {
    const rs = await getInstancePrices(client(), [
      "db.m6g.large",
      "cache.m6g.large",
      "m6g.large.search",
      "ra3.xlplus",
    ]);
    expect(rs.map((r) => ("on_demand" in r ? [r.service, r.variant, r.on_demand.monthly] : r))).toEqual([
      ["rds", "PostgreSQL", 116.07],
      ["cache", "Redis", 108.77],
      ["opensearch", null, 93.44],
      ["redshift", null, 792.78],
    ]);
  });

  it("varios tipos de la misma familia → una sola petición", async () => {
    const calls: string[] = [];
    const rs = await getInstancePrices(client(calls), ["m6a.xlarge", "M6A.2XLARGE"]);
    expect(calls).toHaveLength(1);
    expect(rs.map((r) => r.instance_type)).toEqual(["m6a.xlarge", "m6a.2xlarge"]);
  });

  it("fallo parcial: el resto se devuelve y el fallido trae error", async () => {
    const rs = await getInstancePrices(client(), ["m6a.xlarge", "m6a.huge", "x9z.large", "nope"]);
    expect("on_demand" in rs[0]).toBe(true);
    expect(rs.slice(1)).toEqual([
      { instance_type: "m6a.huge", error: 'No existe "m6a.huge" en la familia m6a (ec2). Tamaños disponibles: m6a.2xlarge, m6a.xlarge.' },
      { instance_type: "x9z.large", error: 'No existe la familia "x9z" en ec2. Revisa el nombre o pasa "service".' },
      { instance_type: "nope", error: 'Tipo de instancia inválido: "nope". Ejemplos: m6a.xlarge, db.m6g.large, cache.m6g.large.' },
    ]);
  });

  it("errores inesperados no se tragan", async () => {
    const bad = new VantageClient({
      fetch: async () => ({ ok: true, status: 200, json: async () => [{ instance_type: "m6a.xlarge", get pricing(): never { throw new RangeError("boom"); } }] }),
    });
    await expect(getInstancePrices(bad, ["m6a.xlarge"])).rejects.toThrow(RangeError);
  });
});

describe("listFamily", () => {
  it("ordena por precio y respeta variante", async () => {
    expect(await listFamily(client(), "m6a")).toEqual({
      family: "m6a",
      service: "ec2",
      region: "us-east-1",
      variant: "linux",
      sizes: [
        { instance_type: "m6a.xlarge", vcpu: 4, memory_gib: 16, hourly: 0.1728, monthly: 126.14 },
        { instance_type: "m6a.2xlarge", vcpu: 8, memory_gib: 32, hourly: 0.3456, monthly: 252.29 },
      ],
    });
  });

  it("infiere RDS por prefijo y omite tamaños sin precio en la variante", async () => {
    const l = await listFamily(client(), "db.m6g", { variant: "mysql" });
    expect(l).toMatchObject({ service: "rds", family: "m6g", variant: "MySQL" });
    expect(l.sizes.map((s) => s.instance_type)).toEqual(["db.m6g.large"]);
  });

  it("ningún tamaño con precio → NotFoundError", async () => {
    await expect(listFamily(client(), "m6a", { region: "sa-east-1" })).rejects.toThrow(
      new NotFoundError("Ningún tamaño de m6a (ec2) tiene precio en sa-east-1 (linux)."),
    );
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `cd /c/Users/maurr/workspace/skills/vantage/mcp-server && npx vitest run test/service.test.ts`
Expected: FAIL — no se puede cargar `../src/pricing/service.js`.

- [ ] **Step 3: Implementar `service.ts`**

`mcp-server/src/pricing/service.ts`:

```ts
import { NotFoundError, PricingError } from "./errors.js";
import { parseFamily, parseInstanceType } from "./parse.js";
import { DEFAULT_VARIANT, reservedSummary, resolvePrice, specsOf, toCost } from "./price.js";
import type { Cost, ReservedCost, Service, Specs } from "./types.js";
import type { VantageClient } from "./vantage.js";

export const DEFAULT_REGION = "us-east-1";

export interface PriceQuery {
  region?: string;
  variant?: string;
  service?: Service;
}

export interface InstancePrice {
  instance_type: string;
  service: Service;
  region: string;
  variant: string | null;
  available_variants: string[];
  specs: Specs;
  on_demand: Cost;
  reserved: Record<string, ReservedCost>;
  source_url: string;
}

export interface InstancePriceError {
  instance_type: string;
  error: string;
}

export type InstancePriceResult = InstancePrice | InstancePriceError;

export interface FamilySize {
  instance_type: string;
  vcpu: number | null;
  memory_gib: number | null;
  hourly: number;
  monthly: number;
}

export interface FamilyListing {
  family: string;
  service: Service;
  region: string;
  variant: string | null;
  sizes: FamilySize[];
}

const URL_SEGMENT: Record<Service, string> = {
  ec2: "ec2",
  rds: "rds",
  cache: "elasticache",
  opensearch: "opensearch",
  redshift: "redshift",
};

export function sourceUrl(service: Service, instanceType: string): string {
  return `https://instances.vantage.sh/aws/${URL_SEGMENT[service]}/${instanceType}`;
}

const regionOf = (q: PriceQuery) => (q.region ?? DEFAULT_REGION).trim().toLowerCase();

async function priceOne(client: VantageClient, input: string, q: PriceQuery): Promise<InstancePrice> {
  const { service, family, instanceType } = parseInstanceType(input, q.service);
  const region = regionOf(q);
  const instances = await client.getFamily(service, family);
  const raw = instances.find((i) => i.instance_type === instanceType);
  if (!raw) {
    const sizes = instances.map((i) => i.instance_type).sort();
    throw new NotFoundError(
      `No existe "${instanceType}" en la familia ${family} (${service}). Tamaños disponibles: ${sizes.join(", ")}.`,
    );
  }
  const { variant, available_variants, node } = resolvePrice(service, raw, region, q.variant);
  return {
    instance_type: instanceType,
    service,
    region,
    variant,
    available_variants,
    specs: specsOf(raw),
    on_demand: toCost(node.ondemand),
    reserved: reservedSummary(service, node),
    source_url: sourceUrl(service, instanceType),
  };
}

export async function getInstancePrices(
  client: VantageClient,
  instanceTypes: string[],
  q: PriceQuery = {},
): Promise<InstancePriceResult[]> {
  return Promise.all(
    instanceTypes.map(async (input) => {
      try {
        return await priceOne(client, input, q);
      } catch (err) {
        if (!(err instanceof PricingError)) throw err;
        return { instance_type: input.trim().toLowerCase(), error: err.message };
      }
    }),
  );
}

export async function listFamily(client: VantageClient, input: string, q: PriceQuery = {}): Promise<FamilyListing> {
  const { service, family } = parseFamily(input, q.service);
  const region = regionOf(q);
  const instances = await client.getFamily(service, family);
  let variant: string | null = null;
  const sizes: FamilySize[] = [];
  for (const raw of instances) {
    try {
      const resolved = resolvePrice(service, raw, region, q.variant);
      variant ??= resolved.variant;
      const { vcpu, memory_gib } = specsOf(raw);
      sizes.push({ instance_type: raw.instance_type, vcpu, memory_gib, ...toCost(resolved.node.ondemand) });
    } catch (err) {
      if (!(err instanceof PricingError)) throw err;
    }
  }
  if (sizes.length === 0) {
    const shown = q.variant ?? DEFAULT_VARIANT[service];
    throw new NotFoundError(
      `Ningún tamaño de ${family} (${service}) tiene precio en ${region}${shown ? ` (${shown})` : ""}.`,
    );
  }
  sizes.sort((a, b) => a.hourly - b.hourly);
  return { family, service, region, variant, sizes };
}
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `cd /c/Users/maurr/workspace/skills/vantage/mcp-server && npx vitest run && npx tsc --noEmit`
Expected: todos PASS; `tsc` sin salida.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/maurr/workspace/skills/vantage
git add mcp-server/src/pricing/service.ts mcp-server/test/service.test.ts
git commit -m "feat(mcp): instance price and family listing queries"
```

---

### Task 5: Servidor MCP, entrada stdio y smoke test en vivo

**Files:**
- Create: `mcp-server/src/server.ts`, `mcp-server/src/index.ts`
- Test: `mcp-server/test/server.test.ts`, `mcp-server/test/live.test.ts`

**Interfaces:**
- Consumes: `VantageClient` (vantage.ts); `getInstancePrices`, `listFamily` (service.ts); `PricingError` (errors.ts); `SERVICES` (types.ts); `fixtureFetch` (test/helpers.ts).
- Produces:
  - `createServer(client?: VantageClient): McpServer` con tools `get_instance_price` y `list_family`.
  - Ejecutable `mcp-server/dist/index.js` (stdio).

- [ ] **Step 1: Escribir el test de integración (falla)**

`mcp-server/test/server.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { VantageClient } from "../src/pricing/vantage.js";
import { fixtureFetch } from "./helpers.js";

let mcp: Client;

beforeAll(async () => {
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await createServer(new VantageClient({ fetch: fixtureFetch() })).connect(serverSide);
  mcp = new Client({ name: "test", version: "0.0.0" });
  await mcp.connect(clientSide);
});

const text = (r: Awaited<ReturnType<Client["callTool"]>>) => (r.content as Array<{ text: string }>)[0].text;

describe("MCP server", () => {
  it("expone las dos tools", async () => {
    const { tools } = await mcp.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["get_instance_price", "list_family"]);
  });

  it("get_instance_price devuelve JSON con results", async () => {
    const r = await mcp.callTool({ name: "get_instance_price", arguments: { instance_types: ["m6a.xlarge"] } });
    expect(r.isError).toBeFalsy();
    const body = JSON.parse(text(r));
    expect(body.results[0].on_demand).toEqual({ hourly: 0.1728, monthly: 126.14 });
  });

  it("get_instance_price es isError solo si fallan todos", async () => {
    const partial = await mcp.callTool({
      name: "get_instance_price",
      arguments: { instance_types: ["m6a.xlarge", "x9z.large"] },
    });
    expect(partial.isError).toBeFalsy();
    const all = await mcp.callTool({ name: "get_instance_price", arguments: { instance_types: ["x9z.large"] } });
    expect(all.isError).toBe(true);
    expect(text(all)).toContain('No existe la familia "x9z" en ec2.');
  });

  it("list_family ok y error", async () => {
    const ok = await mcp.callTool({ name: "list_family", arguments: { family: "m6a" } });
    expect(JSON.parse(text(ok)).sizes).toHaveLength(2);
    const bad = await mcp.callTool({ name: "list_family", arguments: { family: "m6a", region: "sa-east-1" } });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toBe("Ningún tamaño de m6a (ec2) tiene precio en sa-east-1 (linux).");
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `cd /c/Users/maurr/workspace/skills/vantage/mcp-server && npx vitest run test/server.test.ts`
Expected: FAIL — no se puede cargar `../src/server.js`.

- [ ] **Step 3: Implementar `server.ts` e `index.ts`**

`mcp-server/src/server.ts`:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PricingError } from "./pricing/errors.js";
import { getInstancePrices, listFamily } from "./pricing/service.js";
import { SERVICES } from "./pricing/types.js";
import { VantageClient } from "./pricing/vantage.js";

const common = {
  region: z.string().optional().describe("Región AWS, p. ej. us-east-1 (default), eu-west-1, sa-east-1."),
  variant: z
    .string()
    .optional()
    .describe(
      "EC2: sistema operativo (linux default, mswin, rhel, sles, ubuntu…). RDS: motor (PostgreSQL default, MySQL, MariaDB, Oracle, SQL Server). ElastiCache: Redis (default) o Memcached. Ignorado en OpenSearch y Redshift.",
    ),
  service: z
    .enum(SERVICES)
    .optional()
    .describe("Solo si no se puede inferir del nombre. ElastiCache es \"cache\"."),
};

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

export function createServer(client: VantageClient = new VantageClient()): McpServer {
  const server = new McpServer({ name: "vantage-pricing", version: "0.1.0" });

  server.registerTool(
    "get_instance_price",
    {
      title: "Precio de instancias AWS",
      description:
        "Precio de lista (USD) por hora y por mes (730 h) de instancias AWS EC2, RDS, ElastiCache, OpenSearch y Redshift según Vantage: on-demand, reserved Standard a 1 y 3 años y, en EC2, Savings Plan a 1 año, con vCPU y memoria. Acepta varios tipos para compararlos. El servicio se infiere del nombre (db.* = RDS, cache.* = ElastiCache, *.search = OpenSearch, ra3/dc2/ds2 = Redshift, resto = EC2).",
      inputSchema: {
        instance_types: z
          .array(z.string().min(1))
          .min(1)
          .max(10)
          .describe("Tipos de instancia, p. ej. [\"m6a.xlarge\", \"db.m6g.large\"]."),
        ...common,
      },
    },
    async ({ instance_types, ...q }) => {
      const results = await getInstancePrices(client, instance_types, q);
      if (results.every((r) => "error" in r)) {
        return fail(results.map((r) => ("error" in r ? r.error : "")).join("\n"));
      }
      return json({ results });
    },
  );

  server.registerTool(
    "list_family",
    {
      title: "Tamaños de una familia AWS",
      description:
        "Lista todos los tamaños de una familia de instancias AWS (p. ej. m6a, db.m6g, cache.r7g, ra3) con vCPU, memoria y precio on-demand por hora y por mes, ordenados del más barato al más caro. Útil para elegir el tamaño mínimo que cumple un requisito. OpenSearch requiere service=\"opensearch\".",
      inputSchema: {
        family: z.string().min(1).describe("Familia, con o sin prefijo: m6a, db.m6g, cache.m6g, ra3."),
        ...common,
      },
    },
    async ({ family, ...q }) => {
      try {
        return json(await listFamily(client, family, q));
      } catch (err) {
        if (err instanceof PricingError) return fail(err.message);
        throw err;
      }
    },
  );

  return server;
}
```

`mcp-server/src/index.ts`:

```ts
#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

await createServer().connect(new StdioServerTransport());
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `cd /c/Users/maurr/workspace/skills/vantage/mcp-server && npx vitest run && npx tsc --noEmit`
Expected: todos PASS; `tsc` sin salida.

- [ ] **Step 5: Escribir el smoke test en vivo**

`mcp-server/test/live.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getInstancePrices } from "../src/pricing/service.js";
import { VantageClient } from "../src/pricing/vantage.js";

describe.skipIf(!process.env.LIVE)("Vantage en vivo", () => {
  it("m6a.xlarge en us-east-1 tiene precio on-demand", async () => {
    const [r] = await getInstancePrices(new VantageClient(), ["m6a.xlarge"]);
    expect("on_demand" in r && r.on_demand.hourly).toBeGreaterThan(0);
  }, 30_000);
});
```

Run: `cd /c/Users/maurr/workspace/skills/vantage/mcp-server && npx vitest run test/live.test.ts`
Expected: `1 skipped`.

Run: `cd /c/Users/maurr/workspace/skills/vantage/mcp-server && LIVE=1 npx vitest run test/live.test.ts`
Expected: `1 passed`.

- [ ] **Step 6: Build y prueba stdio real**

```bash
cd /c/Users/maurr/workspace/skills/vantage/mcp-server
npm run build
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_instance_price","arguments":{"instance_types":["m6a.xlarge"]}}}' \
  | timeout 20 node dist/index.js
```

Expected: dos líneas JSON-RPC; la segunda (`"id":2`) contiene `\"monthly\":` con el precio real on-demand de m6a.xlarge (≈126.14 a la fecha de la spec).

- [ ] **Step 7: Commit**

```bash
cd /c/Users/maurr/workspace/skills/vantage
git add mcp-server/src/server.ts mcp-server/src/index.ts mcp-server/test/server.test.ts mcp-server/test/live.test.ts
git commit -m "feat(mcp): register pricing tools over stdio"
```

---

### Task 6: Instalación en Claude Code y Kiro + README

**Files:**
- Create: `README.md`
- Modify (fuera del repo, configuración del usuario): Claude Code user MCP config (vía `claude mcp add`), `~/.kiro/settings/mcp.json`

**Interfaces:**
- Consumes: `mcp-server/dist/index.js` (Task 5).
- Produces: servidor `vantage-pricing` registrado en ambos clientes; README con estos mismos pasos.

- [ ] **Step 1: Registrar en Claude Code (scope user)**

```bash
claude mcp add vantage-pricing --scope user -- node C:/Users/maurr/workspace/skills/vantage/mcp-server/dist/index.js
claude mcp list
```

Expected: `vantage-pricing: node C:/Users/maurr/workspace/skills/vantage/mcp-server/dist/index.js - ✓ Connected`.

- [ ] **Step 2: Registrar en Kiro (nivel usuario)**

Leer `~/.kiro/settings/mcp.json` si existe. Si no existe, crearlo con el contenido de abajo; si existe, **agregar** la entrada `vantage-pricing` dentro de `mcpServers` sin tocar las demás:

```json
{
  "mcpServers": {
    "vantage-pricing": {
      "command": "node",
      "args": ["C:/Users/maurr/workspace/skills/vantage/mcp-server/dist/index.js"],
      "disabled": false,
      "autoApprove": ["get_instance_price", "list_family"]
    }
  }
}
```

Expected (verificación manual del usuario): en Kiro, panel MCP Servers muestra `vantage-pricing` conectado con 2 tools.

- [ ] **Step 3: Escribir `README.md`**

`README.md`:

````markdown
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
````

- [ ] **Step 4: Commit**

```bash
cd /c/Users/maurr/workspace/skills/vantage
git add README.md
git commit -m "docs: installation for Claude Code and Kiro"
```

---

### Task 7: Skill `vantage-pricing` (TDD de la skill)

Seguir `superpowers:writing-skills`: primero observar el comportamiento sin skill (RED), luego escribirla (GREEN) y cerrar huecos (REFACTOR).

**Files:**
- Create: `skill/vantage-pricing/SKILL.md`
- Create: `docs/superpowers/skill-tests/2026-10-01-vantage-pricing.md` (registro de baseline y verificación)
- Modify (fuera del repo): junctions en `~/.claude/skills/vantage-pricing` y `~/.kiro/skills/vantage-pricing`

**Interfaces:**
- Consumes: tools `get_instance_price` y `list_family` registradas (Task 6).
- Produces: skill instalada en ambos clientes.

- [ ] **Step 1: Baseline sin skill (RED)**

Con el MCP registrado pero **sin** la skill instalada, en una sesión nueva de Claude Code ejecutar estos 4 escenarios y registrar textualmente lo que hace el agente en `docs/superpowers/skill-tests/2026-10-01-vantage-pricing.md`:

1. "¿Cuánto cuesta un m6a.xlarge al mes?"
2. "Compara db.m6g.large y db.r6g.large en PostgreSQL en sa-east-1."
3. "Necesito una instancia EC2 Graviton con al menos 32 GB de RAM, ¿cuál es la más barata de la familia m7g?"
4. "¿Cuánto me costaría Lambda con 1M invocaciones al mes?"

Para cada uno anotar: ¿usó la tool? ¿indicó región/variante? ¿advirtió que es precio de lista y qué no incluye? ¿usó tabla en la comparación? ¿en el 4 inventó una cifra sin marcarla como no verificada?

- [ ] **Step 2: Escribir `SKILL.md` apuntando a los huecos observados**

`skill/vantage-pricing/SKILL.md`:

```markdown
---
name: vantage-pricing
description: Usar cuando se pregunte por el costo, precio o presupuesto de instancias AWS EC2, RDS, ElastiCache, OpenSearch o Redshift (p. ej. "¿cuánto cuesta un m6a.xlarge?", "compara db.r6g.large vs db.m6g.large", "la instancia más barata con 32 GB"), al comparar tipos de instancia por precio, al estimar el costo mensual de una arquitectura con instancias, o al evaluar reserved instances o Savings Plans.
---

# Precios de instancias AWS (Vantage)

Las tools MCP `get_instance_price` y `list_family` (servidor `vantage-pricing`) devuelven precios de lista reales. **Úsalas en vez de responder de memoria**, aunque creas saber el precio.

## Qué tool usar

| Pregunta | Tool |
|---|---|
| Precio de uno o varios tipos concretos | `get_instance_price` con todos los tipos en una sola llamada |
| "¿Qué tamaño de la familia X me sirve?", "el más barato con N GB / N vCPU" | `list_family` |
| Comparar regiones | `get_instance_price` una vez por región |

Nombres: `db.*` = RDS, `cache.*` = ElastiCache, `*.search` = OpenSearch, `ra3`/`dc2`/`ds2` = Redshift; el resto se toma como EC2. Defaults: región `us-east-1`; EC2 `linux`, RDS `PostgreSQL`, ElastiCache `Redis`. Si el usuario menciona otra región, SO o motor, pásalo en `region`/`variant`.

## Cómo presentar

1. Indica siempre **región**, **variante** (SO o motor) y si el precio es **on-demand** o **reserved**.
2. Da el precio por hora y por mes (la tool ya calcula mensual = hora × 730).
3. Si hay más de un tipo o región, usa una **tabla**: tipo, vCPU, memoria, on-demand/mes, reserved 1 año/mes, reserved 3 años/mes.
4. Menciona el ahorro de reserved (`savings_pct`) cuando sea relevante y aclara la modalidad (`no_upfront`, `partial_upfront`).
5. Enlaza `source_url` para que el usuario verifique.
6. Cierra con esta advertencia, en una línea: *Precio de lista; no incluye EBS/almacenamiento, transferencia de datos, Multi-AZ, impuestos ni descuentos de tu cuenta.*

## Errores

Si la tool devuelve error, muéstralo y sigue la sugerencia que trae (tamaños, regiones o variantes disponibles). **Nunca** sustituyas un error por un precio inventado.

## Fuera de alcance

Lambda, S3, DynamoDB, NAT Gateway, transferencia de datos, EBS y otros servicios no basados en instancias **no** están cubiertos. Dilo explícitamente. Si das una cifra de memoria, márcala como **"no verificada"** y sugiere la AWS Pricing Calculator (https://calculator.aws).
```

- [ ] **Step 3: Instalar la skill en ambos clientes**

```powershell
New-Item -ItemType Junction -Path "$HOME\.claude\skills\vantage-pricing" -Target "C:\Users\maurr\workspace\skills\vantage\skill\vantage-pricing"
New-Item -ItemType Directory -Force -Path "$HOME\.kiro\skills" | Out-Null
New-Item -ItemType Junction -Path "$HOME\.kiro\skills\vantage-pricing" -Target "C:\Users\maurr\workspace\skills\vantage\skill\vantage-pricing"
```

Expected: ambos `Get-Item` muestran `LinkType: Junction`. Si la ruta ya existe, revisarla antes y no sobrescribirla sin confirmar con el usuario.

- [ ] **Step 4: Verificación con skill (GREEN)**

En una sesión **nueva** de Claude Code repetir los 4 escenarios del Step 1 y registrar los resultados en el mismo archivo. Criterios de aprobación:

1. Usa `get_instance_price`; muestra ≈ $126.14/mes on-demand, región, variante, reserved y la advertencia.
2. Una sola llamada con ambos tipos, `region: "sa-east-1"`, `variant: "PostgreSQL"`; resultado en tabla.
3. Usa `list_family` con `family: "m7g"` y elige el más barato con `memory_gib ≥ 32`.
4. Dice que no está cubierto; cualquier cifra lleva "no verificada".

- [ ] **Step 5: Cerrar huecos (REFACTOR)**

Para cada criterio no cumplido, ajustar el texto de `SKILL.md` que lo cubre (reformular, mover arriba, volverlo explícito) y repetir solo ese escenario hasta que pase. Registrar cada cambio y su resultado en el archivo de pruebas.

- [ ] **Step 6: Verificación en Kiro**

En Kiro, con el MCP y la skill instalados, repetir el escenario 1. Expected: activa la skill (o el usuario la invoca con `/vantage-pricing`), llama la tool y responde ≈ $126.14/mes con la advertencia. Registrar el resultado.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/maurr/workspace/skills/vantage
git add skill/vantage-pricing/SKILL.md docs/superpowers/skill-tests/2026-10-01-vantage-pricing.md
git commit -m "feat(skill): vantage-pricing skill for Claude Code and Kiro"
```
