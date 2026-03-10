import fs from "node:fs";
import path from "node:path";
import type { Trigger } from "@/ingestor/trigger.js";
import { GithubNoopResponder } from "@/integrations/github/trigger-responder/index.js";
import { createSlackWebClient } from "@/integrations/slack/web-client.js";
import { isSlackTrigger } from "@/integrations/slack/ingestor-channel/types.js";
import { SlackNotifierResponder } from "@/integrations/slack/notifier-responder/index.js";
import { SlackResponder } from "@/integrations/slack/trigger-responder/index.js";
import { log } from "@/util/logger.js";
import type {
  RoleTaggedResponder,
  ResponderRole,
  RunRespondersSnapshot,
  SerializedResponder,
} from "./types.js";

const SNAPSHOT_VERSION = 1;
const RESPONDERS_FILENAME = "responders.json";

export function serializeRunResponders(
  trigger: Trigger,
  responders: readonly RoleTaggedResponder[],
): RunRespondersSnapshot {
  const entries: SerializedResponder[] = [];
  for (const entry of responders) {
    const serialized = serializeResponderEntry(trigger, entry);
    if (serialized) {
      entries.push(serialized);
    } else {
      log.warn(
        `Skipping unserializable responder for trigger ${trigger.id} (channelKey=${entry.channelKey})`,
      );
    }
  }

  return {
    version: SNAPSHOT_VERSION,
    createdAt: new Date().toISOString(),
    triggerId: trigger.id,
    entries,
  };
}

export function writeRunRespondersSnapshot(
  runDirectory: string,
  snapshot: RunRespondersSnapshot,
): string {
  const file = respondersSnapshotPath(runDirectory);
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2));
  return file;
}

export function loadRunRespondersSnapshot(
  runDirectory: string,
): RunRespondersSnapshot | null {
  const file = respondersSnapshotPath(runDirectory);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
    return parseSnapshot(raw);
  } catch (err) {
    log.warn(
      `Failed to read responders snapshot at ${file}: ${(err as Error).message}`,
    );
    return null;
  }
}

export function instantiateRunResponders(
  snapshot: RunRespondersSnapshot,
): RoleTaggedResponder[] {
  const instantiated: RoleTaggedResponder[] = [];

  for (const entry of snapshot.entries) {
    try {
      const responder = instantiateResponder(entry);
      instantiated.push({
        channelKey: entry.channelKey,
        roles: new Set(entry.roles),
        responder,
      });
    } catch (err) {
      log.warn(
        `Failed to instantiate responder kind="${entry.kind}" channelKey="${entry.channelKey}": ${(err as Error).message}`,
      );
    }
  }

  return instantiated;
}

function respondersSnapshotPath(runDirectory: string): string {
  return path.join(runDirectory, RESPONDERS_FILENAME);
}

function serializeResponderEntry(
  trigger: Trigger,
  entry: RoleTaggedResponder,
): SerializedResponder | null {
  const roles = [...entry.roles];

  if (entry.responder instanceof SlackResponder) {
    if (!isSlackTrigger(trigger)) return null;
    const channel = trigger.raw_payload.channel;
    const threadTs = trigger.raw_payload.thread_ts ?? trigger.raw_payload.ts;
    const reactTs = trigger.raw_payload.ts;
    if (!channel || !threadTs || !reactTs) return null;

    return {
      kind: "slack_thread",
      channelKey: entry.channelKey,
      roles,
      target: { channel, threadTs, reactTs },
    };
  }

  if (entry.responder instanceof SlackNotifierResponder) {
    const channel = parseSlackChannelFromChannelKey(entry.channelKey);
    if (!channel) return null;

    return {
      kind: "slack_channel",
      channelKey: entry.channelKey,
      roles,
      target: { channel },
    };
  }

  if (entry.responder instanceof GithubNoopResponder) {
    return {
      kind: "github_noop",
      channelKey: entry.channelKey,
      roles,
      target: {},
    };
  }

  return null;
}

function parseSlackChannelFromChannelKey(channelKey: string): string | null {
  if (!channelKey.startsWith("slack:")) return null;
  const channel = channelKey.slice("slack:".length).trim();
  return channel.length > 0 ? channel : null;
}

function parseSnapshot(value: unknown): RunRespondersSnapshot | null {
  if (!isRecord(value)) return null;
  if (value.version !== SNAPSHOT_VERSION) return null;
  if (typeof value.createdAt !== "string") return null;
  if (typeof value.triggerId !== "string") return null;
  if (!Array.isArray(value.entries)) return null;

  const entries: SerializedResponder[] = [];
  for (const e of value.entries) {
    const parsed = parseSerializedResponder(e);
    if (!parsed) return null;
    entries.push(parsed);
  }

  return {
    version: SNAPSHOT_VERSION,
    createdAt: value.createdAt,
    triggerId: value.triggerId,
    entries,
  };
}

function parseSerializedResponder(value: unknown): SerializedResponder | null {
  if (!isRecord(value)) return null;
  if (
    value.kind !== "slack_thread"
    && value.kind !== "slack_channel"
    && value.kind !== "github_noop"
  ) {
    return null;
  }
  if (typeof value.channelKey !== "string") return null;
  if (!Array.isArray(value.roles)) return null;
  const roles = value.roles.filter(isResponderRole);
  if (roles.length !== value.roles.length) return null;

  if (value.kind === "slack_thread") {
    if (!isRecord(value.target)) return null;
    if (
      typeof value.target.channel !== "string"
      || typeof value.target.threadTs !== "string"
      || typeof value.target.reactTs !== "string"
    ) {
      return null;
    }
    return {
      kind: "slack_thread",
      channelKey: value.channelKey,
      roles,
      target: {
        channel: value.target.channel,
        threadTs: value.target.threadTs,
        reactTs: value.target.reactTs,
      },
    };
  }

  if (value.kind === "slack_channel") {
    if (!isRecord(value.target)) return null;
    if (typeof value.target.channel !== "string") return null;
    return {
      kind: "slack_channel",
      channelKey: value.channelKey,
      roles,
      target: { channel: value.target.channel },
    };
  }

  if (!isRecord(value.target)) return null;
  return {
    kind: "github_noop",
    channelKey: value.channelKey,
    roles,
    target: {},
  };
}

function instantiateResponder(entry: SerializedResponder): RoleTaggedResponder["responder"] {
  switch (entry.kind) {
    case "slack_thread": {
      const target = entry.target as Extract<SerializedResponder, { kind: "slack_thread" }>["target"];
      return new SlackResponder(
        createSlackWebClient(),
        target.channel,
        target.threadTs,
        target.reactTs,
      );
    }
    case "slack_channel": {
      const target = entry.target as Extract<SerializedResponder, { kind: "slack_channel" }>["target"];
      return new SlackNotifierResponder(
        createSlackWebClient(),
        target.channel,
      );
    }
    case "github_noop":
      return new GithubNoopResponder();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isResponderRole(value: unknown): value is ResponderRole {
  return value === "primary" || value === "notifier";
}
