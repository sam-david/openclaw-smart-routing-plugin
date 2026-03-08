# Smart Model Routing

Automatic complexity-based model routing for OpenClaw. Routes requests to the right model for the job — fast, cheap models for simple tasks and capable models for complex ones.

## Why Smart Routing?

Most AI workloads follow a power-law distribution: the majority of requests are simple (greetings, quick lookups, short Q&A), while only a fraction require deep reasoning or multi-step orchestration. Without smart routing, every request hits your most expensive model — burning budget on work that a smaller model handles just as well.

**Cost reduction.** Routing simple requests to a lightweight model like Claude Haiku instead of Opus can cut per-request costs by 10-30x for those interactions. In a typical workload where 40-60% of messages are simple, this translates to significant savings with no quality loss on the tasks that matter.

**Faster responses.** Smaller models have lower latency. Simple questions get answered faster when they don't wait for a heavyweight model to spin up. Users get snappier interactions for the easy stuff, and the full power of a frontier model when they actually need it.

**Quality optimization that shifts spend to where it matters.** Rather than applying the same model uniformly, smart routing invests in your most capable model only for tasks that benefit from it — multi-step refactoring, architecture design, complex reasoning. Everything else gets a model that's just as good for the job at a fraction of the cost.

## How It Works

The plugin registers a `before_model_resolve` hook that classifies each incoming prompt into one of three complexity tiers:

- **fast** — Simple greetings, factual lookups, status checks, single-turn Q&A
- **standard** — Code questions, debugging, reviews, tool usage, file operations, single-step implementation
- **heavy** — Multi-step refactoring, architecture design, large-scale migrations, complex multi-signal reasoning

Based on the tier, the plugin overrides the model selection to route to the configured model for that tier.

## Installation

Install the plugin and configure it in your `openclaw.json` (at `~/.openclaw/openclaw.json`):

```bash
openclaw plugins install @openclaw/smart-routing
```

Then add the plugin config under `plugins.entries.smart-routing.config`:

```json
{
  "plugins": {
    "entries": {
      "smart-routing": {
        "enabled": true,
        "config": {
          "enabled": true,
          "classifier": "heuristic",
          "tiers": {
            "fast": { "model": "anthropic/claude-haiku-4-5" },
            "standard": { "model": "anthropic/claude-sonnet-4-6" },
            "heavy": { "model": "anthropic/claude-opus-4-6" }
          }
        }
      }
    }
  }
}
```

## Configuration

| Field                       | Type    | Default       | Description                                            |
| --------------------------- | ------- | ------------- | ------------------------------------------------------ |
| `enabled`                   | boolean | `false`       | Enable/disable smart routing                           |
| `classifier`                | string  | `"heuristic"` | Classifier mode: `"heuristic"`, `"llm"`, or `"hybrid"` |
| `tiers`                     | object  | —             | Per-tier model mappings (see below)                    |
| `hybridConfidenceThreshold` | number  | `0.8`         | Min heuristic confidence to skip LLM in hybrid mode    |

### Tier Configuration

Each tier (`fast`, `standard`, `heavy`) accepts:

| Field      | Type     | Description                                              |
| ---------- | -------- | -------------------------------------------------------- |
| `model`    | string   | **Required.** Model to use (`provider/model` format)     |
| `patterns` | string[] | Keywords that boost this tier's score (case-insensitive) |
| `triggers` | string[] | Additional trigger words (same as patterns)              |

### Classifier Modes

**`heuristic`** (default) — Zero-cost, zero-latency classification using message characteristics:

- Message length, line count, presence of code blocks, file paths, URLs
- Greeting and simple question detection
- Standard verb detection ("debug", "review", "implement", "optimize") → standard tier
- Heavy verb detection ("refactor", "architect", "restructure", "migrate") → scores in both standard and heavy, creating ambiguity for hybrid mode
- Multi-step language detection ("first...then", numbered steps)
- Heavy tier requires multiple stacked signals (verb + multi-step + length) for high confidence
- Custom `patterns` and `triggers` from config

Best for: keeping routing overhead at absolute zero. No API calls, no added latency.

**`llm`** — Uses the fast-tier model to classify every request via a structured API call. Adds ~200ms latency but is more accurate for ambiguous prompts. Requires an API key in the environment (e.g., `ANTHROPIC_API_KEY`). Falls back to heuristic on any error.

Best for: maximum classification accuracy when the latency cost is acceptable.

**`hybrid`** — Runs heuristic first. If confidence is below `hybridConfidenceThreshold`, falls back to the LLM classifier (Haiku) for the final call. Clear-cut cases (greetings, obvious complex tasks) resolve instantly via heuristic at zero cost. Ambiguous cases — like a single "refactor" verb without other complexity signals — get a Haiku classification call (~$0.0004) to make the nuanced Sonnet-vs-Opus decision.

Best for: the optimal balance of speed and accuracy in production.

## Examples

### Minimal setup (heuristic only)

Two tiers are enough. Simple messages route to Haiku; everything else goes to Sonnet. No heavy tier means complex tasks also use Sonnet.

```json
{
  "enabled": true,
  "classifier": "heuristic",
  "tiers": {
    "fast": { "model": "anthropic/claude-haiku-4-5" },
    "standard": { "model": "anthropic/claude-sonnet-4-6" }
  }
}
```

### Hybrid with custom patterns

Custom `patterns` and `triggers` let you tune classification for your specific workload. Heavy triggers should be system-scope verbs that indicate large-scale work — the heuristic already handles standard verbs like "debug" and "review" without config.

```json
{
  "enabled": true,
  "classifier": "hybrid",
  "hybridConfidenceThreshold": 0.75,
  "tiers": {
    "fast": {
      "model": "anthropic/claude-haiku-4-5",
      "patterns": ["greeting", "status", "weather", "time", "date"]
    },
    "standard": { "model": "anthropic/claude-sonnet-4-6" },
    "heavy": {
      "model": "anthropic/claude-opus-4-6",
      "triggers": ["refactor", "architect", "restructure", "rewrite", "migrate", "redesign"]
    }
  }
}
```

### Multi-provider setup

Mix providers across tiers. Use whichever model gives the best cost/performance ratio at each complexity level.

```json
{
  "enabled": true,
  "classifier": "heuristic",
  "tiers": {
    "fast": { "model": "openai/gpt-4o-mini" },
    "standard": { "model": "anthropic/claude-sonnet-4-6" },
    "heavy": { "model": "anthropic/claude-opus-4-6" }
  }
}
```

## Benchmarking

Run the included benchmark script to see how smart routing would classify a set of sample prompts and estimate cost savings vs a single-model baseline:

```bash
npx tsx benchmark.ts
```

The benchmark runs a representative prompt set through the classifier, shows the tier and model each prompt routes to, and calculates estimated cost savings compared to sending everything to a single model.

## Observability

The plugin logs every routing decision at info level:

```
[smart-routing] tier=fast model=anthropic/claude-haiku-4-5 confidence=0.85 classifier=heuristic reason="scores: fast=11; selected fast"
```

Each log entry includes the selected tier, routed model, classifier confidence, which classifier made the decision, and the raw scoring reason. Use these logs to monitor routing distribution and tune your tier configuration.

## Behavior Notes

- **Heartbeat and cron runs** are skipped — these have their own model configs.
- **Missing tier fallback** — if the classified tier has no model configured, the plugin falls back to the `standard` tier. If standard is also missing, routing is skipped and the default model is used.
- **Plugin hook precedence** — other `before_model_resolve` plugins with higher priority can override the smart routing decision.
- **LLM classifier auth** — the LLM classifier reads API keys from environment variables (`ANTHROPIC_API_KEY` for Anthropic, `OPENAI_API_KEY` for OpenAI). It does not use OpenClaw's auth profile system.
- **No breaking changes** — disabling the plugin or removing its config returns OpenClaw to default single-model behavior. There are no migrations or side effects.
