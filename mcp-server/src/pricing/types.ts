export const SERVICES = ["ec2", "rds", "cache", "opensearch", "redshift"] as const;
export type Service = (typeof SERVICES)[number];

/** Una instancia tal como la devuelve el endpoint de familia de Vantage. */
export interface RawInstance {
  instance_type: string;
  vCPU?: number | string;
  vcpu?: number | string;
  memory?: number | string;
  pricing?: Record<string, unknown>;
}

export interface Cost {
  hourly: number;
  monthly: number;
}

export interface ReservedCost extends Cost {
  savings_pct: number;
}

export interface Specs {
  vcpu: number | null;
  memory_gib: number | null;
}
