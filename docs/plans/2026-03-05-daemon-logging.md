# Daemon Logging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a shared logger that writes to `~/.zombieben/runner.log`, replace all daemon `console.log`/`console.error` calls, log trigger receipt, and add a `zombieben runner logs` CLI command.

**Architecture:** A `src/util/logger.ts` module exposes `log.info()`, `log.warn()`, `log.error()` which lazily append timestamped plain-text lines to `runner.log`. Daemon code paths import and use `log` instead of `console`. A new `runner logs` command tails the file.

**Tech Stack:** Node.js `fs` (no external dependencies)

---

### Task 1: Add `runnerLogPath()` to paths module

**Files:**
- Modify: `src/util/paths.ts`

**Step 1: Add the path function**

Add after the `zombiebenDir()` function (after line 36):

```typescript
export function runnerLogPath(): string {
  return path.join(zombiebenDir(), "runner.log");
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Success

---

### Task 2: Create logger module with tests

**Files:**
- Create: `src/util/logger.ts`
- Create: `src/util/logger.test.ts`

**Step 1: Write the test**

```typescript
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createLogger, type Logger } from "./logger.js";

describe("logger", () => {
  let tmpDir: string;
  let logPath: string;
  let log: Logger;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zb-log-"));
    logPath = path.join(tmpDir, "runner.log");
    log = createLogger(logPath);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates log file on first write", () => {
    expect(fs.existsSync(logPath)).toBe(false);
    log.info("hello");
    expect(fs.existsSync(logPath)).toBe(true);
  });

  it("writes timestamped lines with level", () => {
    log.info("started");
    const content = fs.readFileSync(logPath, "utf-8");
    expect(content).toMatch(
      /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z\] \[INFO\] started\n$/,
    );
  });

  it("appends multiple lines", () => {
    log.info("first");
    log.error("second");
    const lines = fs.readFileSync(logPath, "utf-8").trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("[INFO] first");
    expect(lines[1]).toContain("[ERROR] second");
  });

  it("supports warn level", () => {
    log.warn("careful");
    const content = fs.readFileSync(logPath, "utf-8");
    expect(content).toContain("[WARN] careful");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/util/logger.test.ts`
Expected: FAIL — module not found

**Step 3: Write the logger module**

```typescript
import fs from "node:fs";
import { runnerLogPath } from "./paths.js";

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export function createLogger(logFile?: string): Logger {
  const filePath = logFile ?? runnerLogPath();

  function write(level: string, message: string): void {
    const ts = new Date().toISOString();
    fs.appendFileSync(filePath, `[${ts}] [${level}] ${message}\n`);
  }

  return {
    info: (msg) => write("INFO", msg),
    warn: (msg) => write("WARN", msg),
    error: (msg) => write("ERROR", msg),
  };
}

/** Default logger instance — writes to ~/.zombieben/runner.log */
export const log: Logger = createLogger();
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/util/logger.test.ts`
Expected: PASS (4 tests)

**Step 5: Commit**

```
feat: add logger module (src/util/logger.ts)
```

---

### Task 3: Replace console calls in `start.ts`

**Files:**
- Modify: `src/commands/runner/start.ts`

**Step 1: Add import**

Add at top of file:

```typescript
import { log } from "../../util/logger.js";
```

**Step 2: Replace daemon-path console calls**

In `startForeground()` — replace:
- `console.log("ZombieBen runner starting...");` → `log.info("Runner starting...");`
- `console.log(\`Polling every ${POLL_INTERVAL_MS / 1000}s. Ctrl+C to stop.\n\`);` → `log.info(\`Polling every ${POLL_INTERVAL_MS / 1000}s\`);`
- `console.log("\nShutting down...");` → `log.info("Shutting down...");`
- `console.error(\`Tick error: ${(err as Error).message}\`);` → `log.error(\`Tick error: ${(err as Error).message}\`);`

In `startDaemon()` — replace:
- `console.log(\`Runner started in background (PID ${child.pid}).\`);` → `log.info(\`Runner started in background (PID ${child.pid})\`);`

Keep `console.error` for CLI-facing errors (no repos configured, already running) — those are user-facing, not daemon logs.

**Step 3: Verify build**

Run: `npm run build`
Expected: Success

**Step 4: Commit**

```
refactor: use logger in runner start command
```

---

### Task 4: Replace console calls in `orchestrator.ts`

**Files:**
- Modify: `src/runner/orchestrator.ts`

**Step 1: Add import**

```typescript
import { log } from "../util/logger.js";
```

**Step 2: Replace console calls**

In `processTick()`:
- `console.error(\`Error processing ${run.repoSlug}/${run.worktreeId}: ${(err as Error).message}\`)` → `log.error(\`Error processing ${run.repoSlug}/${run.worktreeId}: ${(err as Error).message}\`)`

In `processRun()`:
- `console.error(\`Workflow file not found: ${workflowPath}\`);` → `log.error(\`Workflow file not found: ${workflowPath}\`);`
- Replace the final `console.log` (line 89-91) with: `log.info(\`${repoSlug}/${worktreeId}: ${state.step_name} → ${action} (${nextState.status})\`);` — the logger already adds the timestamp, so remove the manual `new Date().toLocaleTimeString()`.

**Step 3: Verify build and tests**

Run: `npm run build && npx vitest run`
Expected: Success, all tests pass

**Step 4: Commit**

```
refactor: use logger in orchestrator
```

---

### Task 5: Log trigger receipt in triager

**Files:**
- Modify: `src/workflow-triage/triager.ts`

**Step 1: Add import**

```typescript
import { log } from "../util/logger.js";
```

**Step 2: Add log line at top of `runTriage()`**

Add as first line of the function body (before the `loadExistingWorkflow` call):

```typescript
log.info(`Trigger received: ${trigger.source} ${trigger.slackTriggerType} [${triggerId}]`);
```

**Step 3: Verify build and tests**

Run: `npm run build && npx vitest run`
Expected: Success, all tests pass

**Step 4: Commit**

```
feat: log trigger receipt in triager
```

---

### Task 6: Add `runner logs` command

**Files:**
- Create: `src/commands/runner/logs.ts`
- Modify: `src/commands/runner/index.ts`

**Step 1: Create the logs command**

```typescript
import { Command } from "commander";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { runnerLogPath } from "../../util/paths.js";

export function registerLogsCommand(parent: Command): void {
  parent
    .command("logs")
    .description("Tail the runner daemon log")
    .action(() => {
      const logFile = runnerLogPath();

      if (!fs.existsSync(logFile)) {
        console.error("No log file found. Is the runner running?");
        process.exit(1);
      }

      const tail = spawn("tail", ["-f", logFile], { stdio: "inherit" });
      tail.on("error", (err) => {
        console.error(`Failed to tail log: ${err.message}`);
        process.exit(1);
      });
    });
}
```

**Step 2: Register in runner index**

Add import and registration in `src/commands/runner/index.ts`:

```typescript
import { registerLogsCommand } from "./logs.js";
```

Add inside `registerRunnerCommand()`:

```typescript
registerLogsCommand(runner);
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Success

**Step 4: Commit**

```
feat: add `zombieben runner logs` command
```

---

### Task 7: Final verification

**Step 1: Full build, lint, test**

Run: `npm run build && npm run lint && npx vitest run`
Expected: Build passes, lint has only pre-existing errors in `commands/update.ts`, all tests pass.
