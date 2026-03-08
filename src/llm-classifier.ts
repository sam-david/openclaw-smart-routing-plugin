import { classifyWithHeuristics } from "./heuristic-classifier.js";
import type {
  ClassificationResult,
  ParsedModelRef,
  RoutingTier,
  SmartRoutingConfig,
} from "./types.js";

const CLASSIFICATION_PROMPT = `You are a request complexity classifier. Analyze the user's message and classify it into one of three tiers:

- "fast": Simple greetings, factual lookups, status checks, single-turn Q&A, short simple questions
- "standard": Multi-step tasks, tool usage, conversation with context, code questions, file operations
- "heavy": Complex reasoning, multi-tool orchestration, long-form generation, refactoring, architecture design, debugging complex issues

Respond with ONLY a JSON object (no markdown, no extra text):
{"tier": "fast|standard|heavy", "reason": "brief reason"}`;

/** Parse a "provider/model" string by splitting on the first "/". */
export function parseModelString(raw: string): ParsedModelRef | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const slash = trimmed.indexOf("/");
  if (slash === -1) return null;
  const provider = trimmed.slice(0, slash).trim();
  const model = trimmed.slice(slash + 1).trim();
  if (!provider || !model) return null;
  return { provider, model };
}

function resolveApiEndpoint(provider: string): { url: string; envKey: string } | null {
  switch (provider.toLowerCase()) {
    case "anthropic":
      return { url: "https://api.anthropic.com/v1/messages", envKey: "ANTHROPIC_API_KEY" };
    case "openai":
      return { url: "https://api.openai.com/v1/chat/completions", envKey: "OPENAI_API_KEY" };
    default:
      return null;
  }
}

async function callAnthropicClassifier(
  model: string,
  apiKey: string,
  userPrompt: string,
): Promise<ClassificationResult | null> {
  const body = {
    model,
    max_tokens: 100,
    messages: [{ role: "user", content: userPrompt }],
    system: CLASSIFICATION_PROMPT,
  };

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) return null;

  const data = (await resp.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = data.content?.find((c) => c.type === "text")?.text?.trim();
  if (!text) return null;

  return parseClassificationResponse(text);
}

async function callOpenAiClassifier(
  model: string,
  apiKey: string,
  userPrompt: string,
): Promise<ClassificationResult | null> {
  const body = {
    model,
    max_tokens: 100,
    messages: [
      { role: "system", content: CLASSIFICATION_PROMPT },
      { role: "user", content: userPrompt },
    ],
  };

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) return null;

  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) return null;

  return parseClassificationResponse(text);
}

function parseClassificationResponse(text: string): ClassificationResult | null {
  try {
    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(cleaned) as { tier?: string; reason?: string };
    const tier = parsed.tier?.toLowerCase();
    if (tier !== "fast" && tier !== "standard" && tier !== "heavy") return null;
    return {
      tier: tier as RoutingTier,
      confidence: 0.9, // LLM classifications are high-confidence by default
      reason: parsed.reason ?? "LLM classification",
      classifier: "llm",
    };
  } catch {
    return null;
  }
}

/**
 * Classify a prompt using the fast-tier model via direct API call.
 * Falls back to heuristic classification on any error.
 */
export async function classifyWithLlm(params: {
  prompt: string;
  config: SmartRoutingConfig;
}): Promise<ClassificationResult> {
  const heuristicFallback = () =>
    classifyWithHeuristics({ prompt: params.prompt, config: params.config });

  // Determine which model to use for classification (fast tier model)
  const fastModel = params.config.tiers?.fast?.model;
  if (!fastModel) return heuristicFallback();

  const parsed = parseModelString(fastModel);
  if (!parsed) return heuristicFallback();

  const endpoint = resolveApiEndpoint(parsed.provider);
  if (!endpoint) return heuristicFallback();

  const apiKey = process.env[endpoint.envKey];
  if (!apiKey) return heuristicFallback();

  try {
    let result: ClassificationResult | null = null;

    if (parsed.provider === "anthropic") {
      result = await callAnthropicClassifier(parsed.model, apiKey, params.prompt);
    } else if (parsed.provider === "openai") {
      result = await callOpenAiClassifier(parsed.model, apiKey, params.prompt);
    }

    return result ?? heuristicFallback();
  } catch {
    return heuristicFallback();
  }
}
