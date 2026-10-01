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
