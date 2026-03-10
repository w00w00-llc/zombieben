import { describe, it, expect, vi } from "vitest";
import { SlackResponder } from "./index.js";
import type { WebClient } from "@slack/web-api";
import type { TriageOutcome } from "@/triage/types.js";

function createMockClient() {
  return {
    chat: {
      postMessage: vi.fn().mockResolvedValue({ ok: true, ts: "1234.9999" }),
      update: vi.fn().mockResolvedValue({ ok: true }),
    },
    files: {
      uploadV2: vi.fn().mockResolvedValue({ ok: true, files: [{ id: "F123" }] }),
    },
    reactions: {
      add: vi.fn().mockResolvedValue({ ok: true }),
      remove: vi.fn().mockResolvedValue({ ok: true }),
    },
  } as unknown as WebClient & {
    chat: { postMessage: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    files: { uploadV2: ReturnType<typeof vi.fn> };
    reactions: { add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
  };
}

describe("SlackResponder", () => {
  it("send calls chat.postMessage with correct params", async () => {
    const client = createMockClient();
    const responder = new SlackResponder(client as unknown as WebClient, "C123", "1234.5678");

    await responder.send("hello world");

    expect(client.chat.postMessage).toHaveBeenCalledWith({
      channel: "C123",
      thread_ts: "1234.5678",
      text: "hello world",
    });
  });

  it("send uploads all attachments as a single threaded message", async () => {
    const client = createMockClient();
    const responder = new SlackResponder(client as unknown as WebClient, "C123", "1234.5678");

    await responder.send("please review", {
      attachments: ["/tmp/plan.md", "/tmp/spec.md"],
    });

    expect(client.files.uploadV2).toHaveBeenCalledWith({
      channel_id: "C123",
      thread_ts: "1234.5678",
      initial_comment: "please review",
      file_uploads: [
        { file: "/tmp/plan.md", filename: "plan.md" },
        { file: "/tmp/spec.md", filename: "spec.md" },
      ],
    });
    expect(client.chat.postMessage).not.toHaveBeenCalled();
  });

  it("sendOutcome posts blocks with mrkdwn", async () => {
    const client = createMockClient();
    const responder = new SlackResponder(client as unknown as WebClient, "C123", "1234.5678");
    const outcome: TriageOutcome = {
      kind: "immediate_response",
      message: "hello",
      reasoning: "test",
    };

    await responder.sendOutcome(outcome);

    expect(client.chat.postMessage).toHaveBeenCalledWith({
      channel: "C123",
      thread_ts: "1234.5678",
      text: "Triage: immediate_response\nhello",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "Triage: immediate_response\nhello",
          },
        },
      ],
    });
  });

  it("edit calls chat.update", async () => {
    const client = createMockClient();
    const responder = new SlackResponder(client as unknown as WebClient, "C123", "1234.5678");

    await responder.edit({ id: "1234.9000" }, "updated text");

    expect(client.chat.update).toHaveBeenCalledWith({
      channel: "C123",
      ts: "1234.9000",
      text: "updated text",
    });
  });

  it("react calls reactions.add on reactTs", async () => {
    const client = createMockClient();
    const responder = new SlackResponder(client as unknown as WebClient, "C123", "1234.5678", "1234.0000");

    await responder.react("eyes");

    expect(client.reactions.add).toHaveBeenCalledWith({
      channel: "C123",
      timestamp: "1234.0000",
      name: "eyes",
    });
  });

  it("unreact swallows no_reaction error", async () => {
    const client = createMockClient();
    client.reactions.remove.mockRejectedValue({ data: { error: "no_reaction" } });
    const responder = new SlackResponder(client as unknown as WebClient, "C123", "1234.5678");

    await expect(responder.unreact("eyes")).resolves.toBeUndefined();
  });
});
