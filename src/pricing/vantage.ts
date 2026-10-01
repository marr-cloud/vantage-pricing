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
