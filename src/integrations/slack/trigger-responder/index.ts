import type { WebClient } from "@slack/web-api";
import type { TriggerResponder } from "@/responder/responder.js";

const POLL_INTERVAL_MS = 3_000;
const REPLY_TIMEOUT_MS = 5 * 60 * 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ConversationsReplyMessage {
  ts?: string;
  text?: string;
  bot_id?: string;
  user?: string;
}

export class SlackResponder implements TriggerResponder {
  constructor(
    private client: WebClient,
    private channel: string,
    private threadTs: string,
  ) {}

  async send(message: string): Promise<void> {
    await this.client.chat.postMessage({
      channel: this.channel,
      thread_ts: this.threadTs,
      text: message,
    });
  }

  async promptChoice(message: string, options: string[]): Promise<number> {
    const numbered = options
      .map((opt, i) => `${i + 1}. ${opt}`)
      .join("\n");
    const prompt = `${message}\n${numbered}`;
    await this.send(prompt);

    const reply = await this.waitForReply("");
    const num = parseInt(reply.trim(), 10);
    if (isNaN(num) || num < 1 || num > options.length) {
      throw new Error(
        `Invalid choice "${reply.trim()}". Expected a number 1-${options.length}.`,
      );
    }
    return num - 1;
  }

  async waitForReply(prompt: string): Promise<string> {
    if (prompt) {
      await this.send(prompt);
    }

    const startTs = await this.getLatestTs();
    const deadline = Date.now() + REPLY_TIMEOUT_MS;

    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);

      const result = await this.client.conversations.replies({
        channel: this.channel,
        ts: this.threadTs,
        oldest: startTs,
      });

      const messages = (result.messages ?? []) as ConversationsReplyMessage[];
      const userReply = messages.find(
        (m) => !m.bot_id && m.ts !== this.threadTs && m.ts && m.ts > startTs,
      );
      if (userReply) {
        return userReply.text ?? "";
      }
    }

    throw new Error("Timed out waiting for Slack reply (5 minutes).");
  }

  private async getLatestTs(): Promise<string> {
    const result = await this.client.conversations.replies({
      channel: this.channel,
      ts: this.threadTs,
      limit: 1,
      inclusive: true,
    });
    const messages = (result.messages ?? []) as ConversationsReplyMessage[];
    if (messages.length === 0) return this.threadTs;
    return messages[messages.length - 1].ts ?? this.threadTs;
  }
}
