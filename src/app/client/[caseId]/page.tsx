import { existsSync, readFileSync } from "node:fs";
import { connection } from "next/server";
import path from "node:path";
import { approvalValid, loadReceipt } from "@/lib/case/approval";
import { loadCase } from "@/lib/case";
import { ClientView } from "@/components/client/ClientView";
import { runtimePath } from "@/lib/paths";

/**
 * Client view — read-only. Shows the approved draft ONLY when the approval
 * fingerprint still matches current content (I4). Anything else: "pending".
 */
export const instant = false; // filesystem-backed dynamic route (blocking)

export default async function ClientPage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  await connection(); // filesystem-backed, must render per-request
  const { caseId } = await params;
  const c = loadCase(caseId);
  const dir = runtimePath("data", "cases", caseId);
  const draft = existsSync(path.join(dir, "draft.md"))
    ? readFileSync(path.join(dir, "draft.md"), "utf8")
    : null;
  const { valid, receipt } = c ? approvalValid(c) : { valid: false, receipt: loadReceipt(caseId) };

  return (
    <div className="min-h-dvh bg-[#f7f5f2] text-zinc-800">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <span className="font-serif text-[22px] italic">Pramaan</span>
          <span className="text-[11px] uppercase tracking-widest text-zinc-500">client copy</span>
        </div>
        {!c || !valid ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-[14px]">
            <p className="font-semibold text-amber-800">This plan is not currently approved.</p>
            <p className="mt-1 text-amber-700">
              {c
                ? "Facts changed after approval, or the adviser hasn't approved it yet — please ask your adviser for the current version."
                : "Unknown plan reference."}
            </p>
            {receipt && (
              <p className="mt-2 text-[12px] text-amber-600">
                An older version was approved at {receipt.at} (revoked by a later fact change).
              </p>
            )}
          </div>
        ) : (
          <>
            <ClientView draft={draft!} receipt={receipt!} />
          </>
        )}
      </div>
    </div>
  );
}
