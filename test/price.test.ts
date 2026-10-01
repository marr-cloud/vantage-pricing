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
      new NotFoundError('Variante "Aurora" sin precio para db.m6g.large en us-east-1. Variantes con precio: MySQL, PostgreSQL.'),
    );
  });

  it("variante con on-demand \"0\" no cuenta como disponible; el error sugiere las que tienen precio", () => {
    const raw: RawInstance = {
      instance_type: "u-6tb1.metal",
      pricing: { "us-east-1": { linux: { ondemand: "0" }, dedicated: { ondemand: "1.5" }, mswin: { ondemand: "2" } } },
    };
    expect(variantsOf("ec2", raw, "us-east-1")).toEqual(["dedicated", "mswin"]);
    expect(() => resolvePrice("ec2", raw, "us-east-1")).toThrow(
      new NotFoundError('Variante "linux" sin precio para u-6tb1.metal en us-east-1. Variantes con precio: dedicated, mswin.'),
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
