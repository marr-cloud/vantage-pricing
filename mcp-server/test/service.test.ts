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
