# Default Communication Channel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a global Slack notification channel where ZombieBen broadcasts workflow lifecycle events (started, completed, failed), independent of trigger-specific responders.

**Architecture:** A `Notifier` interface with `SlackNotifier` and `CompositeNotifier` implementations. The orchestrator and `initRun` call the notifier at lifecycle transitions. The notifier is created at daemon startup and threaded through. A `NoopNotifier` is used when nothing is configured.

**Tech Stack:** TypeScript, `@slack/web-api` (already installed), vitest

---

### Task 1: Create Notifier interface, CompositeNotifier, and NoopNotifier

**Files:**
- Create: `src/notifications/notifier.ts`
- Test: `src/notifications/notifier.test.ts`

**Step 1: Write the failing test**

Create `src/notifications/notifier.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { CompositeNotifier, NoopNotifier, type Notifier } from "./notifier.js";

describe("NoopNotifier", () => {
  it("does nothing without errors", async () => {
    const noop = new NoopNotifier();
    await noop.workflowStarted("repo", "wf", "wt");
    await noop.workflowCompleted("repo", "wf", "wt");
    await noop.workflowFailed("repo", "wf", "wt", "err");
  });
});

describe("CompositeNotifier", () => {
  it("fans out to all notifiers", async () => {
    const a: Notifier = {
      workflowStarted: vi.fn().mockResolvedValue(undefined),
      workflowCompleted: vi.fn().mockResolvedValue(undefined),
      workflowFailed: vi.fn().mockResolvedValue(undefined),
    };
    const b: Notifier = {
      workflowStarted: vi.fn().mockResolvedValue(undefined),
      workflowCompleted: vi.fn().mockResolvedValue(undefined),
      workflowFailed: vi.fn().mockResolvedValue(undefined),
    };

    const composite = new CompositeNotifier([a, b]);

    await composite.workflowStarted("repo", "wf", "wt");
    expect(a.workflowStarted).toHaveBeenCalledWith("repo", "wf", "wt");
    expect(b.workflowStarted).toHaveBeenCalledWith("repo", "wf", "wt");

    await composite.workflowCompleted("repo", "wf", "wt");
    expect(a.workflowCompleted).toHaveBeenCalledWith("repo", "wf", "wt");
    expect(b.workflowCompleted).toHaveBeenCalledWith("repo", "wf", "wt");

    await composite.workflowFailed("repo", "wf", "wt", "err");
    expect(a.workflowFailed).toHaveBeenCalledWith("repo", "wf", "wt", "err");
    expect(b.workflowFailed).toHaveBeenCalledWith("repo", "wf", "wt", "err");
  });

  it("continues if one notifier throws", async () => {
    const failing: Notifier = {
      workflowStarted: vi.fn().mockRejectedValue(new Error("fail")),
      workflowCompleted: vi.fn().mockResolvedValue(undefined),
      workflowFailed: vi.fn().mockResolvedValue(undefined),
    };
    const working: Notifier = {
      workflowStarted: vi.fn().mockResolvedValue(undefined),
      workflowCompleted: vi.fn().mockResolvedValue(undefined),
      workflowFailed: vi.fn().mockResolvedValue(undefined),
    };

    const composite = new CompositeNotifier([failing, working]);
    await composite.workflowStarted("repo", "wf", "wt");
    expect(working.workflowStarted).toHaveBeenCalledOnce();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/notifications/notifier.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `src/notifications/notifier.ts`:

```ts
import { log } from "../util/logger.js";

export interface Notifier {
  workflowStarted(repoSlug: string, workflowName: string, worktreeId: string): Promise<void>;
  workflowCompleted(repoSlug: string, workflowName: string, worktreeId: string): Promise<void>;
  workflowFailed(repoSlug: string, workflowName: string, worktreeId: string, error: string): Promise<void>;
}

export class NoopNotifier implements Notifier {
  async workflowStarted(): Promise<void> {}
  async workflowCompleted(): Promise<void> {}
  async workflowFailed(): Promise<void> {}
}

export class CompositeNotifier implements Notifier {
  constructor(private notifiers: Notifier[]) {}

  async workflowStarted(repoSlug: string, workflowName: string, worktreeId: string): Promise<void> {
    for (const n of this.notifiers) {
      try {
        await n.workflowStarted(repoSlug, workflowName, worktreeId);
      } catch (err) {
        log.error(`Notifier error (workflowStarted): ${(err as Error).message}`);
      }
    }
  }

  async workflowCompleted(repoSlug: string, workflowName: string, worktreeId: string): Promise<void> {
    for (const n of this.notifiers) {
      try {
        await n.workflowCompleted(repoSlug, workflowName, worktreeId);
      } catch (err) {
        log.error(`Notifier error (workflowCompleted): ${(err as Error).message}`);
      }
    }
  }

  async workflowFailed(repoSlug: string, workflowName: string, worktreeId: string, error: string): Promise<void> {
    for (const n of this.notifiers) {
      try {
        await n.workflowFailed(repoSlug, workflowName, worktreeId, error);
      } catch (err) {
        log.error(`Notifier error (workflowFailed): ${(err as Error).message}`);
      }
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/notifications/notifier.test.ts`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add src/notifications/notifier.ts src/notifications/notifier.test.ts
git commit -m "feat: add Notifier interface with CompositeNotifier and NoopNotifier"
```

---

### Task 2: Create SlackNotifier

**Files:**
- Create: `src/notifications/slack.ts`
- Test: `src/notifications/slack.test.ts`
- Reference: `src/util/keys.ts` (read `notification_channel`)

**Step 1: Write the failing test**

Create `src/notifications/slack.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WebClient } from "@slack/web-api";
import { SlackNotifier, createSlackNotifier } from "./slack.js";

vi.mock("../util/keys.js", () => ({
  getIntegrationKeys: vi.fn(),
}));

import { getIntegrationKeys } from "../util/keys.js";
const mockGetIntegrationKeys = vi.mocked(getIntegrationKeys);

function createMockClient() {
  return {
    chat: {
      postMessage: vi.fn().mockResolvedValue({ ok: true }),
    },
  } as unknown as WebClient & {
    chat: { postMessage: ReturnType<typeof vi.fn> };
  };
}

describe("SlackNotifier", () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let notifier: SlackNotifier;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    notifier = new SlackNotifier(mockClient as unknown as WebClient, "C999");
  });

  it("posts workflowStarted message", async () => {
    await notifier.workflowStarted("my-org--repo", "Fix Bug", "fix-bug-123");

    expect(mockClient.chat.postMessage).toHaveBeenCalledWith({
      channel: "C999",
      text: ':rocket: Workflow "Fix Bug" started (my-org--repo/fix-bug-123)',
    });
  });

  it("posts workflowCompleted message", async () => {
    await notifier.workflowCompleted("my-org--repo", "Fix Bug", "fix-bug-123");

    expect(mockClient.chat.postMessage).toHaveBeenCalledWith({
      channel: "C999",
      text: ':white_check_mark: Workflow "Fix Bug" completed (my-org--repo/fix-bug-123)',
    });
  });

  it("posts workflowFailed message with error", async () => {
    await notifier.workflowFailed("my-org--repo", "Fix Bug", "fix-bug-123", "Step timed out");

    expect(mockClient.chat.postMessage).toHaveBeenCalledWith({
      channel: "C999",
      text: ':x: Workflow "Fix Bug" failed: Step timed out (my-org--repo/fix-bug-123)',
    });
  });
});

describe("createSlackNotifier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when notification_channel is not configured", () => {
    mockGetIntegrationKeys.mockReturnValue({ bot_token: "xoxb-test" });
    const result = createSlackNotifier(createMockClient() as unknown as WebClient);
    expect(result).toBeNull();
  });

  it("returns a SlackNotifier when notification_channel is configured", () => {
    mockGetIntegrationKeys.mockReturnValue({
      bot_token: "xoxb-test",
      notification_channel: "C999",
    });
    const result = createSlackNotifier(createMockClient() as unknown as WebClient);
    expect(result).toBeInstanceOf(SlackNotifier);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/notifications/slack.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `src/notifications/slack.ts`:

```ts
import type { WebClient } from "@slack/web-api";
import type { Notifier } from "./notifier.js";
import { getIntegrationKeys } from "../util/keys.js";

export class SlackNotifier implements Notifier {
  constructor(
    private client: WebClient,
    private channel: string,
  ) {}

  async workflowStarted(repoSlug: string, workflowName: string, worktreeId: string): Promise<void> {
    await this.client.chat.postMessage({
      channel: this.channel,
      text: `:rocket: Workflow "${workflowName}" started (${repoSlug}/${worktreeId})`,
    });
  }

  async workflowCompleted(repoSlug: string, workflowName: string, worktreeId: string): Promise<void> {
    await this.client.chat.postMessage({
      channel: this.channel,
      text: `:white_check_mark: Workflow "${workflowName}" completed (${repoSlug}/${worktreeId})`,
    });
  }

  async workflowFailed(repoSlug: string, workflowName: string, worktreeId: string, error: string): Promise<void> {
    await this.client.chat.postMessage({
      channel: this.channel,
      text: `:x: Workflow "${workflowName}" failed: ${error} (${repoSlug}/${worktreeId})`,
    });
  }
}

export function createSlackNotifier(client: WebClient): SlackNotifier | null {
  const keys = getIntegrationKeys("slack");
  const channel = keys?.notification_channel;
  if (!channel) return null;
  return new SlackNotifier(client, channel);
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/notifications/slack.test.ts`
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add src/notifications/slack.ts src/notifications/slack.test.ts
git commit -m "feat: add SlackNotifier for global channel notifications"
```

---

### Task 3: Wire notifier into initRun and update its tests

**Files:**
- Modify: `src/runner/init-run.ts`
- Modify: `src/runner/init-run.test.ts`
- Modify: `src/listeners/slack.ts:82-85` (pass notifier to initRun)
- Modify: `src/listeners/slack.test.ts:9-11,155` (update mock and assertions)

**Step 1: Update initRun signature and implementation**

In `src/runner/init-run.ts`, change `initRun` to accept a `Notifier` and a `TriggerResponder`. After writing `workflow_state.json`, call `notifier.workflowStarted()` and `responder.send()`:

```ts
import fs from "node:fs";
import path from "node:path";
import type { TriageResult } from "../workflow-triage/triager.js";
import type { TriggerEvent } from "../integrations/trigger-event.js";
import type { TriggerResponder } from "../trigger/responder.js";
import type { Notifier } from "../notifications/notifier.js";
import { parseWorkflow } from "../workflow/parser.js";
import { initWorkflowRunState } from "../engine/workflow-runner.js";
import {
  repoWorkflowsDir,
  worktreeDir,
  worktreeStatePath,
} from "../util/paths.js";
import { log } from "../util/logger.js";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function initRun(
  triageResult: TriageResult,
  trigger: TriggerEvent,
  responder: TriggerResponder,
  notifier: Notifier,
): Promise<void> {
  const { repoSlug, workflowFile, inputs } = triageResult;

  // Read and parse workflow definition
  const workflowPath = path.join(repoWorkflowsDir(repoSlug), workflowFile);
  if (!fs.existsSync(workflowPath)) {
    throw new Error(`Workflow file not found: ${workflowPath}`);
  }
  const workflowContent = fs.readFileSync(workflowPath, "utf-8");
  const workflow = parseWorkflow(workflowContent);

  // Generate worktree ID
  const worktreeId = `${slugify(workflow.name)}-${Date.now()}`;

  // Create directory structure
  const wtDir = worktreeDir(repoSlug, worktreeId);
  fs.mkdirSync(wtDir, { recursive: true });

  // Write workflow_state.json
  const state = initWorkflowRunState(workflow, workflowFile, inputs);
  const statePath = worktreeStatePath(repoSlug, worktreeId);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

  // Write trigger.json for dedup
  const triggerPath = path.join(wtDir, "trigger.json");
  fs.writeFileSync(
    triggerPath,
    JSON.stringify({ id: trigger.id, source: trigger.source }, null, 2),
  );

  log.info(
    `Initialized run ${repoSlug}/${worktreeId} for workflow "${workflow.name}"`,
  );

  // Notify
  await responder.send(`Workflow "${workflow.name}" started.`);
  await notifier.workflowStarted(repoSlug, workflow.name, worktreeId);
}
```

**Step 2: Update init-run tests**

In `src/runner/init-run.test.ts`, add mock `Notifier` and `TriggerResponder` to each test call:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initRun } from "./init-run.js";
import type { TriageResult } from "../workflow-triage/triager.js";
import type { TriggerEvent } from "../integrations/trigger-event.js";
import type { TriggerResponder } from "../trigger/responder.js";
import type { Notifier } from "../notifications/notifier.js";

const TEST_DIR = path.join(os.tmpdir(), "zombieben-init-run-test");

vi.mock("../util/logger.js", () => ({
  log: { info: vi.fn(), error: vi.fn() },
}));

function createMockResponder(): TriggerResponder {
  return {
    send: vi.fn().mockResolvedValue(undefined),
    promptChoice: vi.fn().mockResolvedValue(0),
    waitForReply: vi.fn().mockResolvedValue(""),
  };
}

function createMockNotifier(): Notifier & {
  workflowStarted: ReturnType<typeof vi.fn>;
  workflowCompleted: ReturnType<typeof vi.fn>;
  workflowFailed: ReturnType<typeof vi.fn>;
} {
  return {
    workflowStarted: vi.fn().mockResolvedValue(undefined),
    workflowCompleted: vi.fn().mockResolvedValue(undefined),
    workflowFailed: vi.fn().mockResolvedValue(undefined),
  };
}

describe("initRun", () => {
  let mockResponder: ReturnType<typeof createMockResponder>;
  let mockNotifier: ReturnType<typeof createMockNotifier>;

  beforeEach(() => {
    process.env.ZOMBIEBEN_RUNNER_DIR = TEST_DIR;
    fs.mkdirSync(TEST_DIR, { recursive: true });
    mockResponder = createMockResponder();
    mockNotifier = createMockNotifier();

    const workflowsDir = path.join(
      TEST_DIR, "repos", "my-org--my-repo", "main_repo", ".zombieben", "workflows",
    );
    fs.mkdirSync(workflowsDir, { recursive: true });
    fs.writeFileSync(
      path.join(workflowsDir, "fix-bug.yml"),
      `name: Fix Bug\nsteps:\n  - name: do-it\n    prompt: Fix the bug\n`,
    );
  });

  afterEach(() => {
    delete process.env.ZOMBIEBEN_RUNNER_DIR;
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("creates directory structure with workflow_state.json and trigger.json", async () => {
    const triageResult: TriageResult = {
      repoSlug: "my-org--my-repo",
      workflowFile: "fix-bug.yml",
      workflowName: "Fix Bug",
      inputs: { issue: "123" },
    };

    const trigger: TriggerEvent = {
      source: "slack",
      eventType: "new_thread",
      id: "slack-C123-1234.5678",
      text: "fix it",
      payload: {},
    };

    await initRun(triageResult, trigger, mockResponder, mockNotifier);

    const tasksDir = path.join(TEST_DIR, "repos", "my-org--my-repo", "tasks");
    expect(fs.existsSync(tasksDir)).toBe(true);
    const entries = fs.readdirSync(tasksDir);
    expect(entries.length).toBe(1);
    expect(entries[0]).toMatch(/^fix-bug-\d+$/);

    const wtDir = path.join(tasksDir, entries[0]);

    const statePath = path.join(wtDir, "workflow_state.json");
    const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    expect(state.workflow_name).toBe("Fix Bug");
    expect(state.status).toBe("running");

    const triggerPath = path.join(wtDir, "trigger.json");
    const triggerData = JSON.parse(fs.readFileSync(triggerPath, "utf-8"));
    expect(triggerData.id).toBe("slack-C123-1234.5678");
  });

  it("notifies via responder and notifier", async () => {
    const triageResult: TriageResult = {
      repoSlug: "my-org--my-repo",
      workflowFile: "fix-bug.yml",
      workflowName: "Fix Bug",
      inputs: {},
    };

    const trigger: TriggerEvent = {
      source: "slack",
      eventType: "new_thread",
      id: "slack-C123-1234.5678",
      text: "fix it",
      payload: {},
    };

    await initRun(triageResult, trigger, mockResponder, mockNotifier);

    expect(mockResponder.send).toHaveBeenCalledWith('Workflow "Fix Bug" started.');
    expect(mockNotifier.workflowStarted).toHaveBeenCalledWith(
      "my-org--my-repo",
      "Fix Bug",
      expect.stringMatching(/^fix-bug-\d+$/),
    );
  });

  it("throws when workflow file does not exist", async () => {
    const triageResult: TriageResult = {
      repoSlug: "my-org--my-repo",
      workflowFile: "nonexistent.yml",
      workflowName: "Missing",
      inputs: {},
    };

    const trigger: TriggerEvent = {
      source: "slack",
      eventType: "new_thread",
      id: "slack-C123-999",
      text: "test",
      payload: {},
    };

    await expect(initRun(triageResult, trigger, mockResponder, mockNotifier)).rejects.toThrow(
      "Workflow file not found",
    );
  });
});
```

**Step 3: Update slack listener to pass notifier and responder to initRun**

In `src/listeners/slack.ts`, add `notifier` to the constructor and pass it through:

- Add `import type { Notifier } from "../notifications/notifier.js";` to imports
- Add `private notifier: Notifier` to constructor: `constructor(appToken: string, webClient: WebClient, private notifier: Notifier)`
- Change `initRun(result, trigger)` on line 85 to `initRun(result, trigger, responder, this.notifier)`
- Update `createSlackSocketListener` to accept and pass `notifier`

**Step 4: Update slack listener tests**

In `src/listeners/slack.test.ts`:
- Add mock for `../notifications/notifier.js` with `NoopNotifier`
- Update `SlackSocketListener` construction to pass `NoopNotifier` instance
- Update `createSlackSocketListener` calls to pass notifier
- Update the "calls initRun" test to expect responder and notifier args

**Step 5: Run all tests**

Run: `npx vitest run src/runner/init-run.test.ts src/listeners/slack.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/runner/init-run.ts src/runner/init-run.test.ts src/listeners/slack.ts src/listeners/slack.test.ts
git commit -m "feat: wire notifier into initRun and slack listener"
```

---

### Task 4: Wire notifier into orchestrator for completed/failed states

**Files:**
- Modify: `src/runner/orchestrator.ts`

**Step 1: Update processTick and processRun signatures**

In `src/runner/orchestrator.ts`:
- Add `import type { Notifier } from "../notifications/notifier.js";`
- Change `processTick()` to `processTick(notifier: Notifier)`
- Change `processRun(run)` to `processRun(run, notifier)`
- After writing `nextState` to disk (line 87), add notification logic:

```ts
if (nextState.status === "completed") {
  await notifier.workflowCompleted(repoSlug, state.workflow_name, worktreeId);
}
if (nextState.status === "failed") {
  await notifier.workflowFailed(repoSlug, state.workflow_name, worktreeId, nextState.error ?? "Unknown error");
}
```

**Step 2: Run type-check**

Run: `npx tsc --noEmit`
Expected: Errors in `start.ts` because `processTick()` now requires `notifier` arg — that's expected, fixed in Task 5.

**Step 3: Commit**

```bash
git add src/runner/orchestrator.ts
git commit -m "feat: orchestrator notifies on workflow completion and failure"
```

---

### Task 5: Wire notifier into daemon startup

**Files:**
- Modify: `src/commands/runner/start.ts`

**Step 1: Update startForeground to create and pass notifier**

In `src/commands/runner/start.ts`:
- Add imports for `createSlackNotifier`, `CompositeNotifier`, `NoopNotifier`
- After creating `webClient`, create the notifier:

```ts
import { createSlackNotifier } from "../../notifications/slack.js";
import { CompositeNotifier, NoopNotifier } from "../../notifications/notifier.js";
```

In `startForeground()`, after the Slack listener setup block, add:

```ts
// Build notifier
const slackNotifier = webClient ? createSlackNotifier(webClient) : null;
const notifiers = [slackNotifier].filter((n): n is NonNullable<typeof n> => n != null);
const notifier = notifiers.length > 0 ? new CompositeNotifier(notifiers) : new NoopNotifier();
```

Note: `webClient` creation may throw if bot_token isn't configured. Handle this by declaring `let webClient: WebClient | null = null` before the try block and assigning inside it. Then use `webClient` for both listener and notifier setup.

- Change `processTick()` call on line 111 to `processTick(notifier)`
- Pass `notifier` to `createSlackSocketListener(webClient, notifier)` (which passes it to the listener constructor)

**Step 2: Run type-check and all tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS — clean build, all tests pass

**Step 3: Commit**

```bash
git add src/commands/runner/start.ts
git commit -m "feat: create notifier at daemon startup and pass to orchestrator"
```

---

### Task 6: Update setup-slack skill for notification_channel

**Files:**
- Modify: `chat-skills/setup-slack/SKILL.md`

**Step 1: Add notification_channel to setup flow**

After the app_token step, add:
- Ask user for the Slack channel ID for notifications (optional)
- Show it in the `keys.json` example
- Update the `setIntegrationKeys` example

The updated keys.json example:
```json
{
  "slack": {
    "bot_token": "xoxb-...",
    "app_token": "xapp-...",
    "notification_channel": "C0123456789"
  }
}
```

Add a note that `notification_channel` is optional — if not set, lifecycle notifications won't be posted to a global channel.

**Step 2: Commit**

```bash
git add chat-skills/setup-slack/SKILL.md
git commit -m "docs: add notification_channel to setup-slack skill"
```

---

### Task 7: Final verification

**Step 1: Full build check**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 2: Full test suite**

Run: `npx vitest run`
Expected: All tests pass

**Step 3: Lint**

Run: `npm run lint`
Expected: No new errors (pre-existing `update.ts` errors are OK)
