import { classifyWithHeuristics } from "./heuristic-classifier.js";
import { classifyWithLlm, parseModelString } from "./llm-classifier.js";
import type { ClassificationResult, RoutingTier, SmartRoutingConfig } from "./types.js";

const DEFAULT_HYBRID_CONFIDENCE_THRESHOLD = 0.8;

export type SmartRouteResult = {
  modelOverride: string;
  providerOverride: string;
  tier: RoutingTier;
  classification: ClassificationResult;
};

/**
 * Classify the prompt and resolve the model for the selected tier.
 * Returns null if routing is disabled, no tiers are configured, or
 * the selected tier has no model configured.
 */
export async function resolveSmartRoute(params: {
  prompt: string;
  routingConfig: SmartRoutingConfig;
}): Promise<SmartRouteResult | null> {
  const { routingConfig } = params;

  if (!routingConfig.enabled) return null;
  if (!routingConfig.tiers) return null;

  const classifierMode = routingConfig.classifier ?? "heuristic";
  let classification: ClassificationResult;

  if (classifierMode === "llm") {
    classification = await classifyWithLlm({
      prompt: params.prompt,
      config: routingConfig,
    });
  } else if (classifierMode === "hybrid") {
    classification = classifyWithHeuristics({
      prompt: params.prompt,
      config: routingConfig,
    });
    const threshold =
      routingConfig.hybridConfidenceThreshold ?? DEFAULT_HYBRID_CONFIDENCE_THRESHOLD;
    if (classification.confidence < threshold) {
      classification = await classifyWithLlm({
        prompt: params.prompt,
        config: routingConfig,
      });
    }
  } else {
    classification = classifyWithHeuristics({
      prompt: params.prompt,
      config: routingConfig,
    });
  }

  // Look up the tier's model
  const tierConfig = routingConfig.tiers[classification.tier];
  if (!tierConfig?.model) {
    // No model for this tier — try falling back to standard
    const fallbackConfig = routingConfig.tiers.standard;
    if (!fallbackConfig?.model) return null;
    const parsed = parseModelString(fallbackConfig.model);
    if (!parsed) return null;
    return {
      modelOverride: parsed.model,
      providerOverride: parsed.provider,
      tier: classification.tier,
      classification,
    };
  }

  const parsed = parseModelString(tierConfig.model);
  if (!parsed) return null;

  return {
    modelOverride: parsed.model,
    providerOverride: parsed.provider,
    tier: classification.tier,
    classification,
  };
}
