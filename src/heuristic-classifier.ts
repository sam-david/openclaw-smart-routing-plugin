import type { ClassificationResult, RoutingTier, SmartRoutingConfig } from "./types.js";

const GREETING_PATTERNS =
  /^(hi|hello|hey|thanks|thank you|ok|okay|sure|yes|no|bye|goodbye|good morning|good evening|good night|gm|gn)\b/i;

const SIMPLE_QUESTION_PATTERNS =
  /^(what is|what's|when is|when's|where is|where's|who is|who's|how do i|how do you|can you|could you|tell me)\b/i;

// Verbs that suggest moderate complexity — Sonnet-level work
const STANDARD_VERB_PATTERNS =
  /\b(debug|review|implement|optimize|analyze|compare|evaluate|benchmark)\b/i;

// Verbs that suggest system-level scope — Opus-level when combined with other signals
const HEAVY_VERB_PATTERNS =
  /\b(refactor|architect|restructure|rewrite|migrate|redesign)\b/i;

const MULTI_STEP_PATTERNS =
  /\b(first\b.*\bthen\b|step\s*\d|1\.\s|2\.\s|3\.\s|\band\s+then\b|\bafter\s+that\b|\bnext\b.*\bthen\b)/is;

const CODE_FENCE_RE = /```/g;

const FILE_PATH_RE = /(?:\/[\w.-]+){2,}|[\w.-]+\.[a-z]{1,4}\b/i;

const URL_RE = /https?:\/\/\S+/i;

const TOOL_REQUEST_PATTERNS = /\b(search for|find|look up|look for|run|execute|fetch|check)\b/i;

type TierScores = Record<RoutingTier, number>;

function countCodeFences(text: string): number {
  const matches = text.match(CODE_FENCE_RE);
  return matches ? Math.floor(matches.length / 2) : 0;
}

function countQuestions(text: string): number {
  const matches = text.match(/\?/g);
  return matches ? matches.length : 0;
}

function hasNewlines(text: string): boolean {
  return text.includes("\n");
}

function matchesConfigPatterns(text: string, patterns?: string[]): boolean {
  if (!patterns || patterns.length === 0) return false;
  const lower = text.toLowerCase();
  return patterns.some((p) => lower.includes(p.toLowerCase()));
}

function scoreTiers(prompt: string, config?: SmartRoutingConfig): TierScores {
  const scores: TierScores = { fast: 0, standard: 0, heavy: 0 };
  const trimmed = prompt.trim();
  const length = trimmed.length;

  // Gather signals
  const hasStandardVerbs = STANDARD_VERB_PATTERNS.test(trimmed);
  const hasHeavyVerbs = HEAVY_VERB_PATTERNS.test(trimmed);
  const hasMultiStep = MULTI_STEP_PATTERNS.test(trimmed);
  const questionCount = countQuestions(trimmed);
  const codeBlocks = countCodeFences(trimmed);
  const hasFilePaths = FILE_PATH_RE.test(trimmed);
  const hasUrls = URL_RE.test(trimmed);
  const hasToolRequest = TOOL_REQUEST_PATTERNS.test(trimmed);
  const lineCount = trimmed.split("\n").length;

  // ---- Heavy signals ----
  // Heavy verbs alone are ambiguous — they score in both standard and heavy
  // so that hybrid mode can let Haiku make the final call.
  // Only when combined with other complexity signals does heavy pull ahead.
  if (hasHeavyVerbs) {
    scores.heavy += 3;
    scores.standard += 2; // ambiguous: could be either tier
  }

  // Multi-step language is a strong complexity signal
  if (hasMultiStep) scores.heavy += 4;

  // Multiple code blocks suggest comparison/review across implementations
  if (codeBlocks >= 2) scores.heavy += 3;

  // Many questions suggest a deep exploration request
  if (questionCount >= 3) scores.heavy += 3;
  else if (questionCount >= 2) scores.heavy += 2;

  // Long messages with multiple lines suggest detailed/scoped tasks
  if (length > 800) scores.heavy += 3;
  else if (length > 500) scores.heavy += 2;

  // Multi-line structure (5+ lines) suggests organized, multi-part request
  if (lineCount >= 5) scores.heavy += 2;

  // Config-driven patterns/triggers (applied early to inform suppression logic)
  const tiers = config?.tiers;
  if (tiers?.heavy && matchesConfigPatterns(trimmed, tiers.heavy.patterns)) scores.heavy += 5;
  if (tiers?.heavy && matchesConfigPatterns(trimmed, tiers.heavy.triggers)) scores.heavy += 5;

  // Heavy requires conviction: only suppress fast if heavy score is decisive (>= 5)
  const hasStrongHeavySignals = scores.heavy >= 5;

  // ---- Standard signals ----
  // Standard verbs (debug, review, etc.) are Sonnet-level work on their own
  if (hasStandardVerbs) scores.standard += 3;

  if (codeBlocks === 1) scores.standard += 3;
  if (hasFilePaths || hasUrls) scores.standard += 2;
  if (hasToolRequest) scores.standard += 2;

  // Medium-length messages without strong heavy signals → standard
  if (length > 50 && length <= 500 && !hasStrongHeavySignals) scores.standard += 2;

  // A single question with moderate length → standard
  if (questionCount === 1 && length > 80) scores.standard += 1;

  // ---- Fast signals — only apply when no strong heavy signals ----
  if (!hasStrongHeavySignals) {
    if (GREETING_PATTERNS.test(trimmed)) scores.fast += 5;
    if (SIMPLE_QUESTION_PATTERNS.test(trimmed) && length < 100) scores.fast += 3;
    if (length < 50 && !hasStandardVerbs && !hasHeavyVerbs) scores.fast += 3;
    if (!hasNewlines(trimmed) && length < 80 && !hasStandardVerbs) scores.fast += 1;
    if (codeBlocks === 0 && !hasFilePaths && !hasUrls && !hasToolRequest) scores.fast += 2;
  }

  // ---- Config-driven patterns/triggers for fast and standard tiers ----
  if (tiers?.fast && matchesConfigPatterns(trimmed, tiers.fast.patterns)) scores.fast += 5;
  if (tiers?.fast && matchesConfigPatterns(trimmed, tiers.fast.triggers)) scores.fast += 5;
  if (tiers?.standard && matchesConfigPatterns(trimmed, tiers.standard.patterns))
    scores.standard += 5;
  if (tiers?.standard && matchesConfigPatterns(trimmed, tiers.standard.triggers))
    scores.standard += 5;

  return scores;
}

function pickTier(scores: TierScores): { tier: RoutingTier; confidence: number } {
  const entries: [RoutingTier, number][] = [
    ["fast", scores.fast],
    ["standard", scores.standard],
    ["heavy", scores.heavy],
  ];
  entries.sort((a, b) => b[1] - a[1]);

  const [top, second] = entries;
  const topScore = top[1];
  const secondScore = second[1];

  // Avoid division by zero; if topScore is 0, default to standard with low confidence.
  if (topScore === 0) {
    return { tier: "standard", confidence: 0.3 };
  }

  const rawConfidence = (topScore - secondScore) / topScore;
  const confidence = Math.max(0.3, Math.min(1.0, rawConfidence));

  return { tier: top[0], confidence };
}

function buildReason(scores: TierScores, tier: RoutingTier): string {
  const parts: string[] = [];
  if (scores.fast > 0) parts.push(`fast=${scores.fast}`);
  if (scores.standard > 0) parts.push(`standard=${scores.standard}`);
  if (scores.heavy > 0) parts.push(`heavy=${scores.heavy}`);
  return `scores: ${parts.join(", ")}; selected ${tier}`;
}

/**
 * Classify a prompt into a complexity tier using zero-cost heuristics.
 * Returns a tier, confidence score, and human-readable reason.
 */
export function classifyWithHeuristics(params: {
  prompt: string;
  config?: SmartRoutingConfig;
}): ClassificationResult {
  const scores = scoreTiers(params.prompt, params.config);
  const { tier, confidence } = pickTier(scores);
  return {
    tier,
    confidence,
    reason: buildReason(scores, tier),
    classifier: "heuristic",
  };
}
