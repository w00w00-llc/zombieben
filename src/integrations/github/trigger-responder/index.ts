import type { TriggerResponder, SentMessage } from "@/responder/responder.js";
import type { TriageOutcome } from "@/triage/types.js";

/**
 * Placeholder primary responder for github_poll triggers.
 * GitHub notification delivery is not implemented yet.
 */
export class GithubNoopResponder implements TriggerResponder {
  async send(message: string): Promise<SentMessage> {
    void message;
    return { id: "github-noop" };
  }

  async sendOutcome(outcome: TriageOutcome): Promise<SentMessage> {
    void outcome;
    return { id: "github-noop" };
  }

  async edit(sent: SentMessage, message: string): Promise<void> {
    void sent;
    void message;
  }

  async react(emoji: string): Promise<void> {
    void emoji;
  }

  async unreact(emoji: string): Promise<void> {
    void emoji;
  }
}
