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
