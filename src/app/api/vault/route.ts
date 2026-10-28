import { fundDetail, vaultFunds, vaultLookup } from "@/lib/vault/load";

/**
 * GET /api/vault                  -> fund list (universe)
 * GET /api/vault?fund=<code>      -> full field map for one fund
 * GET /api/vault?lookup=1&amc=&scheme=&plan=&option=&field= -> 5-tuple lookup
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const fund = url.searchParams.get("fund");
  if (fund) {
    const d = fundDetail(fund);
    return d ? Response.json(d) : Response.json({ error: "not_found" }, { status: 404 });
  }
  if (url.searchParams.get("lookup")) {
    const out = vaultLookup({
      amc: url.searchParams.get("amc") ?? "",
      scheme: url.searchParams.get("scheme") ?? "",
      plan: url.searchParams.get("plan") ?? "Direct Plan",
      option: url.searchParams.get("option") ?? "Growth",
      field: url.searchParams.get("field") ?? "",
    });
    return Response.json(out);
  }
  return Response.json({
    funds: vaultFunds().map((f) => ({
      schemeCode: f.schemeCode,
      amc: f.identity.amc,
      scheme: f.identity.scheme,
      category: f.category,
      nav: f.fields.nav?.value,
      navDate: f.fields.nav_date?.value,
    })),
  });
}
