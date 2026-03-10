import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { CodingAgent } from "@/codingagents/index.js";

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

const TEST_DIR = path.join(os.tmpdir(), "zombieben-repo-sync-test");

describe("rebaseWorktreeOntoDefaultBranch", () => {
  beforeEach(() => {
    process.env.ZOMBIEBEN_RUNNER_DIR = TEST_DIR;
    fs.mkdirSync(
      path.join(TEST_DIR, "repos", "org--repo", "tasks", "wt-1", "repo"),
      { recursive: true },
    );
    execFileMock.mockReset();
  });

  afterEach(() => {
    delete process.env.ZOMBIEBEN_RUNNER_DIR;
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("uses coding agent for the full rebase flow when agent is provided", async () => {
    vi.spyOn(fs, "existsSync").mockImplementation((p) => {
      const s = String(p);
      if (s.includes(path.join("repos", "org--repo", "tasks", "wt-1", "repo"))) {
        return true;
      }
      if (s === "/tmp/rebase-merge") {
        return false;
      }
      if (s === "/tmp/rebase-apply") return false;
      return true;
    });

    execFileMock.mockImplementation((...all: unknown[]) => {
      const args = all[1] as string[];
      const cb = all[all.length - 1] as (
        err: Error | null,
        stdout?: string,
        stderr?: string,
      ) => void;
        if (args[0] === "rev-parse" && args[2] === "rebase-merge") {
          return cb(null, "/tmp/rebase-merge\n", "");
        }
        if (args[0] === "rev-parse" && args[2] === "rebase-apply") {
          return cb(null, "/tmp/rebase-apply\n", "");
        }
        return cb(null, "", "");
      });

    const spawn = vi.fn(() => ({
      done: Promise.resolve({ stdout: "resolved", stderr: "" }),
      kill: vi.fn(),
    }));
    const agent = { spawn } as unknown as CodingAgent;

    const { rebaseWorktreeOntoDefaultBranch } = await import("./repo-sync.js");
    await expect(
      rebaseWorktreeOntoDefaultBranch("org--repo", "wt-1", agent),
    ).resolves.toBeUndefined();

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(execFileMock).not.toHaveBeenCalledWith(
      "git",
      ["rebase", "origin/main"],
      expect.anything(),
      expect.any(Function),
    );
  });
});

describe("syncRepo", () => {
  beforeEach(() => {
    process.env.ZOMBIEBEN_RUNNER_DIR = TEST_DIR;
    fs.mkdirSync(
      path.join(TEST_DIR, "repos", "org--repo", "main_repo"),
      { recursive: true },
    );
    execFileMock.mockReset();
  });

  afterEach(() => {
    delete process.env.ZOMBIEBEN_RUNNER_DIR;
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("retries fetch on ref lock race and then resets to origin/main", async () => {
    let fetchCalls = 0;
    execFileMock.mockImplementation((...all: unknown[]) => {
      const args = all[1] as string[];
      const cb = all[all.length - 1] as (
        err: Error | null,
        stdout?: string,
        stderr?: string,
      ) => void;

      if (args[0] === "fetch") {
        fetchCalls += 1;
        if (fetchCalls === 1) {
          return cb(
            new Error(
              "error: cannot lock ref 'refs/remotes/origin/main': is at abc but expected def",
            ),
            "",
            "",
          );
        }
        return cb(null, "", "");
      }
      if (args[0] === "reset") {
        return cb(null, "", "");
      }
      return cb(null, "", "");
    });

    const { syncRepo } = await import("./repo-sync.js");
    await expect(syncRepo("org--repo")).resolves.toBeUndefined();
    expect(fetchCalls).toBe(2);
  });
});
