import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyWithLlm, parseModelString } from "./llm-classifier.js";
import type { SmartRoutingConfig } from "./types.js";

const baseConfig: SmartRoutingConfig = {
  enabled: true,
  classifier: "llm",
  tiers: {
    fast: { model: "anthropic/claude-haiku-4-5" },
    standard: { model: "anthropic/claude-sonnet-4-6" },
    heavy: { model: "anthropic/claude-opus-4-6" },
  },
};

describe("parseModelString", () => {
  it("parses provider/model string", () => {
    expect(parseModelString("anthropic/claude-haiku-4-5")).toEqual({
      provider: "anthropic",
      model: "claude-haiku-4-5",
    });
  });

  it("handles extra whitespace", () => {
    expect(parseModelString("  openai / gpt-4o  ")).toEqual({
      provider: "openai",
      model: "gpt-4o",
    });
  });

  it("returns null for empty string", () => {
    expect(parseModelString("")).toBeNull();
  });

  it("returns null for string without slash", () => {
    expect(parseModelString("claude-haiku")).toBeNull();
  });

  it("returns null for slash-only", () => {
    expect(parseModelString("/")).toBeNull();
  });

  it("handles model ids with slashes (openrouter)", () => {
    expect(parseModelString("openrouter/anthropic/claude-3-opus")).toEqual({
      provider: "openrouter",
      model: "anthropic/claude-3-opus",
    });
  });
});

describe("classifyWithLlm", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-123");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it("returns LLM classification on successful response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: '{"tier": "fast", "reason": "simple greeting"}' }],
        }),
    });

    const result = await classifyWithLlm({ prompt: "hello", config: baseConfig });
    expect(result.tier).toBe("fast");
    expect(result.classifier).toBe("llm");
    expect(result.reason).toBe("simple greeting");
    expect(result.confidence).toBe(0.9);
  });

  it("falls back to heuristic on API error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    const result = await classifyWithLlm({ prompt: "hello", config: baseConfig });
    expect(result.classifier).toBe("heuristic");
  });

  it("falls back to heuristic on network error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network error"));

    const result = await classifyWithLlm({ prompt: "hello", config: baseConfig });
    expect(result.classifier).toBe("heuristic");
  });

  it("falls back to heuristic on invalid JSON response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: "I think this is fast" }],
        }),
    });

    const result = await classifyWithLlm({ prompt: "hello", config: baseConfig });
    expect(result.classifier).toBe("heuristic");
  });

  it("falls back to heuristic when no fast tier model is configured", async () => {
    const result = await classifyWithLlm({
      prompt: "hello",
      config: { enabled: true, tiers: {} },
    });
    expect(result.classifier).toBe("heuristic");
  });

  it("falls back to heuristic when API key is missing", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    const result = await classifyWithLlm({ prompt: "hello", config: baseConfig });
    expect(result.classifier).toBe("heuristic");
  });

  it("falls back to heuristic for unsupported providers", async () => {
    const config: SmartRoutingConfig = {
      enabled: true,
      tiers: {
        fast: { model: "ollama/llama3" },
      },
    };

    const result = await classifyWithLlm({ prompt: "hello", config });
    expect(result.classifier).toBe("heuristic");
  });

  it("handles response wrapped in markdown code fences", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [
            {
              type: "text",
              text: '```json\n{"tier": "heavy", "reason": "complex task"}\n```',
            },
          ],
        }),
    });

    const result = await classifyWithLlm({ prompt: "refactor everything", config: baseConfig });
    expect(result.tier).toBe("heavy");
    expect(result.classifier).toBe("llm");
  });

  it("sends correct Anthropic API request", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: '{"tier": "fast", "reason": "test"}' }],
        }),
    });
    globalThis.fetch = mockFetch;

    await classifyWithLlm({ prompt: "hello", config: baseConfig });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(options.method).toBe("POST");

    const headers = options.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-key-123");
    expect(headers["anthropic-version"]).toBe("2023-06-01");

    const body = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(body.model).toBe("claude-haiku-4-5");
    expect(body.max_tokens).toBe(100);
  });
});
