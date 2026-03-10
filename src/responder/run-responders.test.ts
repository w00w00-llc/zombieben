import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Trigger } from "@/ingestor/trigger.js";
import { GithubNoopResponder } from "@/integrations/github/trigger-responder/index.js";
import { SlackNotifierResponder } from "@/integrations/slack/notifier-responder/index.js";
import { SlackResponder } from "@/integrations/slack/trigger-responder/index.js";
import type { RoleTaggedResponder, RunRespondersSnapshot } from "./types.js";
import {
  instantiateRunResponders,
  loadRunRespondersSnapshot,
  serializeRunResponders,
  writeRunRespondersSnapshot,
} from "./run-responders.js";

const TEST_DIR = path.join(os.tmpdir(), "zombieben-run-responders-test");

vi.mock("@/integrations/slack/web-client.js", () => ({
  createSlackWebClient: vi.fn(() => ({})),
}));

describe("run-responders", () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("serializes slack thread, slack channel, and github responders", () => {
    const trigger: Trigger = {
      source: "slack_webhook",
      id: "slack-C123-111.222",
      groupKeys: ["slack:C123:111.222"],
      timestamp: new Date().toISOString(),
      raw_payload: {
        channel: "C123",
        ts: "111.222",
        thread_ts: "111.000",
        user: "U1",
        text: "hello",
      },
    };

    const responders: RoleTaggedResponder[] = [
      {
        channelKey: "slack:C123",
        roles: new Set(["primary"]),
        responder: new SlackResponder({} as never, "C123", "111.000", "111.222"),
      },
      {
        channelKey: "slack:C999",
        roles: new Set(["notifier"]),
        responder: new SlackNotifierResponder({} as never, "C999"),
      },
      {
        channelKey: "github:w00w00-llc/ami",
        roles: new Set(["primary"]),
        responder: new GithubNoopResponder(),
      },
    ];

    const snapshot = serializeRunResponders(trigger, responders);
    expect(snapshot.version).toBe(1);
    expect(snapshot.triggerId).toBe(trigger.id);
    expect(snapshot.entries).toHaveLength(3);
    expect(snapshot.entries[0]).toMatchObject({
      kind: "slack_thread",
      channelKey: "slack:C123",
      roles: ["primary"],
      target: { channel: "C123", threadTs: "111.000", reactTs: "111.222" },
    });
    expect(snapshot.entries[1]).toMatchObject({
      kind: "slack_channel",
      channelKey: "slack:C999",
      roles: ["notifier"],
      target: { channel: "C999" },
    });
    expect(snapshot.entries[2]).toMatchObject({
      kind: "github_noop",
      channelKey: "github:w00w00-llc/ami",
      roles: ["primary"],
    });
  });

  it("writes and loads responders snapshot", () => {
    const runDir = path.join(TEST_DIR, "run-1");
    fs.mkdirSync(runDir, { recursive: true });
    const snapshot: RunRespondersSnapshot = {
      version: 1,
      createdAt: new Date().toISOString(),
      triggerId: "t-1",
      entries: [
        {
          kind: "slack_channel",
          channelKey: "slack:C999",
          roles: ["notifier"],
          target: { channel: "C999" },
        },
      ],
    };

    const file = writeRunRespondersSnapshot(runDir, snapshot);
    expect(fs.existsSync(file)).toBe(true);

    const loaded = loadRunRespondersSnapshot(runDir);
    expect(loaded).toEqual(snapshot);
  });

  it("instantiates role-tagged responders from snapshot", () => {
    const snapshot: RunRespondersSnapshot = {
      version: 1,
      createdAt: new Date().toISOString(),
      triggerId: "t-2",
      entries: [
        {
          kind: "slack_thread",
          channelKey: "slack:C123",
          roles: ["primary"],
          target: { channel: "C123", threadTs: "111.000", reactTs: "111.222" },
        },
        {
          kind: "github_noop",
          channelKey: "github:w00w00-llc/ami",
          roles: ["notifier"],
          target: {},
        },
      ],
    };

    const responders = instantiateRunResponders(snapshot);
    expect(responders).toHaveLength(2);
    expect(responders[0].roles).toEqual(new Set(["primary"]));
    expect(responders[1].roles).toEqual(new Set(["notifier"]));
    expect(responders[0].responder).toBeInstanceOf(SlackResponder);
    expect(responders[1].responder).toBeInstanceOf(GithubNoopResponder);
  });
});

