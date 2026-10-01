import { NotFoundError } from "./errors.js";
import type { Cost, RawInstance, ReservedCost, Service, Specs } from "./types.js";

export const HOURS_PER_MONTH = 730;

export const DEFAULT_VARIANT: Record<Service, string | null> = {
  ec2: "linux",
  rds: "PostgreSQL",
  cache: "Redis",
  opensearch: null,
  redshift: null,
};

export interface PriceNode {
  ondemand: number;
  reserved: Record<string, number>;
}

export interface ResolvedPrice {
  variant: string | null;
  available_variants: string[];
  node: PriceNode;
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

/** Número positivo o null (vacío, no numérico o ≤ 0 cuentan como ausente). */
function positive(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function toCost(hourly: number): Cost {
  return { hourly: round(hourly, 4), monthly: round(hourly * HOURS_PER_MONTH, 2) };
}

export function specsOf(raw: RawInstance): Specs {
  return { vcpu: positive(raw.vCPU ?? raw.vcpu), memory_gib: positive(raw.memory) };
}

export function regionsOf(raw: RawInstance): string[] {
  return Object.keys(raw.pricing ?? {}).sort();
}

const hasVariants = (service: Service) => DEFAULT_VARIANT[service] !== null;

/** Claves con precio on-demand propio (excluye recargos como emr/eks_auto_mode); en RDS además excluye códigos numéricos y Outpost. */
export function variantsOf(service: Service, raw: RawInstance, region: string): string[] {
  if (!hasVariants(service)) return [];
  const regionNode = asRecord(raw.pricing?.[region]) ?? {};
  return Object.keys(regionNode)
    .filter((k) => asRecord(regionNode[k])?.ondemand !== undefined)
    .filter((k) => service !== "rds" || (!/^\d+$/.test(k) && !/outpost/i.test(k)))
    .sort();
}

export function resolvePrice(service: Service, raw: RawInstance, region: string, variant?: string): ResolvedPrice {
  const type = raw.instance_type;
  const regionNode = asRecord(raw.pricing?.[region]);
  if (!regionNode) {
    throw new NotFoundError(
      `${type} no tiene precio en ${region}. Regiones disponibles: ${regionsOf(raw).join(", ")}.`,
    );
  }

  let resolved: string | null = null;
  let available: string[] = [];
  let node: Record<string, unknown> | null = regionNode;
  if (hasVariants(service)) {
    available = variantsOf(service, raw, region);
    const wanted = (variant ?? DEFAULT_VARIANT[service]!).toLowerCase();
    resolved = available.find((v) => v.toLowerCase() === wanted) ?? null;
    if (!resolved) {
      throw new NotFoundError(
        `Variante "${variant ?? DEFAULT_VARIANT[service]}" no existe para ${type} en ${region}. Variantes: ${available.join(", ")}.`,
      );
    }
    node = asRecord(regionNode[resolved]);
  }

  const ondemand = positive(node?.ondemand);
  if (ondemand === null) {
    throw new NotFoundError(`${type} no tiene precio on-demand en ${region}${resolved ? ` (${resolved})` : ""}.`);
  }
  const reserved: Record<string, number> = {};
  for (const [k, v] of Object.entries(asRecord(node?.reserved) ?? {})) {
    const n = positive(v);
    if (n !== null) reserved[k] = n;
  }
  return { variant: resolved, available_variants: available, node: { ondemand, reserved } };
}

const OPTIONS = [
  ["noUpfront", "no_upfront"],
  ["partialUpfront", "partial_upfront"],
  ["allUpfront", "all_upfront"],
] as const;

const TERMS: ReadonlyArray<{ prefix: string; label: string; ec2Only: boolean }> = [
  { prefix: "yrTerm1Standard", label: "1yr", ec2Only: false },
  { prefix: "yrTerm3Standard", label: "3yr", ec2Only: false },
  { prefix: "yrTerm1Savings", label: "1yr_savings_plan", ec2Only: true },
];

export function reservedSummary(service: Service, node: PriceNode): Record<string, ReservedCost> {
  const out: Record<string, ReservedCost> = {};
  for (const term of TERMS) {
    if (term.ec2Only && service !== "ec2") continue;
    for (const [option, suffix] of OPTIONS) {
      const hourly = node.reserved[`${term.prefix}.${option}`];
      if (hourly === undefined) continue;
      out[`${term.label}_${suffix}`] = {
        ...toCost(hourly),
        savings_pct: Math.round((1 - hourly / node.ondemand) * 100),
      };
      break;
    }
  }
  return out;
}
