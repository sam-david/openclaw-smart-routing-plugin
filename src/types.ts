/** Complexity tier for request routing. */
export type RoutingTier = "fast" | "standard" | "heavy";

/** Classification result from the request classifier. */
export type ClassificationResult = {
  tier: RoutingTier;
  /** Confidence score from 0.0 to 1.0. */
  confidence: number;
  /** Human-readable reason for the classification. */
  reason: string;
  /** Which classifier produced this result. */
  classifier: "heuristic" | "llm";
};

/** Per-tier configuration. */
export type RoutingTierConfig = {
  /** Model to use for this tier (provider/model string). */
  model: string;
  /** Keywords/patterns that trigger this tier (case-insensitive). */
  patterns?: string[];
  /** Complexity triggers for this tier (case-insensitive). */
  triggers?: string[];
};

/** Top-level smart routing plugin config. */
export type SmartRoutingConfig = {
  /** Enable/disable smart routing. Default: false. */
  enabled?: boolean;
  /** Classifier mode. Default: "heuristic". */
  classifier?: "heuristic" | "llm" | "hybrid";
  /** Per-tier model mappings. */
  tiers?: {
    fast?: RoutingTierConfig;
    standard?: RoutingTierConfig;
    heavy?: RoutingTierConfig;
  };
  /** Minimum heuristic confidence to skip LLM classification in hybrid mode. Default: 0.8. */
  hybridConfidenceThreshold?: number;
};

/** Parsed model reference (provider + model id). */
export type ParsedModelRef = {
  provider: string;
  model: string;
};
