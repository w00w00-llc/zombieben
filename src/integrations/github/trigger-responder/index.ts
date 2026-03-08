import type { TriggerResponder, SentMessage } from "@/responder/responder.js";
import type { TriageOutcome } from "@/triage/types.js";

/**
 * Placeholder primary responder for github_poll triggers.
 * GitHub notification delivery is not implemented yet.
 */
export class GithubNoopResponder implements TriggerResponder {
  async send(_message: string): Promise<SentMessage> {
    return { id: "github-noop" };
  }

  async sendOutcome(_outcome: TriageOutcome): Promise<SentMessage> {
    return { id: "github-noop" };
  }

  async edit(_sent: SentMessage, _message: string): Promise<void> {}

  async react(_emoji: string): Promise<void> {}

  async unreact(_emoji: string): Promise<void> {}
}

