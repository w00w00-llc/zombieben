import type { Trigger } from "@/ingestor/trigger.js";
import type { ResponderSet, RoleTaggedResponder, ResponderRole } from "./types.js";
import { getPlugin } from "@/integrations/registry.js";
import { createSlackNotifierResponder } from "@/integrations/slack/notifier-responder.js";

const SOURCE_TO_INTEGRATION: Record<string, string> = {
  slack_webhook: "slack",
  github_webhook: "github",
  github_poll: "github",
};

export function resolveResponders(trigger: Trigger): ResponderSet {
  const entries = new Map<string, { roles: Set<ResponderRole>; responder: RoleTaggedResponder["responder"] }>();

  // 1. Primary responder from integration plugin
  const integrationId = SOURCE_TO_INTEGRATION[trigger.source];
  if (integrationId) {
    const plugin = getPlugin(integrationId);
    if (plugin?.responder) {
      const channelKey = plugin.responder.getChannelKey(trigger);
      const responder = plugin.responder.createResponder(trigger);
      entries.set(channelKey, { roles: new Set(["primary"]), responder });
    }
  }

  // 2. Notifier responder (Slack notification channel)
  const notifier = createSlackNotifierResponder();
  if (notifier) {
    const existing = entries.get(notifier.channelKey);
    if (existing) {
      existing.roles.add("notifier");
    } else {
      entries.set(notifier.channelKey, { roles: new Set(["notifier"]), responder: notifier.responder });
    }
  }

  // 3. Build final array
  const responders: RoleTaggedResponder[] = [];
  for (const [channelKey, entry] of entries) {
    responders.push({
      channelKey,
      roles: entry.roles,
      responder: entry.responder,
    });
  }

  return { trigger, responders };
}
