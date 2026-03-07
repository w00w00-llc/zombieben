import type { TriageOutcome } from "@/triage/types.js";

export interface SentMessage {
  id: string;
}

export interface TriggerResponder {
  send(message: string): Promise<SentMessage>;
  sendOutcome(outcome: TriageOutcome): Promise<SentMessage>;
  edit(sent: SentMessage, message: string): Promise<void>;
  react(emoji: string): Promise<void>;
  unreact(emoji: string): Promise<void>;
}
