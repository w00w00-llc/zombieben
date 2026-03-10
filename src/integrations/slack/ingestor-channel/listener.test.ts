import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../util/keys.js", () => ({
  getIntegrationKeys: vi.fn(),
}));

vi.mock("../../../util/logger.js", () => ({
  log: { info: vi.fn(), error: vi.fn() },
}));

vi.mock("../web-client.js", () => ({
  createSlackWebClient: vi.fn().mockReturnValue({
    auth: {
      test: vi.fn().mockResolvedValue({ user_id: "U_BOT" }),
    },
  }),
}));

vi.mock("./context.js", () => ({
  fetchSlackThreadContext: vi.fn().mockResolvedValue([]),
}));

const registeredHandlers = new Map<string, (args: { event: unknown; ack: () => Promise<void> }) => Promise<void>>();
const mockSocketStart = vi.fn().mockResolvedValue(undefined);
const mockSocketDisconnect = vi.fn().mockResolvedValue(undefined);

vi.mock("@slack/socket-mode", () => ({
  SocketModeClient: class {
    constructor() {}
    start = mockSocketStart;
    disconnect = mockSocketDisconnect;
    on(event: string, handler: (args: { event: unknown; ack: () => Promise<void> }) => Promise<void>) {
      if (event === "message" || event === "app_mention") {
        registeredHandlers.set(event, handler);
      }
    }
  },
}));

import { SlackSocketListener } from "./listener.js";
import { fetchSlackThreadContext } from "./context.js";
import type { Ingestor } from "@/ingestor/ingestor.js";

const mockFetchContext = vi.mocked(fetchSlackThreadContext);

function createMockIngestor(): Ingestor & {
  submit: ReturnType<typeof vi.fn>;
} {
  return {
    submit: vi.fn(),
  } as unknown as Ingestor & { submit: ReturnType<typeof vi.fn> };
}

describe("SlackSocketListener", () => {
  let listener: SlackSocketListener;
  let mockIngestor: ReturnType<typeof createMockIngestor>;

  beforeEach(async () => {
    vi.clearAllMocks();
    registeredHandlers.clear();
    mockIngestor = createMockIngestor();
    listener = new SlackSocketListener("xapp-test-token", mockIngestor);
    await listener.start();
  });

  it("starts the socket client", () => {
    expect(mockSocketStart).toHaveBeenCalledOnce();
  });

  it("stops the socket client", async () => {
    await listener.stop();
    expect(mockSocketDisconnect).toHaveBeenCalledOnce();
  });

  it("calls ingestor.submit() when message mentions the bot", async () => {
    const registeredHandler = registeredHandlers.get("message");
    expect(registeredHandler).toBeDefined();

    const ack = vi.fn().mockResolvedValue(undefined);
    await registeredHandler!({
      event: {
        type: "message",
        channel: "C123",
        ts: "1234.5678",
        user: "U456",
        text: "<@U_BOT> hello bot",
      },
      ack,
    });

    expect(ack).toHaveBeenCalledOnce();

    await vi.waitFor(() => {
      expect(mockIngestor.submit).toHaveBeenCalledOnce();
    });

    const trigger = mockIngestor.submit.mock.calls[0][0];
    expect(trigger.source).toBe("slack_webhook");
    expect(trigger.id).toBe("slack-C123-1234.5678");
  });

  it("ignores messages that don't mention the bot", async () => {
    const registeredHandler = registeredHandlers.get("message");
    const ack = vi.fn().mockResolvedValue(undefined);
    await registeredHandler!({
      event: {
        type: "message",
        channel: "C123",
        ts: "1234.5678",
        user: "U456",
        text: "just a regular message",
      },
      ack,
    });

    expect(ack).toHaveBeenCalledOnce();
    await new Promise((r) => setTimeout(r, 10));
    expect(mockIngestor.submit).not.toHaveBeenCalled();
  });

  it("filters bot messages via transform (returns null)", async () => {
    const registeredHandler = registeredHandlers.get("message");
    const ack = vi.fn().mockResolvedValue(undefined);
    await registeredHandler!({
      event: {
        type: "message",
        channel: "C123",
        ts: "1234.5678",
        user: "U456",
        text: "<@U_BOT> bot echo",
        bot_id: "B789",
      },
      ack,
    });

    expect(ack).toHaveBeenCalledOnce();
    await new Promise((r) => setTimeout(r, 10));
    expect(mockIngestor.submit).not.toHaveBeenCalled();
  });

  it("populates trigger.context for threaded messages", async () => {
    const registeredHandler = registeredHandlers.get("message");
    const threadContext = [
      { user: "U1", ts: "1000.0", text: "earlier message" },
    ];
    mockFetchContext.mockResolvedValue(threadContext);

    const ack = vi.fn().mockResolvedValue(undefined);
    await registeredHandler!({
      event: {
        type: "message",
        channel: "C123",
        ts: "1001.0",
        thread_ts: "1000.0",
        user: "U456",
        text: "<@U_BOT> reply in thread",
      },
      ack,
    });

    await vi.waitFor(() => {
      expect(mockIngestor.submit).toHaveBeenCalledOnce();
    });

    expect(mockFetchContext).toHaveBeenCalledWith("C123", "1000.0");
    const trigger = mockIngestor.submit.mock.calls[0][0];
    expect(trigger.context).toEqual({ allThreadMessages: threadContext });
  });

  it("leaves trigger.context undefined for top-level messages", async () => {
    const registeredHandler = registeredHandlers.get("message");
    const ack = vi.fn().mockResolvedValue(undefined);
    await registeredHandler!({
      event: {
        type: "message",
        channel: "C123",
        ts: "1234.5678",
        user: "U456",
        text: "<@U_BOT> top-level message",
      },
      ack,
    });

    await vi.waitFor(() => {
      expect(mockIngestor.submit).toHaveBeenCalledOnce();
    });

    expect(mockFetchContext).not.toHaveBeenCalled();
    const trigger = mockIngestor.submit.mock.calls[0][0];
    expect(trigger.context).toBeUndefined();
  });

  it("calls ingestor.submit() for app_mention events", async () => {
    const registeredHandler = registeredHandlers.get("app_mention");
    expect(registeredHandler).toBeDefined();

    const ack = vi.fn().mockResolvedValue(undefined);
    await registeredHandler!({
      event: {
        type: "app_mention",
        channel: "C123",
        ts: "1234.5678",
        user: "U456",
        text: "hello bot",
      },
      ack,
    });

    expect(ack).toHaveBeenCalledOnce();

    await vi.waitFor(() => {
      expect(mockIngestor.submit).toHaveBeenCalledOnce();
    });

    const trigger = mockIngestor.submit.mock.calls[0][0];
    expect(trigger.source).toBe("slack_webhook");
    expect(trigger.id).toBe("slack-C123-1234.5678");
  });
});
