import type { Trigger } from "@/ingestor/trigger.js";
import type { TriggerResponder } from "@/trigger/responder.js";

export type IntegrationId = "slack" | "github" | "linear" | "figma";

export interface IntegrationPlugin {
  readonly id: IntegrationId;
  readonly name: string;
  responder?: ResponderAdapter;
  actions?: ActionAdapter;
  setup?: SetupAdapter;
}

export interface ResponderAdapter {
  createResponder(trigger: Trigger): TriggerResponder;
  getChannelKey(trigger: Trigger): string;
}

export interface ActionAdapter {
  readonly availableActions: string[];
}

export interface SetupAdapter {
  runSetup(): Promise<Record<string, unknown>>;
  isConfigured(): boolean;
}
