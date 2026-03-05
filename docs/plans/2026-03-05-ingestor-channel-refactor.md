# Ingestor Channel Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the ingestor subsystem so each integration owns its transform + listener in a self-contained `IngestorChannel`, and the runner starts all enabled channels generically.

**Architecture:** Each channel lives under `src/ingestor/channels/<name>/` and implements the `IngestorChannel` interface. The `Ingestor` class simplifies to `submit(trigger)` — channels own their transforms and call submit directly. The runner iterates enabled channels instead of hardcoding Slack.

**Tech Stack:** TypeScript, Vitest, @slack/socket-mode, @slack/web-api

---

### Task 1: Create new type files and IngestorChannel interface

**Files:**
- Create: `src/ingestor/trigger.ts`
- Create: `src/ingestor/ingestor-channel.ts`

**Step 1: Create `src/ingestor/trigger.ts`**

```ts
export interface Trigger {
  source: string;
  id: string;
  timestamp: string;
  raw_payload: unknown;
}
```

**Step 2: Create `src/ingestor/ingestor-channel.ts`**

```ts
export interface IngestorChannel {
  readonly name: string;
  isEnabled(): boolean;
  startListener(): Promise<void>;
  stopListener(): Promise<void>;
}
```

**Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS (new files, nothing references them yet)

**Step 4: Commit**

```
feat: add Trigger and IngestorChannel type files
```

---

### Task 2: Refactor Ingestor to use `submit(trigger)`

**Files:**
- Modify: `src/ingestor/ingestor.ts`
- Modify: `src/ingestor/ingestor.test.ts`

**Step 1: Update `src/ingestor/ingestor.ts`**

Replace contents with:

```ts
import type { Trigger } from "./trigger.js";
import type { DedupStore } from "./dedup-store.js";
import type { ResponderSet } from "../responder/types.js";
import { resolveResponders } from "../responder/resolve.js";
import { log } from "../util/logger.js";

export interface IngestorOptions {
  dedupStore: DedupStore;
  onTrigger: (result: ResponderSet) => Promise<void>;
}

export class Ingestor {
  private dedupStore: DedupStore;
  private onTrigger: (result: ResponderSet) => Promise<void>;

  constructor(opts: IngestorOptions) {
    this.dedupStore = opts.dedupStore;
    this.onTrigger = opts.onTrigger;
  }

  async submit(trigger: Trigger): Promise<void> {
    if (this.dedupStore.has(trigger.id)) {
      log.info(`Duplicate trigger skipped: ${trigger.id}`);
      return;
    }

    this.dedupStore.add(trigger.id);
    const result = resolveResponders(trigger);
    await this.onTrigger(result);
  }
}
```

**Step 2: Update `src/ingestor/ingestor.test.ts`**

Replace contents with:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Ingestor } from "./ingestor.js";
import { InMemoryDedupStore } from "./dedup-store.js";
import type { ResponderSet } from "../responder/types.js";
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
```

**Step 3: Run tests**

Run: `npx vitest run src/ingestor/ingestor.test.ts`
Expected: PASS (4 tests)

**Step 4: Commit**

```
refactor: simplify Ingestor to submit(trigger) API
```

---

### Task 3: Create Slack channel

**Files:**
- Create: `src/ingestor/channels/slack/transform.ts`
- Create: `src/ingestor/channels/slack/transform.test.ts`
- Create: `src/ingestor/channels/slack/listener.ts`
- Create: `src/ingestor/channels/slack/listener.test.ts`
- Create: `src/ingestor/channels/slack/index.ts`

**Step 1: Create `src/ingestor/channels/slack/transform.ts`**

Move the transform logic from `src/ingestor/sources/slack-webhook.ts`:

```ts
import type { Trigger } from "../../trigger.js";

interface SlackEvent {
  channel: string;
  ts: string;
  thread_ts?: string;
  user: string;
  text: string;
  bot_id?: string;
  subtype?: string;
}

export function transformSlackEvent(raw: unknown): Trigger | null {
  const event = raw as SlackEvent;

  if (event.bot_id || event.subtype === "bot_message") return null;

  return {
    source: "slack_webhook",
    id: `slack-${event.channel}-${event.ts}`,
    timestamp: new Date(parseFloat(event.ts) * 1000).toISOString(),
    raw_payload: event,
  };
}
```

**Step 2: Create `src/ingestor/channels/slack/transform.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { transformSlackEvent } from "./transform.js";

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
    expect(result!.raw_payload).toEqual({
      channel: "C123",
      ts: "1700000000.000000",
      user: "U456",
      text: "hello",
    });
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
```

**Step 3: Create `src/ingestor/channels/slack/listener.ts`**

Move from `src/ingestor/listeners/slack.ts`. Key change: listener calls `transformSlackEvent()` then `ingestor.submit()` instead of `ingestor.ingest()`.

```ts
import { SocketModeClient } from "@slack/socket-mode";
import { getIntegrationKeys } from "../../../util/keys.js";
import { createSlackWebClient } from "../../../integrations/slack/index.js";
import type { Ingestor } from "../../ingestor.js";
import { transformSlackEvent } from "./transform.js";
import { log } from "../../../util/logger.js";

interface MessageEvent {
  type: string;
  channel: string;
  ts: string;
  thread_ts?: string;
  user: string;
  text: string;
  bot_id?: string;
  subtype?: string;
}

export class SlackSocketListener {
  private socketClient: SocketModeClient;
  private ingestor: Ingestor;
  private botUserId: string | null = null;

  constructor(appToken: string, ingestor: Ingestor) {
    this.socketClient = new SocketModeClient({ appToken });
    this.ingestor = ingestor;

    this.socketClient.on("message", async ({ event, ack }) => {
      await ack();
      this.handleMessage(event as MessageEvent);
    });
  }

  async start(): Promise<void> {
    try {
      const client = createSlackWebClient();
      const auth = await client.auth.test();
      this.botUserId = auth.user_id as string;
      log.info(`Slack bot user ID: ${this.botUserId}`);
    } catch (err) {
      log.error(`Failed to resolve bot user ID: ${(err as Error).message}`);
    }

    await this.socketClient.start();
    log.info("Slack Socket Mode listener started.");
  }

  async stop(): Promise<void> {
    await this.socketClient.disconnect();
    log.info("Slack Socket Mode listener stopped.");
  }

  private handleMessage(event: MessageEvent): void {
    if (!this.botUserId || !event.text?.includes(`<@${this.botUserId}>`)) {
      return;
    }

    log.info(
      `Slack mention from ${event.user} in ${event.channel}: "${event.text.slice(0, 80)}"`,
    );

    const trigger = transformSlackEvent(event);
    if (!trigger) return;

    this.ingestor.submit(trigger).catch((err) => {
      log.error(`Ingestion error: ${(err as Error).message}`);
    });
  }
}
```

**Step 4: Create `src/ingestor/channels/slack/listener.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../util/keys.js", () => ({
  getIntegrationKeys: vi.fn(),
}));

vi.mock("../../../util/logger.js", () => ({
  log: { info: vi.fn(), error: vi.fn() },
}));

vi.mock("../../../integrations/slack/index.js", () => ({
  createSlackWebClient: vi.fn().mockReturnValue({
    auth: {
      test: vi.fn().mockResolvedValue({ user_id: "U_BOT" }),
    },
  }),
}));

let registeredHandler: ((args: { event: unknown; ack: () => Promise<void> }) => Promise<void>) | null = null;
const mockSocketStart = vi.fn().mockResolvedValue(undefined);
const mockSocketDisconnect = vi.fn().mockResolvedValue(undefined);

vi.mock("@slack/socket-mode", () => ({
  SocketModeClient: class {
    constructor() {}
    start = mockSocketStart;
    disconnect = mockSocketDisconnect;
    on(event: string, handler: (args: { event: unknown; ack: () => Promise<void> }) => Promise<void>) {
      if (event === "message") {
        registeredHandler = handler;
      }
    }
  },
}));

import { SlackSocketListener } from "./listener.js";
import type { Ingestor } from "../../ingestor.js";

function createMockIngestor(): Ingestor & {
  submit: ReturnType<typeof vi.fn>;
} {
  return {
    submit: vi.fn().mockResolvedValue(undefined),
  } as unknown as Ingestor & { submit: ReturnType<typeof vi.fn> };
}

describe("SlackSocketListener", () => {
  let listener: SlackSocketListener;
  let mockIngestor: ReturnType<typeof createMockIngestor>;

  beforeEach(async () => {
    vi.clearAllMocks();
    registeredHandler = null;
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
    expect(registeredHandler).not.toBeNull();

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
});
```

**Step 5: Create `src/ingestor/channels/slack/index.ts`**

```ts
import type { IngestorChannel } from "../../ingestor-channel.js";
import type { Ingestor } from "../../ingestor.js";
import { SlackSocketListener } from "./listener.js";
import { getIntegrationKeys } from "../../../util/keys.js";
import { log } from "../../../util/logger.js";

export function createSlackChannel(ingestor: Ingestor): IngestorChannel {
  let listener: SlackSocketListener | null = null;

  return {
    name: "slack",

    isEnabled(): boolean {
      const keys = getIntegrationKeys("slack");
      return !!keys?.app_token;
    },

    async startListener(): Promise<void> {
      const keys = getIntegrationKeys("slack");
      const appToken = keys?.app_token;
      if (!appToken) {
        log.info("Slack channel: missing app_token, skipping.");
        return;
      }
      listener = new SlackSocketListener(appToken, ingestor);
      await listener.start();
    },

    async stopListener(): Promise<void> {
      if (listener) {
        await listener.stop();
        listener = null;
      }
    },
  };
}
```

**Step 6: Run tests**

Run: `npx vitest run src/ingestor/channels/slack/`
Expected: PASS (all transform and listener tests)

**Step 7: Commit**

```
feat: add Slack IngestorChannel under channels/slack/
```

---

### Task 4: Create GitHub channels (stubs)

**Files:**
- Create: `src/ingestor/channels/github-webhook/transform.ts`
- Create: `src/ingestor/channels/github-webhook/index.ts`
- Create: `src/ingestor/channels/github-poll/transform.ts`
- Create: `src/ingestor/channels/github-poll/index.ts`

**Step 1: Create `src/ingestor/channels/github-webhook/transform.ts`**

```ts
import type { Trigger } from "../../trigger.js";

interface GitHubWebhookEvent {
  action?: string;
  [key: string]: unknown;
}

export function transformGithubWebhookEvent(raw: unknown): Trigger {
  const event = raw as GitHubWebhookEvent;
  return {
    source: "github_webhook",
    id: `github-webhook-${Date.now()}`,
    timestamp: new Date().toISOString(),
    raw_payload: event,
  };
}
```

**Step 2: Create `src/ingestor/channels/github-webhook/index.ts`**

```ts
import type { IngestorChannel } from "../../ingestor-channel.js";
import type { Ingestor } from "../../ingestor.js";

export function createGithubWebhookChannel(_ingestor: Ingestor): IngestorChannel {
  return {
    name: "github-webhook",
    isEnabled: () => false,
    startListener: async () => {},
    stopListener: async () => {},
  };
}
```

**Step 3: Create `src/ingestor/channels/github-poll/transform.ts`**

```ts
import type { Trigger } from "../../trigger.js";

interface GitHubPollEvent {
  [key: string]: unknown;
}

export function transformGithubPollEvent(raw: unknown): Trigger {
  const event = raw as GitHubPollEvent;
  return {
    source: "github_poll",
    id: `github-poll-${Date.now()}`,
    timestamp: new Date().toISOString(),
    raw_payload: event,
  };
}
```

**Step 4: Create `src/ingestor/channels/github-poll/index.ts`**

```ts
import type { IngestorChannel } from "../../ingestor-channel.js";
import type { Ingestor } from "../../ingestor.js";

export function createGithubPollChannel(_ingestor: Ingestor): IngestorChannel {
  return {
    name: "github-poll",
    isEnabled: () => false,
    startListener: async () => {},
    stopListener: async () => {},
  };
}
```

**Step 5: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 6: Commit**

```
feat: add GitHub webhook and poll IngestorChannel stubs
```

---

### Task 5: Create channel registry

**Files:**
- Create: `src/ingestor/channels/index.ts`

**Step 1: Create `src/ingestor/channels/index.ts`**

```ts
import type { IngestorChannel } from "../ingestor-channel.js";
import type { Ingestor } from "../ingestor.js";
import { createSlackChannel } from "./slack/index.js";
import { createGithubWebhookChannel } from "./github-webhook/index.js";
import { createGithubPollChannel } from "./github-poll/index.js";

export function getAllChannels(ingestor: Ingestor): IngestorChannel[] {
  return [
    createSlackChannel(ingestor),
    createGithubWebhookChannel(ingestor),
    createGithubPollChannel(ingestor),
  ];
}
```

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```
feat: add IngestorChannel registry
```

---

### Task 6: Update runner start.ts

**Files:**
- Modify: `src/commands/runner/start.ts`

**Step 1: Update `src/commands/runner/start.ts`**

Replace the current file contents with:

```ts
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { zombiebenDir, ensureRunnerDir, reposDir, seenTriggersPath } from "../../util/paths.js";
import { processTick } from "../../runner/orchestrator.js";
import { log } from "../../util/logger.js";
import { Ingestor } from "../../ingestor/ingestor.js";
import { FileDedupStore } from "../../ingestor/dedup-store.js";
import { getAllChannels } from "../../ingestor/channels/index.js";
import type { IngestorChannel } from "../../ingestor/ingestor-channel.js";

const POLL_INTERVAL_MS = 5000;
const PID_FILE = path.join(zombiebenDir(), "runner.pid");

function hasRepos(): boolean {
  const dir = reposDir();
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).length > 0;
}

export function registerStartCommand(parent: Command): void {
  parent
    .command("start")
    .description("Start the ZombieBen runner daemon")
    .option("-d, --daemon", "Run in background (daemon mode)")
    .option("-v, --verbose", "Enable verbose logging")
    .action(async (opts) => {
      ensureRunnerDir();

      if (!hasRepos()) {
        console.error("No repos configured. Run `zombieben runner chat` to set up some repos.");
        process.exit(1);
      }

      if (opts.daemon) {
        startDaemon();
      } else {
        await startForeground(opts.verbose);
      }
    });
}

function startDaemon(): void {
  if (fs.existsSync(PID_FILE)) {
    const existingPid = parseInt(fs.readFileSync(PID_FILE, "utf-8"), 10);
    try {
      process.kill(existingPid, 0);
      console.error(`Runner already running (PID ${existingPid}).`);
      process.exit(1);
    } catch {
      // PID file is stale
    }
  }

  const __filename = fileURLToPath(import.meta.url);
  const child = fork(__filename, ["--foreground"], {
    detached: true,
    stdio: "ignore",
  });

  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid));
  log.info(`Runner started in background (PID ${child.pid}).`);
}

async function startForeground(verbose = false): Promise<void> {
  log.tee = true;
  log.info("ZombieBen runner starting...");
  log.info(`Polling every ${POLL_INTERVAL_MS / 1000}s.`);

  let running = true;
  let enabledChannels: IngestorChannel[] = [];

  const dedupStore = new FileDedupStore(seenTriggersPath());
  const ingestor = new Ingestor({
    dedupStore,
    onTrigger: async (result) => {
      const { trigger, responders } = result;
      if (verbose) {
        log.info(`Trigger received:\n${JSON.stringify(trigger, null, 2)}`);
      } else {
        log.info(`Trigger received: ${trigger.source} ${trigger.id}`);
      }
      log.info(`Responders: ${responders.map(r => `${r.channelKey} [${[...r.roles]}]`).join(", ") || "none"}`);
    },
  });

  // Start all enabled channels
  const allChannels = getAllChannels(ingestor);
  for (const channel of allChannels) {
    if (channel.isEnabled()) {
      try {
        await channel.startListener();
        enabledChannels.push(channel);
        log.info(`Channel started: ${channel.name}`);
      } catch (err) {
        log.error(`Channel ${channel.name} failed to start: ${(err as Error).message}`);
      }
    } else {
      log.info(`Channel skipped (not enabled): ${channel.name}`);
    }
  }

  const shutdown = async () => {
    log.info("Shutting down...");
    running = false;
    for (const channel of enabledChannels) {
      await channel.stopListener();
    }
    if (fs.existsSync(PID_FILE)) {
      try {
        const storedPid = parseInt(fs.readFileSync(PID_FILE, "utf-8"), 10);
        if (storedPid === process.pid) {
          fs.unlinkSync(PID_FILE);
        }
      } catch { /* ignore */ }
    }
  };

  process.on("SIGINT", () => { shutdown(); });
  process.on("SIGTERM", () => { shutdown(); });

  fs.writeFileSync(PID_FILE, String(process.pid));

  while (running) {
    try {
      await processTick();
    } catch (err) {
      log.error(`Tick error: ${(err as Error).message}`);
    }

    if (running) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
}

if (process.argv.includes("--foreground")) {
  startForeground();
}
```

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```
refactor: runner start uses generic IngestorChannel lifecycle
```

---

### Task 7: Update all import paths from `ingestor/types.js` to `ingestor/trigger.js`

**Files:**
- Modify: `src/responder/types.ts` — change `../ingestor/types.js` to `../ingestor/trigger.js`
- Modify: `src/responder/resolve.ts` — change `../ingestor/types.js` to `../ingestor/trigger.js`
- Modify: `src/responder/resolve.test.ts` — change `../ingestor/types.js` to `../ingestor/trigger.js`
- Modify: `src/integrations/types.ts` — change `../ingestor/types.js` to `../ingestor/trigger.js`
- Modify: `src/integrations/slack/index.ts` — change `../../ingestor/types.js` to `../../ingestor/trigger.js`
- Modify: `src/runner/init-run.ts` — change `../ingestor/types.js` to `../ingestor/trigger.js`
- Modify: `src/runner/init-run.test.ts` — change `../ingestor/types.js` to `../ingestor/trigger.js`

**Step 1: Update each file's import**

In each file listed above, replace the `Trigger` import path from `ingestor/types.js` to `ingestor/trigger.js`. The import statement shape stays the same — only the path changes.

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Run all tests**

Run: `npx vitest run`
Expected: PASS

**Step 4: Commit**

```
refactor: update Trigger imports to ingestor/trigger.js
```

---

### Task 8: Delete old files

**Files:**
- Delete: `src/ingestor/types.ts`
- Delete: `src/ingestor/sources/slack-webhook.ts`
- Delete: `src/ingestor/sources/slack-webhook.test.ts`
- Delete: `src/ingestor/sources/github-webhook.ts`
- Delete: `src/ingestor/sources/github-poll.ts`
- Delete: `src/ingestor/sources/index.ts`
- Delete: `src/ingestor/listeners/slack.ts`
- Delete: `src/ingestor/listeners/slack.test.ts`

**Step 1: Delete all listed files and empty directories**

```bash
rm src/ingestor/types.ts
rm -r src/ingestor/sources/
rm -r src/ingestor/listeners/
```

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Run all tests**

Run: `npx vitest run`
Expected: ALL PASS

**Step 4: Commit**

```
refactor: delete old sources/ and listeners/ directories
```

---

### Task 9: Final verification

**Step 1: Clean build**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 2: All tests pass**

Run: `npx vitest run`
Expected: ALL PASS

**Step 3: Manual smoke test**

Run: `npm run build && zombieben runner start`
Expected: See channel start/skip log lines, @mention bot → trigger + responder output
