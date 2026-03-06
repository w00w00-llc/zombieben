import { describe, it, expect, vi, beforeEach } from "vitest";
import { Ingestor } from "./ingestor.js";
import { InMemoryDedupStore } from "./dedup-store.js";
import type { ResponderSet } from "@/responder/types.js";
import type { Trigger } from "./trigger.js";

vi.mock("../util/logger.js", () => ({
  log: { info: vi.fn(), error: vi.fn() },
}));

vi.mock("../responder/resolve.js", () => ({
  resolveResponders: vi.fn((trigger: Trigger) => ({ trigger, responders: [] })),
}));

function makeTrigger(id = "slack-C123-1234.5678"): Trigger {
  return {
    source: "slack_webhook",
    id,
    groupKeys: ["slack:C123:1234.5678"],
    timestamp: new Date().toISOString(),
    raw_payload: { channel: "C123", ts: "1234.5678", user: "U456", text: "hello" },
  };
}

describe("Ingestor", () => {
  let dedupStore: InMemoryDedupStore;
  let onTrigger: ReturnType<typeof vi.fn>;
  let ingestor: Ingestor;

  beforeEach(() => {
    vi.clearAllMocks();
    dedupStore = new InMemoryDedupStore();
    onTrigger = vi.fn().mockResolvedValue(undefined);
    ingestor = new Ingestor({
      dedupStore,
      channels: [],
      onTrigger: onTrigger as unknown as (result: ResponderSet) => Promise<void>,
    });
  });

  it("calls onTrigger with ResponderSet", async () => {
    await ingestor.submit(makeTrigger());

    expect(onTrigger).toHaveBeenCalledOnce();
    const result = onTrigger.mock.calls[0][0] as ResponderSet;
    expect(result.trigger.source).toBe("slack_webhook");
    expect(result.trigger.id).toBe("slack-C123-1234.5678");
  });

  it("deduplicates triggers by id", async () => {
    const trigger = makeTrigger();
    await ingestor.submit(trigger);
    await ingestor.submit(trigger);

    expect(onTrigger).toHaveBeenCalledOnce();
  });

  it("adds trigger ID to dedup store", async () => {
    await ingestor.submit(makeTrigger());
    expect(dedupStore.has("slack-C123-1234.5678")).toBe(true);
  });

  it("allows different trigger IDs through", async () => {
    await ingestor.submit(makeTrigger("id-1"));
    await ingestor.submit(makeTrigger("id-2"));
    expect(onTrigger).toHaveBeenCalledTimes(2);
  });
});
