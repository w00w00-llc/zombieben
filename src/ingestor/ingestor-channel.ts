import type { Trigger } from "./trigger.js";
import type { TriggerResponder } from "@/responder/responder.js";
import type { Ingestor } from "./ingestor.js";

export interface IngestorChannel {
  readonly name: string;
  isEnabled(): boolean;
  startListener(ingestor: Ingestor): Promise<void>;
  stopListener(): Promise<void>;
  getPrimaryResponder(trigger: Trigger): TriggerResponder;
  getChannelKey(trigger: Trigger): string;
}
