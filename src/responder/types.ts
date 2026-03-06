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
