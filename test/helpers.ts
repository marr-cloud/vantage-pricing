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
