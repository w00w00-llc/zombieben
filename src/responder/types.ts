import type { Trigger } from "@/ingestor/trigger.js";
import type { TriggerResponder } from "@/responder/responder.js";

export type ResponderRole = "primary" | "notifier";

export interface RoleTaggedResponder {
  channelKey: string;
  roles: ReadonlySet<ResponderRole>;
  responder: TriggerResponder;
}

export interface ResponderSet {
  trigger: Trigger;
  responders: readonly RoleTaggedResponder[];
}

export type SerializedResponderKind =
  | "slack_thread"
  | "slack_channel"
  | "github_noop";

export type SerializedResponder =
  | {
    kind: "slack_thread";
    channelKey: string;
    roles: ResponderRole[];
    target: { channel: string; threadTs: string; reactTs: string };
  }
  | {
    kind: "slack_channel";
    channelKey: string;
    roles: ResponderRole[];
    target: { channel: string };
  }
  | {
    kind: "github_noop";
    channelKey: string;
    roles: ResponderRole[];
    target: Record<string, never>;
  };

export interface RunRespondersSnapshot {
  version: 1;
  createdAt: string;
  triggerId: string;
  entries: SerializedResponder[];
}
