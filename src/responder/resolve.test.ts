import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Trigger } from "@/ingestor/trigger.js";
import type { TriggerResponder } from "@/responder/responder.js";
import type { IngestorChannel } from "@/ingestor/ingestor-channel.js";

const mockResponder: TriggerResponder = {
  send: vi.fn(),
  promptChoice: vi.fn(),
  waitForReply: vi.fn(),
};

const mockNotifierResponder: TriggerResponder = {
  send: vi.fn(),
  promptChoice: vi.fn(),
  waitForReply: vi.fn(),
};

vi.mock("../integrations/slack/notifier-responder/index.js", () => ({
  createSlackNotifierResponder: vi.fn(),
}));

import { resolveResponders } from "./resolve.js";
import { createSlackNotifierResponder } from "@/integrations/slack/notifier-responder/index.js";

const mockedCreateNotifier = vi.mocked(createSlackNotifierResponder);

function makeTrigger(overrides: Partial<Trigger> = {}): Trigger {
  return {
    source: "slack_webhook",
    id: "slack-C123-1234.5678",
    groupKeys: ["slack:C123:1234.5678"],
    timestamp: "2026-03-05T00:00:00Z",
    raw_payload: { channel: "C123", ts: "1234.5678", user: "U456", text: "hello" },
    ...overrides,
  };
}

function makeSlackChannel(overrides: Partial<IngestorChannel> = {}): IngestorChannel {
  return {
    name: "slack",
    isEnabled: () => true,
    startListener: async () => {},
    stopListener: async () => {},
    getPrimaryResponder: () => mockResponder,
    getChannelKey: () => "slack:C123",
    ...overrides,
  };
}

describe("resolveResponders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedCreateNotifier.mockReturnValue(null);
  });

  it("returns primary responder for slack trigger", () => {
    const channels = [makeSlackChannel()];
    const result = resolveResponders(makeTrigger(), channels);

    expect(result.responders).toHaveLength(1);
    expect(result.responders[0].channelKey).toBe("slack:C123");
    expect(result.responders[0].roles).toEqual(new Set(["primary"]));
    expect(result.responders[0].responder).toBe(mockResponder);
  });

  it("adds notifier when notification channel is configured", () => {
    const channels = [makeSlackChannel()];
    mockedCreateNotifier.mockReturnValue({
      channelKey: "slack:C999",
      responder: mockNotifierResponder,
    });

    const result = resolveResponders(makeTrigger(), channels);

    expect(result.responders).toHaveLength(2);
    expect(result.responders[0].channelKey).toBe("slack:C123");
    expect(result.responders[0].roles).toEqual(new Set(["primary"]));
    expect(result.responders[1].channelKey).toBe("slack:C999");
    expect(result.responders[1].roles).toEqual(new Set(["notifier"]));
  });

  it("deduplicates when primary and notifier target the same channel", () => {
    const channels = [makeSlackChannel()];
    mockedCreateNotifier.mockReturnValue({
      channelKey: "slack:C123",
      responder: mockNotifierResponder,
    });

    const result = resolveResponders(makeTrigger(), channels);

    expect(result.responders).toHaveLength(1);
    expect(result.responders[0].channelKey).toBe("slack:C123");
    expect(result.responders[0].roles).toEqual(new Set(["primary", "notifier"]));
    // Keeps the primary responder (first one added)
    expect(result.responders[0].responder).toBe(mockResponder);
  });

  it("returns only notifier when channel has no matching name", () => {
    mockedCreateNotifier.mockReturnValue({
      channelKey: "slack:C999",
      responder: mockNotifierResponder,
    });

    const result = resolveResponders(makeTrigger(), []);

    expect(result.responders).toHaveLength(1);
    expect(result.responders[0].channelKey).toBe("slack:C999");
    expect(result.responders[0].roles).toEqual(new Set(["notifier"]));
  });

  it("returns empty responders when nothing is configured", () => {
    const result = resolveResponders(makeTrigger({ source: "unknown_source" }), []);

    expect(result.responders).toHaveLength(0);
    expect(result.trigger.source).toBe("unknown_source");
  });
});
