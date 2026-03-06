import type { Trigger } from "@/ingestor/trigger.js";
import type { IngestorChannel } from "@/ingestor/ingestor-channel.js";
import type { ResponderSet, RoleTaggedResponder, ResponderRole } from "./types.js";
import { createSlackNotifierResponder } from "@/integrations/slack/notifier-responder/index.js";

const SOURCE_TO_CHANNEL: Record<string, string> = {
  slack_webhook: "slack",
  github_webhook: "github-webhook",
  github_poll: "github-poll",
};

export function resolveResponders(
  trigger: Trigger,
  channels: readonly IngestorChannel[],
): ResponderSet {
  const entries = new Map<string, { roles: Set<ResponderRole>; responder: RoleTaggedResponder["responder"] }>();

  // 1. Primary responder from matching channel
  const channelName = SOURCE_TO_CHANNEL[trigger.source];
  if (channelName) {
    const channel = channels.find((c) => c.name === channelName);
    if (channel) {
      const channelKey = channel.getChannelKey(trigger);
      const responder = channel.getPrimaryResponder(trigger);
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
