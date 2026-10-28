import { describe, expect, it } from "vitest";
import { resolveIdentity } from "@/lib/vault";
import { vaultLookup, vaultFunds } from "@/lib/vault/load";

const universe = {
  funds: [
    { schemeCode: "122639", amfiName: "Parag Parikh Flexi Cap Fund", amc: "PPFAS Mutual Fund", category: "flexi_cap" },
    { schemeCode: "118778", amfiName: "Nippon India Small Cap Fund", amc: "Nippon India Mutual Fund", category: "small_cap" },
  ],
};

describe("identity lock", () => {
  it("resolves exactly one fund for a good 5-tuple", () => {
    const r = resolveIdentity(universe, "PPFAS", "flexi cap", "Direct Plan", "Growth");
    expect(r.code).toBe("122639");
    expect(r.ambiguous).toHaveLength(0);
  });

  it("fails closed on unknown funds (no guessing)", () => {
    const r = resolveIdentity(universe, "Quantum", "ultra alpha fund", "Direct", "Growth");
    expect(r.code).toBeNull();
  });
});

describe("vaultLookup (real vault)", () => {
  it("serves nav with AMFI blame", () => {
    const r = vaultLookup({ amc: "PPFAS", scheme: "flexi cap", plan: "Direct", option: "Growth", field: "nav" });
    expect(r.found).toBe(true);
    expect(r.schemeCode).toBe("122639");
    expect(r.value!.status).toBe("ok");
    expect(r.value!.source!.url).toContain("amfiindia");
  });

  it("says unavailable for factsheet fields (never guesses)", () => {
    const r = vaultLookup({ amc: "Nippon", scheme: "small cap", plan: "Direct", option: "Growth", field: "expense_ratio_direct" });
    expect(r.found).toBe(true);
    expect(r.value!.status).toBe("unavailable");
  });

  it("not_found outside the universe", () => {
    const r = vaultLookup({ amc: "XYZ", scheme: "made up fund", plan: "Direct", option: "Growth", field: "nav" });
    expect(r.found).toBe(false);
  });

  it("loaded all 12 universe funds", () => {
    expect(vaultFunds().length).toBe(12);
  });
});
