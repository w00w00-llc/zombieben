import { describe, it, expect } from "vitest";
import { normalizeSlackEvent, transformSlackEvent } from "./transform.js";

describe("transformSlackEvent", () => {
  it("transforms a valid event into a Trigger", () => {
    const result = transformSlackEvent({
      channel: "C123",
      ts: "1700000000.000000",
      user: "U456",
      text: "hello",
    });

    expect(result).not.toBeNull();
    expect(result!.source).toBe("slack_webhook");
    expect(result!.id).toBe("slack-C123-1700000000.000000");
    expect(result!.timestamp).toBe(new Date(1700000000000).toISOString());
    expect(result!.groupKeys).toEqual(["slack:C123:1700000000.000000"]);
    expect(result!.raw_payload).toEqual({
      channel: "C123",
      ts: "1700000000.000000",
      user: "U456",
      text: "hello",
    });
  });

  it("uses thread_ts for groupKeys when in a thread", () => {
    const result = transformSlackEvent({
      channel: "C123",
      ts: "1700000001.000000",
      thread_ts: "1700000000.000000",
      user: "U456",
      text: "reply in thread",
    });

    expect(result).not.toBeNull();
    expect(result!.groupKeys).toEqual(["slack:C123:1700000000.000000"]);
  });

  it("returns null for bot messages (bot_id)", () => {
    const result = transformSlackEvent({
      channel: "C123",
      ts: "1234.5678",
      user: "U456",
      text: "bot msg",
      bot_id: "B789",
    });
    expect(result).toBeNull();
  });

  it("returns null for bot_message subtype", () => {
    const result = transformSlackEvent({
      channel: "C123",
      ts: "1234.5678",
      user: "U456",
      text: "bot msg",
      subtype: "bot_message",
    });
    expect(result).toBeNull();
  });

  it("normalizes message_replied envelopes to the nested reply", () => {
    const result = normalizeSlackEvent({
      type: "message",
      subtype: "message_replied",
      channel: "C123",
      ts: "1700000000.000000",
      message: {
        channel: "IGNORED",
        ts: "1700000001.000000",
        thread_ts: "1700000000.000000",
        user: "U456",
        text: "<@U_BOT> reply in thread",
      },
    });

    expect(result).toEqual({
      channel: "C123",
      ts: "1700000001.000000",
      thread_ts: "1700000000.000000",
      user: "U456",
      text: "<@U_BOT> reply in thread",
    });
  });

  it("transforms message_replied envelopes using the nested reply ts", () => {
    const result = transformSlackEvent({
      type: "message",
      subtype: "message_replied",
      channel: "C123",
      ts: "1700000000.000000",
      message: {
        ts: "1700000001.000000",
        thread_ts: "1700000000.000000",
        user: "U456",
        text: "<@U_BOT> reply in thread",
      },
    });

    expect(result).not.toBeNull();
    expect(result!.id).toBe("slack-C123-1700000001.000000");
    expect(result!.groupKeys).toEqual(["slack:C123:1700000000.000000"]);
    expect(result!.raw_payload).toEqual({
      channel: "C123",
      ts: "1700000001.000000",
      thread_ts: "1700000000.000000",
      user: "U456",
      text: "<@U_BOT> reply in thread",
    });
  });

  it("generates deterministic ID from channel and ts", () => {
    const a = transformSlackEvent({
      channel: "C123",
      ts: "1234.5678",
      user: "U456",
      text: "first",
    });
    const b = transformSlackEvent({
      channel: "C123",
      ts: "1234.5678",
      user: "U789",
      text: "second",
    });
    expect(a!.id).toBe(b!.id);
  });
});
