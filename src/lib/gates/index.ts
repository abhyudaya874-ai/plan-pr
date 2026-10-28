/**
 * Gates ("CI checks" for a plan): deterministic checks + persona packs.
 * Lands in phase 70 - see .devin/workflows/70-planner-and-gates.md.
 */
export type GateStatus = "pass" | "warn" | "block";
