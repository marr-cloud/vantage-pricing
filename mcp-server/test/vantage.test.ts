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
