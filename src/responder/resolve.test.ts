import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Trigger } from "@/ingestor/trigger.js";
import type { TriggerResponder } from "@/trigger/responder.js";

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

vi.mock("../integrations/registry.js", () => ({
  getPlugin: vi.fn(),
}));

vi.mock("../integrations/slack/notifier-responder.js", () => ({
  createSlackNotifierResponder: vi.fn(),
}));

import { resolveResponders } from "./resolve.js";
import { getPlugin } from "@/integrations/registry.js";
import { createSlackNotifierResponder } from "@/integrations/slack/notifier-responder.js";

const mockedGetPlugin = vi.mocked(getPlugin);
const mockedCreateNotifier = vi.mocked(createSlackNotifierResponder);

function makeTrigger(overrides: Partial<Trigger> = {}): Trigger {
  return {
    source: "slack_webhook",
    id: "slack-C123-1234.5678",
    timestamp: "2026-03-05T00:00:00Z",
    raw_payload: { channel: "C123", ts: "1234.5678", user: "U456", text: "hello" },
    ...overrides,
  };
}

describe("resolveResponders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetPlugin.mockReturnValue(undefined);
    mockedCreateNotifier.mockReturnValue(null);
  });

  it("returns primary responder for slack trigger", () => {
    mockedGetPlugin.mockReturnValue({
      id: "slack",
      name: "Slack",
      responder: {
        createResponder: () => mockResponder,
        getChannelKey: () => "slack:C123",
      },
    });

    const result = resolveResponders(makeTrigger());

    expect(result.responders).toHaveLength(1);
    expect(result.responders[0].channelKey).toBe("slack:C123");
    expect(result.responders[0].roles).toEqual(new Set(["primary"]));
    expect(result.responders[0].responder).toBe(mockResponder);
  });

  it("adds notifier when notification channel is configured", () => {
    mockedGetPlugin.mockReturnValue({
      id: "slack",
      name: "Slack",
      responder: {
        createResponder: () => mockResponder,
        getChannelKey: () => "slack:C123",
      },
    });
    mockedCreateNotifier.mockReturnValue({
      channelKey: "slack:C999",
      responder: mockNotifierResponder,
    });

    const result = resolveResponders(makeTrigger());

    expect(result.responders).toHaveLength(2);
    expect(result.responders[0].channelKey).toBe("slack:C123");
    expect(result.responders[0].roles).toEqual(new Set(["primary"]));
    expect(result.responders[1].channelKey).toBe("slack:C999");
    expect(result.responders[1].roles).toEqual(new Set(["notifier"]));
  });

  it("deduplicates when primary and notifier target the same channel", () => {
    mockedGetPlugin.mockReturnValue({
      id: "slack",
      name: "Slack",
      responder: {
        createResponder: () => mockResponder,
        getChannelKey: () => "slack:C123",
      },
    });
    mockedCreateNotifier.mockReturnValue({
      channelKey: "slack:C123",
      responder: mockNotifierResponder,
    });

    const result = resolveResponders(makeTrigger());

    expect(result.responders).toHaveLength(1);
    expect(result.responders[0].channelKey).toBe("slack:C123");
    expect(result.responders[0].roles).toEqual(new Set(["primary", "notifier"]));
    // Keeps the primary responder (first one added)
    expect(result.responders[0].responder).toBe(mockResponder);
  });

  it("returns only notifier when plugin has no responder adapter", () => {
    mockedGetPlugin.mockReturnValue({
      id: "slack",
      name: "Slack",
    });
    mockedCreateNotifier.mockReturnValue({
      channelKey: "slack:C999",
      responder: mockNotifierResponder,
    });

    const result = resolveResponders(makeTrigger());

    expect(result.responders).toHaveLength(1);
    expect(result.responders[0].channelKey).toBe("slack:C999");
    expect(result.responders[0].roles).toEqual(new Set(["notifier"]));
  });

  it("returns empty responders when nothing is configured", () => {
    const result = resolveResponders(makeTrigger({ source: "unknown_source" }));

    expect(result.responders).toHaveLength(0);
    expect(result.trigger.source).toBe("unknown_source");
  });
});
