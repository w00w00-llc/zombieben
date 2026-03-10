import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TriggerResponder } from "@/responder/responder.js";
import {
  ERROR_EMOJI,
  LOADING_EMOJI,
  markCompletedReaction,
  markFailedReaction,
  setLoadingReaction,
  SUCCESS_EMOJI,
  WARNING_EMOJI,
} from "./reaction-utils.js";

vi.mock("@/util/logger.js", () => ({
  log: {
    warn: vi.fn(),
  },
}));

function makeResponder(): TriggerResponder {
  return {
    send: vi.fn().mockResolvedValue({ id: "1" }),
    sendOutcome: vi.fn().mockResolvedValue({ id: "1" }),
    edit: vi.fn().mockResolvedValue(undefined),
    react: vi.fn().mockResolvedValue(undefined),
    unreact: vi.fn().mockResolvedValue(undefined),
  };
}

describe("reaction-utils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds the loading reaction", async () => {
    const responder = makeResponder();

    await setLoadingReaction(responder, "slack-C123-1");

    expect(responder.react).toHaveBeenCalledWith(LOADING_EMOJI);
  });

  it("replaces loading with a success reaction", async () => {
    const responder = makeResponder();

    await markCompletedReaction(responder, "slack-C123-1");

    expect(responder.unreact).toHaveBeenCalledWith(LOADING_EMOJI);
    expect(responder.react).toHaveBeenCalledWith(SUCCESS_EMOJI);
  });

  it("uses a warning reaction when processing completed with an error", async () => {
    const responder = makeResponder();

    await markCompletedReaction(responder, "slack-C123-1", {
      outcomeError: "Failed to start workflow",
    });

    expect(responder.unreact).toHaveBeenCalledWith(LOADING_EMOJI);
    expect(responder.react).toHaveBeenCalledWith(WARNING_EMOJI);
  });

  it("replaces loading with an error reaction on failure", async () => {
    const responder = makeResponder();

    await markFailedReaction(responder, "slack-C123-1");

    expect(responder.unreact).toHaveBeenCalledWith(LOADING_EMOJI);
    expect(responder.react).toHaveBeenCalledWith(ERROR_EMOJI);
  });

  it("swallows reaction failures", async () => {
    const responder = makeResponder();
    vi.mocked(responder.react).mockRejectedValueOnce(new Error("missing_scope"));

    await expect(setLoadingReaction(responder, "slack-C123-1")).resolves.toBeUndefined();
  });
});
