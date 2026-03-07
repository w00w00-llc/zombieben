import type { WebClient } from "@slack/web-api";
import type { TriggerResponder, SentMessage } from "@/responder/responder.js";

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
    private reactTs: string = threadTs,
  ) {}

  async send(message: string): Promise<SentMessage> {
    const result = await this.client.chat.postMessage({
      channel: this.channel,
      thread_ts: this.threadTs,
      text: message,
    });
    return { id: result.ts as string };
  }

  async edit(sent: SentMessage, message: string): Promise<void> {
    await this.client.chat.update({
      channel: this.channel,
      ts: sent.id,
      text: message,
    });
  }

  async react(emoji: string): Promise<void> {
    await this.client.reactions.add({
      channel: this.channel,
      timestamp: this.reactTs,
      name: emoji,
    });
  }

  async unreact(emoji: string): Promise<void> {
    try {
      await this.client.reactions.remove({
        channel: this.channel,
        timestamp: this.reactTs,
        name: emoji,
      });
    } catch (err: unknown) {
      const code = (err as { data?: { error?: string } })?.data?.error;
      if (code !== "no_reaction") throw err;
    }
  }

  async promptChoice(message: string, options: string[]): Promise<number> {
    const numbered = options
      .map((opt, i) => `${i + 1}. ${opt}`)
      .join("\n");
    const prompt = `${message}\n${numbered}`;
    await this.send(prompt);

    const reply = await this.waitForReply("");
    const index = parseChoice(reply, options);
    if (index === -1) {
      throw new Error(
        `Invalid choice "${reply.trim()}". Expected a number 1-${options.length} or one of: ${options.join(", ")}.`,
      );
    }
    return index;
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

/**
 * Parse a user's reply into a 0-based option index.
 * Tries: bare number ("1"), number in text ("@bot 2"), then substring match
 * against option text (e.g. "yes" matches "Yes, run it").
 * Returns -1 if no match.
 */
export function parseChoice(reply: string, options: string[]): number {
  const cleaned = reply
    .replace(/<@[A-Z0-9]+>/g, "")
    .trim();

  // Try bare number
  const num = parseInt(cleaned, 10);
  if (!isNaN(num) && num >= 1 && num <= options.length) {
    return num - 1;
  }

  // Try substring match against option text (case-insensitive)
  const lower = cleaned.toLowerCase();
  for (let i = 0; i < options.length; i++) {
    const optLower = options[i].toLowerCase();
    if (lower.includes(optLower) || optLower.includes(lower)) {
      return i;
    }
  }

  return -1;
}
