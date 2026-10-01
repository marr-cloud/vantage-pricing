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
    expect(text(bad)).toBe(
      "Ningún tamaño de m6a (ec2) tiene precio en sa-east-1 (linux). Regiones disponibles: eu-west-1, us-east-1.",
    );
  });
});
