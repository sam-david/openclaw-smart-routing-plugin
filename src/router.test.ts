import { describe, expect, it, vi } from "vitest";
import { resolveSmartRoute } from "./router.js";
import type { SmartRoutingConfig } from "./types.js";

const fullConfig: SmartRoutingConfig = {
  enabled: true,
  classifier: "heuristic",
  tiers: {
    fast: { model: "anthropic/claude-haiku-4-5" },
    standard: { model: "anthropic/claude-sonnet-4-6" },
    heavy: { model: "anthropic/claude-opus-4-6" },
  },
};

describe("resolveSmartRoute", () => {
  describe("guard conditions", () => {
    it("returns null when routing is disabled", async () => {
      const result = await resolveSmartRoute({
        prompt: "hello",
        routingConfig: { enabled: false },
      });
      expect(result).toBeNull();
    });

    it("returns null when enabled is not set", async () => {
      const result = await resolveSmartRoute({
        prompt: "hello",
        routingConfig: {},
      });
      expect(result).toBeNull();
    });

    it("returns null when no tiers are configured", async () => {
      const result = await resolveSmartRoute({
        prompt: "hello",
        routingConfig: { enabled: true },
      });
      expect(result).toBeNull();
    });
  });

  describe("model resolution", () => {
    it("resolves fast tier model for simple prompts", async () => {
      const result = await resolveSmartRoute({
        prompt: "hello",
        routingConfig: fullConfig,
      });
      expect(result).not.toBeNull();
      expect(result!.providerOverride).toBe("anthropic");
      expect(result!.modelOverride).toBe("claude-haiku-4-5");
      expect(result!.tier).toBe("fast");
    });

    it("resolves heavy tier model for complex prompts", async () => {
      const result = await resolveSmartRoute({
        prompt:
          "Refactor the entire authentication module to use OAuth2. First analyze the current implementation, then restructure the auth layer, and finally implement the changes.\n1. Read current auth code\n2. Design new OAuth2 flow\n3. Migrate all endpoints",
        routingConfig: fullConfig,
      });
      expect(result).not.toBeNull();
      expect(result!.providerOverride).toBe("anthropic");
      expect(result!.modelOverride).toBe("claude-opus-4-6");
      expect(result!.tier).toBe("heavy");
    });

    it("parses provider and model correctly from tier config", async () => {
      const config: SmartRoutingConfig = {
        enabled: true,
        classifier: "heuristic",
        tiers: {
          fast: { model: "openai/gpt-4o-mini" },
          standard: { model: "openai/gpt-4o" },
        },
      };
      const result = await resolveSmartRoute({ prompt: "hi", routingConfig: config });
      expect(result).not.toBeNull();
      expect(result!.providerOverride).toBe("openai");
      expect(result!.modelOverride).toBe("gpt-4o-mini");
    });
  });

  describe("missing tier fallback", () => {
    it("falls back to standard tier when selected tier has no model", async () => {
      const config: SmartRoutingConfig = {
        enabled: true,
        classifier: "heuristic",
        tiers: {
          standard: { model: "anthropic/claude-sonnet-4-6" },
          // fast tier not configured, but greetings classify as fast
        },
      };
      const result = await resolveSmartRoute({ prompt: "hello", routingConfig: config });
      // Should fall back to standard since fast is not configured
      expect(result).not.toBeNull();
      expect(result!.modelOverride).toBe("claude-sonnet-4-6");
    });

    it("returns null when neither selected tier nor standard has a model", async () => {
      const config: SmartRoutingConfig = {
        enabled: true,
        classifier: "heuristic",
        tiers: {
          heavy: { model: "anthropic/claude-opus-4-6" },
          // No fast or standard tier
        },
      };
      const result = await resolveSmartRoute({ prompt: "hello", routingConfig: config });
      // fast tier not configured, standard fallback not configured
      expect(result).toBeNull();
    });
  });

  describe("classifier modes", () => {
    it("uses heuristic classifier by default", async () => {
      const config: SmartRoutingConfig = {
        enabled: true,
        tiers: fullConfig.tiers,
      };
      const result = await resolveSmartRoute({ prompt: "hello", routingConfig: config });
      expect(result).not.toBeNull();
      expect(result!.classification.classifier).toBe("heuristic");
    });

    it("uses heuristic classifier when mode is heuristic", async () => {
      const result = await resolveSmartRoute({
        prompt: "hello",
        routingConfig: fullConfig,
      });
      expect(result).not.toBeNull();
      expect(result!.classification.classifier).toBe("heuristic");
    });
  });

  describe("classification result", () => {
    it("includes tier in result", async () => {
      const result = await resolveSmartRoute({
        prompt: "hello",
        routingConfig: fullConfig,
      });
      expect(result).not.toBeNull();
      expect(["fast", "standard", "heavy"]).toContain(result!.tier);
    });

    it("includes classification details", async () => {
      const result = await resolveSmartRoute({
        prompt: "hello",
        routingConfig: fullConfig,
      });
      expect(result).not.toBeNull();
      expect(result!.classification).toHaveProperty("tier");
      expect(result!.classification).toHaveProperty("confidence");
      expect(result!.classification).toHaveProperty("reason");
      expect(result!.classification).toHaveProperty("classifier");
    });
  });
});
