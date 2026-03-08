import { resolveSmartRoute } from "./src/router.js";
import type { SmartRoutingConfig } from "./src/types.js";

// ---------------------------------------------------------------------------
// Model pricing (per 1M tokens, March 2026)
// ---------------------------------------------------------------------------
const PRICING: Record<string, { input: number; output: number }> = {
  "anthropic/claude-opus-4-6": { input: 5.0, output: 25.0 },
  "anthropic/claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "anthropic/claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "openai/gpt-4o": { input: 2.5, output: 10.0 },
  "openai/gpt-4o-mini": { input: 0.15, output: 0.6 },
};

// ---------------------------------------------------------------------------
// Representative prompt set — mix of simple, medium, and complex
// ---------------------------------------------------------------------------
const PROMPTS: { label: string; text: string; estimatedTokens: number }[] = [
  { label: "Greeting", text: "hello", estimatedTokens: 50 },
  { label: "Thanks", text: "thanks!", estimatedTokens: 30 },
  { label: "Status check", text: "what's my balance?", estimatedTokens: 80 },
  { label: "Simple question", text: "What is TypeScript?", estimatedTokens: 200 },
  { label: "Short Q&A", text: "How do I install node?", estimatedTokens: 150 },
  { label: "Yes/no", text: "ok", estimatedTokens: 20 },
  { label: "Weather", text: "what's the weather like today?", estimatedTokens: 100 },
  {
    label: "Code question",
    text: "Can you explain how async/await works in JavaScript and show me an example with error handling?",
    estimatedTokens: 500,
  },
  {
    label: "File search",
    text: "Search for all files matching *.test.ts in the src directory",
    estimatedTokens: 300,
  },
  {
    label: "Tool use",
    text: "Run the test suite and show me which tests are failing",
    estimatedTokens: 400,
  },
  {
    label: "Code review",
    text: "Review this pull request and check for security issues:\n```typescript\napp.get('/user/:id', (req, res) => {\n  const user = db.query(`SELECT * FROM users WHERE id = ${req.params.id}`);\n  res.json(user);\n});\n```",
    estimatedTokens: 800,
  },
  {
    label: "Refactor",
    text: "Refactor the authentication module to use OAuth2 instead of basic auth. First analyze the current implementation, then design the new architecture, and finally implement the changes.",
    estimatedTokens: 2000,
  },
  {
    label: "Debug session",
    text: "Debug this memory leak: the application's RSS grows by 50MB/hour under load. I've narrowed it down to the WebSocket handler but can't find the root cause. Here's the relevant code and heap snapshots.",
    estimatedTokens: 1500,
  },
  {
    label: "Architecture",
    text: "Design a microservices architecture for our e-commerce platform. We need to handle 10k concurrent users with real-time inventory updates. Compare event-driven vs request-response patterns and recommend the best approach.",
    estimatedTokens: 3000,
  },
  {
    label: "Multi-step task",
    text: "1. Read the current database schema\n2. Add a new 'preferences' table with JSON columns\n3. Create a migration script\n4. Update the ORM models\n5. Add API endpoints for CRUD operations\n6. Write integration tests",
    estimatedTokens: 2500,
  },
];

// ---------------------------------------------------------------------------
// Routing config (matches the standard 3-tier setup)
// ---------------------------------------------------------------------------
const ROUTING_CONFIG: SmartRoutingConfig = {
  enabled: true,
  classifier: "heuristic",
  tiers: {
    fast: { model: "anthropic/claude-haiku-4-5" },
    standard: { model: "anthropic/claude-sonnet-4-6" },
    heavy: { model: "anthropic/claude-opus-4-6" },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function costForModel(
  modelKey: string,
  estimatedInputTokens: number,
  estimatedOutputTokens: number,
): number {
  const pricing = PRICING[modelKey];
  if (!pricing) return 0;
  return (
    (estimatedInputTokens / 1_000_000) * pricing.input +
    (estimatedOutputTokens / 1_000_000) * pricing.output
  );
}

function pad(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);
}

// ---------------------------------------------------------------------------
// Run a single scenario: one baseline model vs smart routing
// ---------------------------------------------------------------------------
async function runScenario(baselineModel: string) {
  const baselinePricing = PRICING[baselineModel]!;

  console.log();
  console.log(
    `  Baseline: all requests → ${baselineModel} ($${baselinePricing.input}/$${baselinePricing.output} per 1M tokens in/out)`,
  );
  console.log(
    "  Routing:  fast → haiku-4-5 ($1/$5) | standard → sonnet-4-6 ($3/$15) | heavy → opus-4-6 ($5/$25)",
  );
  console.log();
  console.log(
    pad("  Prompt", 22) +
      pad("Tier", 12) +
      pad("Conf", 8) +
      pad("Routed Model", 26) +
      pad("Baseline $", 14) +
      pad("Routed $", 14) +
      "Diff",
  );
  console.log("  " + "-".repeat(98));

  let totalBaseline = 0;
  let totalRouted = 0;
  const tierCounts: Record<string, number> = { fast: 0, standard: 0, heavy: 0 };

  for (const prompt of PROMPTS) {
    const result = await resolveSmartRoute({
      prompt: prompt.text,
      routingConfig: ROUTING_CONFIG,
    });

    const tier = result?.tier ?? "standard";
    const routedModel = result
      ? `${result.providerOverride}/${result.modelOverride}`
      : baselineModel;
    const confidence = result?.classification.confidence ?? 0;

    tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;

    // Estimate output tokens based on complexity
    const outputMultiplier = tier === "fast" ? 1.5 : tier === "heavy" ? 3 : 2;
    const estOutputTokens = Math.round(prompt.estimatedTokens * outputMultiplier);

    const baselineCost = costForModel(baselineModel, prompt.estimatedTokens, estOutputTokens);
    const routedCost = costForModel(routedModel, prompt.estimatedTokens, estOutputTokens);

    totalBaseline += baselineCost;
    totalRouted += routedCost;

    const pctDiff = baselineCost > 0 ? ((routedCost / baselineCost - 1) * 100).toFixed(0) : "0";
    const diffNum = Number(pctDiff);
    const diffDisplay =
      diffNum < 0 ? `${pctDiff}%` : diffNum > 0 ? `+${pctDiff}%` : "same";

    console.log(
      pad(`  ${prompt.label}`, 22) +
        pad(tier, 12) +
        pad(confidence.toFixed(2), 8) +
        pad(routedModel.split("/")[1]!, 26) +
        pad(`$${baselineCost.toFixed(6)}`, 14) +
        pad(`$${routedCost.toFixed(6)}`, 14) +
        diffDisplay,
    );
  }

  console.log("  " + "-".repeat(98));

  const pctChange = totalBaseline > 0 ? ((totalRouted / totalBaseline - 1) * 100).toFixed(1) : "0";
  const absDiff = totalRouted - totalBaseline;
  const sign = absDiff <= 0 ? "" : "+";

  console.log();
  console.log(
    `  Tier distribution:  fast=${tierCounts.fast}  standard=${tierCounts.standard}  heavy=${tierCounts.heavy}  (${PROMPTS.length} total)`,
  );
  console.log(`  Baseline total:      $${totalBaseline.toFixed(6)}`);
  console.log(`  Smart routing total: $${totalRouted.toFixed(6)}`);
  console.log(`  Difference:          ${sign}$${absDiff.toFixed(6)} (${sign}${pctChange}%)`);

  return { totalBaseline, totalRouted, tierCounts };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function run() {
  console.log("=".repeat(102));
  console.log("  Smart Routing Benchmark — Cost Comparison");
  console.log("=".repeat(102));

  // Scenario 1: Baseline = Opus (expensive default → routing saves money)
  console.log();
  console.log("  SCENARIO A: Default model is Opus (most expensive)");
  console.log("  " + "=".repeat(60));
  const a = await runScenario("anthropic/claude-opus-4-6");

  // Scenario 2: Baseline = Sonnet (mid-tier default → routing saves on easy, spends on hard)
  console.log();
  console.log();
  console.log("  SCENARIO B: Default model is Sonnet (mid-tier)");
  console.log("  " + "=".repeat(60));
  const b = await runScenario("anthropic/claude-sonnet-4-6");

  // Summary comparison
  console.log();
  console.log();
  console.log("=".repeat(102));
  console.log("  Takeaway");
  console.log("=".repeat(102));
  console.log();

  const aSavingsPct = ((1 - a.totalRouted / a.totalBaseline) * 100).toFixed(0);
  const bDiffPct = ((a.totalRouted / a.totalBaseline - 1) * 100).toFixed(0);

  console.log(
    `  If your default model is Opus:   smart routing saves ${aSavingsPct}% — simple tasks go to Haiku,`,
  );
  console.log(
    "                                   standard tasks go to Sonnet, only complex work stays on Opus.",
  );
  console.log();
  console.log(
    "  If your default model is Sonnet: smart routing upgrades complex tasks to Opus for better quality",
  );
  console.log(
    "                                   while downgrading simple tasks to Haiku for cost savings.",
  );
  console.log(
    "                                   Net cost depends on your workload's complexity distribution.",
  );
  console.log();

  const fastPct = ((a.tierCounts.fast! / PROMPTS.length) * 100).toFixed(0);
  console.log(
    `  In this sample, ${fastPct}% of prompts classified as fast — all routed to Haiku at 1/5th the Opus cost.`,
  );
  console.log();
}

run().catch(console.error);
