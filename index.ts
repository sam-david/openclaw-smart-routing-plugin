import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { resolveSmartRoute } from "./src/router.js";
import type { SmartRoutingConfig } from "./src/types.js";

export default function register(api: OpenClawPluginApi) {
  const config = api.pluginConfig as SmartRoutingConfig;

  if (!config?.enabled) {
    api.logger.info("Smart routing disabled");
    return;
  }

  api.logger.info(`Smart routing enabled (classifier: ${config.classifier ?? "heuristic"})`);

  api.on("before_model_resolve", async (event, ctx) => {
    // Skip routing for heartbeat and cron triggers — these have their own model configs.
    if (ctx.trigger === "heartbeat" || ctx.trigger === "cron") return;

    const result = await resolveSmartRoute({
      prompt: event.prompt,
      routingConfig: config,
    });
    if (!result) return;

    api.logger.info(
      `[smart-routing] tier=${result.tier} ` +
        `model=${result.providerOverride}/${result.modelOverride} ` +
        `confidence=${result.classification.confidence.toFixed(2)} ` +
        `classifier=${result.classification.classifier} ` +
        `reason="${result.classification.reason}"`,
    );

    return {
      modelOverride: result.modelOverride,
      providerOverride: result.providerOverride,
    };
  });
}
