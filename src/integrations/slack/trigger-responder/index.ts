import path from "node:path";
import type { WebClient } from "@slack/web-api";
import type {
  TriggerResponder,
  SentMessage,
  SendMessageOptions,
} from "@/responder/responder.js";
import type { TriageOutcome } from "@/triage/types.js";
import { formatSlackOutcomeText } from "../outcome-format.js";

export class SlackResponder implements TriggerResponder {
  constructor(
    private client: WebClient,
    private channel: string,
    private threadTs: string,
    private reactTs: string = threadTs,
  ) {}

  async send(message: string, options: SendMessageOptions = {}): Promise<SentMessage> {
    const attachments = normalizeAttachments(options.attachments);
    if (attachments.length > 0) {
      const result = await this.client.files.uploadV2({
        channel_id: this.channel,
        thread_ts: this.threadTs,
        initial_comment: message,
        file_uploads: attachments.map((file) => ({
          file,
          filename: path.basename(file),
        })),
      });
      return { id: extractUploadMessageId(result) };
    }

    const result = await this.client.chat.postMessage({
      channel: this.channel,
      thread_ts: this.threadTs,
      text: message,
    });
    return { id: result.ts as string };
  }

  async sendOutcome(outcome: TriageOutcome): Promise<SentMessage> {
    const text = formatSlackOutcomeText(outcome);
    const result = await this.client.chat.postMessage({
      channel: this.channel,
      thread_ts: this.threadTs,
      text,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text,
          },
        },
      ],
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
}

function normalizeAttachments(attachments: readonly string[] | undefined): string[] {
  if (!attachments || attachments.length === 0) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const attachment of attachments) {
    const value = attachment.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

function extractUploadMessageId(result: unknown): string {
  const files = (result as { files?: Array<{ id?: string }> })?.files;
  const id = files?.find((file) => typeof file.id === "string")?.id;
  return id ?? "slack-upload";
}
