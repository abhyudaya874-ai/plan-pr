/**
 * Shared stub for package scripts whose phase has not landed yet.
 * Exits 1 with a clear message rather than pretending to work.
 */
export function phaseStub(script: string, phase: string): never {
  console.error(
    `[planpr] "${script}" is not implemented yet - it lands in phase ${phase}. See .devin/workflows/.`,
  );
  process.exit(1);
}
