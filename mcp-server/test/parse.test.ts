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
