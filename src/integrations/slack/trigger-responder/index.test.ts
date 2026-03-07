import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SlackResponder, parseChoice } from "./index.js";
import type { WebClient } from "@slack/web-api";

vi.mock("../../../util/keys.js", () => ({
  getIntegrationKeys: (id: string) => {
    if (id === "slack") return { bot_token: "xoxb-test-token" };
    return undefined;
  },
}));

function createMockClient() {
  return {
    chat: {
      postMessage: vi.fn().mockResolvedValue({ ok: true }),
    },
    conversations: {
      replies: vi.fn().mockResolvedValue({ ok: true, messages: [] }),
    },
  } as unknown as WebClient & {
    chat: { postMessage: ReturnType<typeof vi.fn> };
    conversations: { replies: ReturnType<typeof vi.fn> };
  };
}

describe("SlackResponder", () => {
  let responder: SlackResponder;
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockClient = createMockClient();
    responder = new SlackResponder(mockClient as unknown as WebClient, "C123", "1234.5678");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("send", () => {
    it("calls chat.postMessage with correct params", async () => {
      await responder.send("hello world");

      expect(mockClient.chat.postMessage).toHaveBeenCalledOnce();
      expect(mockClient.chat.postMessage).toHaveBeenCalledWith({
        channel: "C123",
        thread_ts: "1234.5678",
        text: "hello world",
      });
    });
  });

  describe("promptChoice", () => {
    it("posts numbered options and returns 0-based index", async () => {
      // getLatestTs call
      mockClient.conversations.replies.mockResolvedValueOnce({
        ok: true,
        messages: [{ ts: "1234.9000", text: "prompt", bot_id: "B1" }],
      });
      // poll - user replies "2"
      mockClient.conversations.replies.mockResolvedValueOnce({
        ok: true,
        messages: [
          { ts: "1234.9000", text: "prompt", bot_id: "B1" },
          { ts: "1234.9500", text: "2" },
        ],
      });

      const promise = responder.promptChoice("Pick one:", ["alpha", "beta", "gamma"]);
      await vi.advanceTimersByTimeAsync(3_000);
      const result = await promise;

      expect(result).toBe(1);

      expect(mockClient.chat.postMessage).toHaveBeenCalledWith({
        channel: "C123",
        thread_ts: "1234.5678",
        text: "Pick one:\n1. alpha\n2. beta\n3. gamma",
      });
    });
  });

  describe("waitForReply", () => {
    it("posts prompt and returns user reply text", async () => {
      // getLatestTs
      mockClient.conversations.replies.mockResolvedValueOnce({
        ok: true,
        messages: [{ ts: "1234.8000", text: "prompt", bot_id: "B1" }],
      });
      // poll - no new messages
      mockClient.conversations.replies.mockResolvedValueOnce({
        ok: true,
        messages: [{ ts: "1234.8000", text: "prompt", bot_id: "B1" }],
      });
      // poll - user replies
      mockClient.conversations.replies.mockResolvedValueOnce({
        ok: true,
        messages: [
          { ts: "1234.8000", text: "prompt", bot_id: "B1" },
          { ts: "1234.9000", text: "my answer" },
        ],
      });

      const promise = responder.waitForReply("What do you think?");
      await vi.advanceTimersByTimeAsync(3_000);
      await vi.advanceTimersByTimeAsync(3_000);
      const result = await promise;

      expect(result).toBe("my answer");
    });

    it("skips bot messages when polling", async () => {
      // getLatestTs
      mockClient.conversations.replies.mockResolvedValueOnce({
        ok: true,
        messages: [{ ts: "1234.8000", text: "x", bot_id: "B1" }],
      });
      // poll - only bot message
      mockClient.conversations.replies.mockResolvedValueOnce({
        ok: true,
        messages: [
          { ts: "1234.8000", text: "x", bot_id: "B1" },
          { ts: "1234.8500", text: "bot reply", bot_id: "B1" },
        ],
      });
      // poll - user replies
      mockClient.conversations.replies.mockResolvedValueOnce({
        ok: true,
        messages: [
          { ts: "1234.8000", text: "x", bot_id: "B1" },
          { ts: "1234.8500", text: "bot reply", bot_id: "B1" },
          { ts: "1234.9000", text: "user reply" },
        ],
      });

      const promise = responder.waitForReply("question?");
      await vi.advanceTimersByTimeAsync(3_000);
      await vi.advanceTimersByTimeAsync(3_000);
      const result = await promise;

      expect(result).toBe("user reply");
    });

    it("does not send a message when prompt is empty", async () => {
      // getLatestTs
      mockClient.conversations.replies.mockResolvedValueOnce({
        ok: true,
        messages: [{ ts: "1234.8000", text: "x", bot_id: "B1" }],
      });
      // poll - user replies
      mockClient.conversations.replies.mockResolvedValueOnce({
        ok: true,
        messages: [
          { ts: "1234.8000", text: "x", bot_id: "B1" },
          { ts: "1234.9000", text: "reply" },
        ],
      });

      const promise = responder.waitForReply("");
      await vi.advanceTimersByTimeAsync(3_000);
      const result = await promise;

      expect(result).toBe("reply");
      expect(mockClient.chat.postMessage).not.toHaveBeenCalled();
    });
  });
});

describe("parseChoice", () => {
  const options = ["Yes, run it", "No, cancel"];

  it("parses bare number", () => {
    expect(parseChoice("1", options)).toBe(0);
    expect(parseChoice("2", options)).toBe(1);
  });

  it("parses number with surrounding text", () => {
    expect(parseChoice("<@U0AGRL1EBMX> 1", options)).toBe(0);
  });

  it("matches option text case-insensitively", () => {
    expect(parseChoice("yes, run it", options)).toBe(0);
    expect(parseChoice("no, cancel", options)).toBe(1);
  });

  it("matches partial text (reply is substring of option)", () => {
    expect(parseChoice("yes", options)).toBe(0);
    expect(parseChoice("cancel", options)).toBe(1);
  });

  it("handles @mention prefix with natural text", () => {
    expect(parseChoice("<@U0AGRL1EBMX> yes, run it", options)).toBe(0);
    expect(parseChoice("<@U0AGRL1EBMX> no", options)).toBe(1);
  });

  it("returns -1 for unrecognized input", () => {
    expect(parseChoice("maybe", options)).toBe(-1);
    expect(parseChoice("0", options)).toBe(-1);
    expect(parseChoice("3", options)).toBe(-1);
  });
});
