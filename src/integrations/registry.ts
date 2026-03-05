import type { IntegrationId, IntegrationPlugin } from "./types.js";
import { slackPlugin } from "./slack/index.js";
import { githubPlugin } from "./github/index.js";
import { linearPlugin } from "./linear/index.js";
import { figmaPlugin } from "./figma/index.js";

const plugins: ReadonlyMap<IntegrationId, IntegrationPlugin> = new Map([
  ["slack", slackPlugin],
  ["github", githubPlugin],
  ["linear", linearPlugin],
  ["figma", figmaPlugin],
]);

export function getPlugin(id: string): IntegrationPlugin | undefined {
  return plugins.get(id as IntegrationId);
}

export function getAllPlugins(): IntegrationPlugin[] {
  return [...plugins.values()];
}
