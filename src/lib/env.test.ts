import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

describe("loadEnv", () => {
  it("reports every provider when all keys are present", () => {
    const e = loadEnv({
      OPENROUTER_API_KEY: "a",
      GROQ_API_KEY: "b",
      NVIDIA_API_KEY: "c",
      TAVILY_API_KEY: "d",
      EXA_API_KEY: "e",
    });
    expect(e.providers).toEqual({
      openrouter: true,
      groq: true,
      nvidia: true,
      tavily: true,
      exa: true,
    });
    expect(e.llmMissing).toBe(false);
  });

  it("degrades gracefully when some keys are missing", () => {
    const e = loadEnv({ GROQ_API_KEY: "b" });
    expect(e.providers).toEqual({
      openrouter: false,
      groq: true,
      nvidia: false,
      tavily: false,
      exa: false,
    });
    expect(e.llmMissing).toBe(false);
  });

  it("treats empty or whitespace-only strings as missing", () => {
    const e = loadEnv({ OPENROUTER_API_KEY: "", GROQ_API_KEY: "   " });
    expect(e.providers.openrouter).toBe(false);
    expect(e.providers.groq).toBe(false);
    expect(e.llmMissing).toBe(true);
  });

  it("flags llmMissing when no LLM key exists even if tavily is set", () => {
    const e = loadEnv({ TAVILY_API_KEY: "d" });
    expect(e.llmMissing).toBe(true);
    expect(e.providers.tavily).toBe(true);
  });
});
