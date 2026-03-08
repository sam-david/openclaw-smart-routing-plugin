# Smart Model Routing

Automatic complexity-based model routing for OpenClaw. Routes requests to the right model for the job — fast, cheap models for simple tasks and capable models for complex ones.

## Why Smart Routing?

Most AI workloads follow a power-law distribution: the majority of requests are simple (greetings, quick lookups, short Q&A), while only a fraction require deep reasoning or multi-step orchestration. Without smart routing, every request hits your most expensive model — burning budget on work that a smaller model handles just as well.

**Cost reduction.** Routing simple requests to a lightweight model like Claude Haiku instead of Opus can cut per-request costs by 10-30x for those interactions. In a typical workload where 40-60% of messages are simple, this translates to significant savings with no quality loss on the tasks that matter.

**Faster responses.** Smaller models have lower latency. Simple questions get answered faster when they don't wait for a heavyweight model to spin up. Users get snappier interactions for the easy stuff, and the full power of a frontier model when they actually need it.

**No quality tradeoff where it counts.** Complex tasks — refactoring, debugging, architecture design, multi-step reasoning — still route to your most capable model. The routing is additive: you keep full quality on hard problems while saving time and money on easy ones.

## How It Works

The plugin registers a `before_model_resolve` hook that classifies each incoming prompt into one of three complexity tiers:

- **fast** — Simple greetings, factual lookups, status checks, single-turn Q&A
- **standard** — Multi-step tasks, tool usage, code questions, file operations
- **heavy** — Complex reasoning, multi-tool orchestration, refactoring, architecture design

Based on the tier, the plugin overrides the model selection to route to the configured model for that tier.

## Installation

The plugin ships as a bundled extension. Enable it by adding config to your `openclaw.yaml`:

```yaml
plugins:
  smart-routing:
    enabled: true
    classifier: heuristic
    tiers:
      fast:
        model: anthropic/claude-haiku-4-5
      standard:
        model: anthropic/claude-sonnet-4-6
      heavy:
        model: anthropic/claude-opus-4-6
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

- Message length, presence of code blocks, file paths, URLs
- Greeting and simple question detection
- Complex task verb detection ("refactor", "debug", "implement", etc.)
- Multi-step language detection ("first...then", numbered steps)
- Custom `patterns` and `triggers` from config

Best for: keeping routing overhead at absolute zero. No API calls, no added latency.

**`llm`** — Uses the fast-tier model to classify every request via a structured API call. Adds ~200ms latency but is more accurate for ambiguous prompts. Requires an API key in the environment (e.g., `ANTHROPIC_API_KEY`). Falls back to heuristic on any error.

Best for: maximum classification accuracy when the latency cost is acceptable.

**`hybrid`** — Runs heuristic first. If confidence is below `hybridConfidenceThreshold`, falls back to the LLM classifier. Clear-cut cases (greetings, obvious complex tasks) resolve instantly; only ambiguous prompts pay the LLM latency cost.

Best for: the optimal balance of speed and accuracy in production.

## Examples

### Minimal setup (heuristic only)

```yaml
plugins:
  smart-routing:
    enabled: true
    tiers:
      fast:
        model: anthropic/claude-haiku-4-5
      standard:
        model: anthropic/claude-sonnet-4-6
```

Two tiers are enough. Simple messages route to Haiku; everything else goes to Sonnet. No heavy tier means complex tasks also use Sonnet.

### Hybrid with custom patterns

```yaml
plugins:
  smart-routing:
    enabled: true
    classifier: hybrid
    hybridConfidenceThreshold: 0.7
    tiers:
      fast:
        model: anthropic/claude-haiku-4-5
        patterns: [greeting, status, weather]
      standard:
        model: anthropic/claude-sonnet-4-6
      heavy:
        model: anthropic/claude-opus-4-6
        triggers: [reasoning, multi-tool, long-context]
```

Custom `patterns` and `triggers` let you tune classification for your specific workload. If your users frequently ask about "weather" and those are always simple lookups, add it as a fast-tier pattern.

### Multi-provider setup

```yaml
plugins:
  smart-routing:
    enabled: true
    tiers:
      fast:
        model: openai/gpt-4o-mini
      standard:
        model: anthropic/claude-sonnet-4-6
      heavy:
        model: anthropic/claude-opus-4-6
```

Mix providers across tiers. Use whichever model gives the best cost/performance ratio at each complexity level.

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
