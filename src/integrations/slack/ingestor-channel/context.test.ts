import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../web-client.js", () => ({
  createSlackWebClient: vi.fn(),
}));

import { createSlackWebClient } from "../web-client.js";
import { fetchSlackThreadContext } from "./context.js";

const mockCreateSlackWebClient = vi.mocked(createSlackWebClient);

describe("fetchSlackThreadContext", () => {
  const mockReplies = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSlackWebClient.mockReturnValue({
      conversations: { replies: mockReplies },
    } as never);
  });

  it("maps thread replies to { user, ts, text }", async () => {
    mockReplies.mockResolvedValue({
      messages: [
        { user: "U1", ts: "1000.0", text: "first message" },
        { user: "U2", ts: "1001.0", text: "second message" },
        { user: "U3", ts: "1002.0", text: "triggering message" },
      ],
    });

    const result = await fetchSlackThreadContext("C123", "1000.0");

    expect(result).toEqual([
      { user: "U1", ts: "1000.0", text: "first message" },
      { user: "U2", ts: "1001.0", text: "second message" },
      { user: "U3", ts: "1002.0", text: "triggering message" },
    ]);
  });

  it("returns all messages including the last one", async () => {
    mockReplies.mockResolvedValue({
      messages: [
        { user: "U1", ts: "1000.0", text: "parent" },
        { user: "U2", ts: "1001.0", text: "reply" },
      ],
    });

    const result = await fetchSlackThreadContext("C123", "1000.0");

    expect(result).toHaveLength(2);
    expect(result[1].text).toBe("reply");
  });

  it("returns empty array when messages is undefined", async () => {
    mockReplies.mockResolvedValue({ messages: undefined });

    const result = await fetchSlackThreadContext("C123", "1000.0");

    expect(result).toEqual([]);
  });

  it("calls conversations.replies with correct params", async () => {
    mockReplies.mockResolvedValue({ messages: [{ user: "U1", ts: "1000.0", text: "msg" }] });

    await fetchSlackThreadContext("C_CHAN", "9999.0");

    expect(mockReplies).toHaveBeenCalledWith({
      channel: "C_CHAN",
      ts: "9999.0",
    });
  });
});
