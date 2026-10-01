import { describe, it, expect } from "vitest";
import { getInstancePrices } from "../src/pricing/service.js";
import { VantageClient } from "../src/pricing/vantage.js";

describe.skipIf(!process.env.LIVE)("Vantage en vivo", () => {
  it("m6a.xlarge en us-east-1 tiene precio on-demand", async () => {
    const [r] = await getInstancePrices(new VantageClient(), ["m6a.xlarge"]);
    expect("on_demand" in r && r.on_demand.hourly).toBeGreaterThan(0);
  }, 30_000);
});
