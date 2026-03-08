import { describe, expect, it } from "vitest";
import { classifyWithHeuristics } from "./heuristic-classifier.js";

describe("classifyWithHeuristics", () => {
  describe("fast tier", () => {
    it("classifies simple greetings as fast", () => {
      for (const greeting of ["hi", "hello", "hey", "thanks", "ok", "bye"]) {
        const result = classifyWithHeuristics({ prompt: greeting });
        expect(result.tier).toBe("fast");
        expect(result.confidence).toBeGreaterThan(0.5);
      }
    });

    it("classifies simple questions as fast", () => {
      const result = classifyWithHeuristics({ prompt: "what is TypeScript?" });
      expect(result.tier).toBe("fast");
    });

    it("classifies short messages without code as fast", () => {
      const result = classifyWithHeuristics({ prompt: "yes please" });
      expect(result.tier).toBe("fast");
    });

    it("has high confidence for clear fast cases", () => {
      const result = classifyWithHeuristics({ prompt: "hello" });
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });
  });

  describe("standard tier", () => {
    it("classifies messages with a single code block as standard", () => {
      const result = classifyWithHeuristics({
        prompt: "Can you fix this function?\n```\nfunction add(a, b) { return a + b; }\n```",
      });
      expect(result.tier).toBe("standard");
    });

    it("classifies messages with file paths as standard", () => {
      const result = classifyWithHeuristics({
        prompt: "Please look at the file src/agents/model-selection.ts and tell me what it does",
      });
      expect(result.tier).toBe("standard");
    });

    it("classifies tool requests as standard", () => {
      const result = classifyWithHeuristics({
        prompt: "Search for all uses of the parseModelRef function in the codebase",
      });
      expect(result.tier).toBe("standard");
    });
  });

  describe("standard tier — single complex verbs", () => {
    it("classifies a single standard verb as standard, not heavy", () => {
      const result = classifyWithHeuristics({
        prompt: "Debug this CSS alignment issue in the navbar",
      });
      expect(result.tier).toBe("standard");
    });

    it("classifies review requests as standard", () => {
      const result = classifyWithHeuristics({
        prompt: "Review this function and tell me if there are any issues",
      });
      expect(result.tier).toBe("standard");
    });

    it("classifies single heavy verb without other signals as ambiguous (low confidence)", () => {
      const result = classifyWithHeuristics({
        prompt: "Refactor this function to be more readable",
      });
      // Single heavy verb scores in both standard and heavy — low confidence
      expect(result.confidence).toBeLessThan(0.8);
    });
  });

  describe("heavy tier", () => {
    it("classifies multi-step instructions as heavy", () => {
      const result = classifyWithHeuristics({
        prompt:
          "First, read the agent.ts file. Then refactor the model selection logic to support multiple providers. After that, update the tests.",
      });
      expect(result.tier).toBe("heavy");
    });

    it("classifies heavy verbs combined with multi-step language as heavy", () => {
      const result = classifyWithHeuristics({
        prompt:
          "Refactor the entire authentication module to use OAuth2 instead of API keys. First analyze the current implementation, then restructure the auth profiles, and finally update all the tests.",
      });
      expect(result.tier).toBe("heavy");
    });

    it("classifies messages with multiple code blocks as heavy", () => {
      const prompt = [
        "Compare these two implementations:",
        "```typescript",
        "function a() { return 1; }",
        "```",
        "```typescript",
        "function b() { return 2; }",
        "```",
        "Which one is better and why?",
      ].join("\n");
      const result = classifyWithHeuristics({ prompt });
      expect(result.tier).toBe("heavy");
    });

    it("classifies messages with numbered steps as heavy", () => {
      const result = classifyWithHeuristics({
        prompt:
          "Please do the following:\n1. Create a new module\n2. Add the routing logic\n3. Wire it into the pipeline\n4. Write tests",
      });
      expect(result.tier).toBe("heavy");
    });

    it("classifies messages with multiple questions as heavy", () => {
      const result = classifyWithHeuristics({
        prompt:
          "How does the model selection work? What is the fallback chain? Where are the auth profiles stored? Can we change the default provider?",
      });
      expect(result.tier).toBe("heavy");
    });

    it("classifies long multi-line messages with multiple questions as heavy", () => {
      const result = classifyWithHeuristics({
        prompt:
          "I need help with a complex problem.\nThe application has a memory leak that grows by 50MB per hour under load.\nI've checked the WebSocket handler and the heap snapshots show retained closures.\nWhat is causing the retained references?\nHow can I trace the allocation path?\nWhere should I look for the root cause?",
      });
      expect(result.tier).toBe("heavy");
    });
  });

  describe("config patterns", () => {
    it("boosts tier when config patterns match", () => {
      const result = classifyWithHeuristics({
        prompt: "Give me a status update on the deployment",
        config: {
          enabled: true,
          tiers: {
            fast: { model: "anthropic/claude-haiku-4-5", patterns: ["status"] },
          },
        },
      });
      expect(result.tier).toBe("fast");
    });

    it("boosts heavy tier when config triggers match", () => {
      const result = classifyWithHeuristics({
        prompt: "Let me know the reasoning behind this decision",
        config: {
          enabled: true,
          tiers: {
            heavy: { model: "anthropic/claude-opus-4-6", triggers: ["reasoning"] },
          },
        },
      });
      expect(result.tier).toBe("heavy");
    });
  });

  describe("edge cases", () => {
    it("handles empty string", () => {
      const result = classifyWithHeuristics({ prompt: "" });
      expect(result.tier).toBeDefined();
      expect(result.confidence).toBeGreaterThanOrEqual(0.3);
    });

    it("handles very long messages", () => {
      const longPrompt = "word ".repeat(200);
      const result = classifyWithHeuristics({ prompt: longPrompt });
      expect(result.tier).toBeDefined();
      expect(result.classifier).toBe("heuristic");
    });

    it("always returns confidence between 0.3 and 1.0", () => {
      const prompts = [
        "hi",
        "refactor the entire codebase",
        "search for foo",
        "",
        "a".repeat(1000),
      ];
      for (const prompt of prompts) {
        const result = classifyWithHeuristics({ prompt });
        expect(result.confidence).toBeGreaterThanOrEqual(0.3);
        expect(result.confidence).toBeLessThanOrEqual(1.0);
      }
    });

    it("always sets classifier to heuristic", () => {
      const result = classifyWithHeuristics({ prompt: "hello" });
      expect(result.classifier).toBe("heuristic");
    });

    it("includes a reason string", () => {
      const result = classifyWithHeuristics({ prompt: "hello" });
      expect(result.reason).toBeTruthy();
      expect(result.reason).toContain("scores:");
    });
  });
});
