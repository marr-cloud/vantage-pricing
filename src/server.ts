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
