import type { OpenAICompatClient } from "./openai-compat";
import type {
  ChatRequest,
  LlmError,
  ModelEntry,
  ProviderId,
  RouteClass,
  RouteMode,
  RouterEvent,
  StreamEvent,
  Telemetry,
} from "./types";

export interface RouterDeps {
  /** Verified-eligible candidate pool (already filtered for liveness). */
  models: ModelEntry[];
  clientFor: (entry: ModelEntry) => OpenAICompatClient | null;
  hedgeMs?: number;
  now?: () => number;
  /** Max distinct models tried per request. */
  maxAttempts?: number;
}

const TIER_RANK: Record<ModelEntry["tier"], number> = {
  fast: 0,
  balanced: 1,
  strong: 2,
};

export type ChatStreamEvent =
  | StreamEvent
  | RouterEvent
  | { type: "telemetry"; telemetry: Telemetry };

const sleep = (ms: number) =>
  new Promise<"timeout">((r) => setTimeout(() => r("timeout"), ms));

/**
 * Route classes per rule 20:
 * - chat:     any verified model, lowest EWMA TTFT; hedged after `hedgeMs`.
 * - research: tool-capable (caps.tools && probe.toolCallOk), prefer balanced+.
 * - reason:   tier >= balanced; auto-quality prefers strong.
 * - check:    caps.json, prefers a different provider than the drafter.
 * Manual mode (`manual:<key>`) wins ordering but still fails over on errors.
 */
export class ModelRouter {
  private readonly deps: RouterDeps;
  private readonly hedgeMs: number;
  private readonly maxAttempts: number;
  private readonly now: () => number;
  private readonly ewma = new Map<string, number>();
  private readonly cooldowns = new Map<string, { until: number; failures: number }>();

  constructor(deps: RouterDeps) {
    this.deps = deps;
    this.hedgeMs = deps.hedgeMs ?? 900;
    this.maxAttempts = deps.maxAttempts ?? 3;
    this.now = deps.now ?? Date.now;
    for (const m of deps.models) {
      if (m.probe?.ttftMs !== undefined) this.ewma.set(m.key, m.probe.ttftMs);
    }
  }

  private score(m: ModelEntry): number {
    return this.ewma.get(m.key) ?? m.probe?.ttftMs ?? 30_000;
  }

  private cooled(m: ModelEntry): boolean {
    const cd = this.cooldowns.get(m.key);
    if (cd && cd.until > this.now()) return true;
    return m.cooldownUntil !== undefined && m.cooldownUntil > this.now();
  }

  /** Ordered candidate list for a route class + mode. */
  candidates(
    route: RouteClass,
    mode: RouteMode,
    opts?: { avoidProvider?: ProviderId },
  ): ModelEntry[] {
    const live = this.deps.models.filter((m) => !this.cooled(m));

    const eligible = (m: ModelEntry): boolean => {
      switch (route) {
        case "chat":
          return true;
        case "research":
          return m.caps.tools && (m.probe?.toolCallOk ?? false);
        case "reason":
          return TIER_RANK[m.tier] >= TIER_RANK.balanced;
        case "check":
          return m.caps.json;
      }
    };

    const tierPref = (m: ModelEntry): number => {
      if (route === "research") return TIER_RANK[m.tier] >= 1 ? 0 : 1;
      if (route === "reason" && mode === "auto-quality")
        return m.tier === "strong" ? 0 : 1;
      if (route === "check" && opts?.avoidProvider && m.provider === opts.avoidProvider)
        return 1;
      return 0;
    };

    const ordered = live
      .filter(eligible)
      .sort((a, b) => tierPref(a) - tierPref(b) || this.score(a) - this.score(b));

    if (mode.startsWith("manual:")) {
      const key = mode.slice("manual:".length);
      const idx = ordered.findIndex((m) => m.key === key);
      if (idx > 0) {
        const [picked] = ordered.splice(idx, 1);
        if (picked) ordered.unshift(picked);
      } else if (idx === -1) {
        const manual = this.deps.models.find((m) => m.key === key);
        if (manual && !this.cooled(manual)) ordered.unshift(manual);
      }
    }
    return ordered;
  }

  private markFailure(m: ModelEntry) {
    const prev = this.cooldowns.get(m.key);
    const failures = (prev?.failures ?? 0) + 1;
    const backoff = Math.min(60_000, 5_000 * 2 ** (failures - 1));
    this.cooldowns.set(m.key, { until: this.now() + backoff, failures });
  }

  private markSuccess(m: ModelEntry, ttftMs: number) {
    this.cooldowns.delete(m.key);
    const prev = this.ewma.get(m.key);
    this.ewma.set(m.key, prev === undefined ? ttftMs : prev * 0.7 + ttftMs * 0.3);
  }

  /**
   * Routed chat. Streams the winner's events; on a retryable pre-content
   * failure it emits `model_switch` and moves to the next candidate. A
   * terminal {type:"error"} means every candidate failed (or the caller
   * aborted). Always ends with a `telemetry` event.
   */
  async *chat(
    req: Omit<ChatRequest, "modelId">,
    route: RouteClass,
    mode: RouteMode,
    opts?: { signal?: AbortSignal; avoidProvider?: ProviderId },
  ): AsyncGenerator<ChatStreamEvent> {
    const startedAt = this.now();
    const telemetry: Telemetry = {
      route,
      provider: "openrouter",
      model: "",
      ttftMs: -1,
      totalMs: 0,
      tokensIn: 0,
      tokensOut: 0,
      retries: 0,
      hedged: false,
    };

    const cands = this.candidates(route, mode, {
      avoidProvider: opts?.avoidProvider,
    });
    if (cands.length === 0) {
      yield {
        type: "error",
        error: {
          kind: "bad_response",
          message: "no verified model is currently available",
          retryable: false,
        } satisfies LlmError,
      };
      telemetry.totalMs = this.now() - startedAt;
      yield { type: "telemetry", telemetry };
      return;
    }

    const canHedge =
      route === "chat" &&
      !mode.startsWith("manual:") &&
      cands.some((c) => c.provider !== cands[0]!.provider);

    let attempts = 0;
    let yieldedContent = false;

    for (let i = 0; i < cands.length && attempts < this.maxAttempts; i++) {
      const entry = cands[i]!;
      const client = this.deps.clientFor(entry);
      if (!client) {
        this.markFailure(entry);
        continue;
      }
      attempts++;
      if (attempts > 1) telemetry.retries++;
      telemetry.provider = entry.provider;
      telemetry.model = entry.modelId;

      const gen = client.chatStream(
        { ...req, modelId: entry.modelId },
        opts?.signal,
      );

      // -- hedging: race first events of primary vs other-provider next-best --
      let winner = gen;
      let winnerEntry = entry;
      const buffered: StreamEvent[] = [];

      if (canHedge && !yieldedContent) {
        const hEntry = cands.slice(i + 1).find((c) => c.provider !== entry.provider);
        const hClient = hEntry ? this.deps.clientFor(hEntry) : null;
        if (hEntry && hClient) {
          const pFirst = gen.next();
          const raced = await Promise.race([pFirst, sleep(this.hedgeMs)]);
          if (raced === "timeout") {
            telemetry.hedged = true;
            const hGen = hClient.chatStream(
              { ...req, modelId: hEntry.modelId },
              opts?.signal,
            );
            const hFirst = hGen.next();
            const winnerRes = await Promise.race([
              pFirst.then((r) => ({ side: "p" as const, r })),
              hFirst.then((r) => ({ side: "h" as const, r })),
            ]);
            if (winnerRes.side === "h") {
              void gen.return(undefined);
              this.markFailure(entry);
              yield {
                type: "hedged",
                winner: hEntry.key,
                loser: entry.key,
              };
              winner = hGen;
              winnerEntry = hEntry;
              telemetry.provider = hEntry.provider;
              telemetry.model = hEntry.modelId;
              if (!winnerRes.r.done) buffered.push(winnerRes.r.value);
            } else {
              void hGen.return(undefined);
              if (!winnerRes.r.done) buffered.push(winnerRes.r.value);
            }
          } else if (!raced.done) {
            buffered.push(raced.value);
          }
        } else {
          const first = await gen.next();
          if (!first.done) buffered.push(first.value);
        }
      } else {
        const first = await gen.next();
        if (!first.done) buffered.push(first.value);
      }

      // -- relay buffered + remaining events until a terminal state -----------
      let failed: LlmError | null = null;
      let finished = false;
      const relay = async function* (): AsyncGenerator<StreamEvent> {
        for (const ev of buffered) yield ev;
        for await (const ev of winner) yield ev;
      };

      for await (const ev of relay()) {
        if (ev.type === "error") {
          // Caller abort is always terminal. Any other pre-content error
          // fails over to the next candidate ("retryable" only governs
          // retrying the SAME model). Mid-stream errors are terminal too.
          if (ev.error.kind !== "aborted" && !yieldedContent) {
            failed = ev.error;
            break;
          }
          yield ev;
          finished = true;
          break;
        }
        if (ev.type === "usage") {
          telemetry.tokensIn = ev.usage.promptTokens ?? telemetry.tokensIn;
          telemetry.tokensOut = ev.usage.completionTokens ?? telemetry.tokensOut;
          yield ev;
          continue;
        }
        if (ev.type === "text" || ev.type === "tool_call") {
          if (telemetry.ttftMs < 0) {
            telemetry.ttftMs = this.now() - startedAt;
            this.markSuccess(winnerEntry, telemetry.ttftMs);
          }
          yieldedContent = true;
        }
        if (ev.type === "done") finished = true;
        yield ev;
      }

      if (finished) break;
      if (failed) {
        this.markFailure(winnerEntry);
        const next = cands[i + 1];
        if (next && attempts < this.maxAttempts) {
          yield {
            type: "model_switch",
            from: winnerEntry.key,
            to: next.key,
            reason: failed.kind,
          };
          continue;
        }
        yield { type: "error", error: failed };
        break;
      }
      break; // generator ended without done/error; treat as complete
    }

    if (attempts >= this.maxAttempts && !yieldedContent) {
      yield {
        type: "error",
        error: {
          kind: "bad_response",
          message: "all candidate models failed",
          retryable: false,
        },
      };
    }
    if (telemetry.ttftMs < 0) telemetry.ttftMs = this.now() - startedAt;
    telemetry.totalMs = this.now() - startedAt;
    yield { type: "telemetry", telemetry };
  }
}
