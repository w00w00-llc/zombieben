import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.fn();
const execFileSyncMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
  execFileSync: execFileSyncMock,
}));

const TEST_DIR = path.join(os.tmpdir(), "zombieben-worktree-test");

describe("createWorktree", () => {
  beforeEach(() => {
    process.env.ZOMBIEBEN_RUNNER_DIR = TEST_DIR;
    fs.mkdirSync(
      path.join(TEST_DIR, "repos", "acme--widgets", "main_repo"),
      { recursive: true },
    );
    execFileMock.mockReset();
    execFileSyncMock.mockReset();
  });

  afterEach(() => {
    delete process.env.ZOMBIEBEN_RUNNER_DIR;
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("writes configured repo env values into the worktree .env file", async () => {
    fs.writeFileSync(
      path.join(TEST_DIR, "repos", "acme--widgets", "repo-config.yml"),
      [
        "github_url: https://github.com/acme/widgets",
        "env:",
        "  API_URL: https://api.example.com",
        "  FEATURE_FLAG: enabled",
        "",
      ].join("\n"),
    );

    let envExistedDuringGitAdd = false;
    execFileMock.mockImplementation((...all: unknown[]) => {
      const args = all[1] as string[];
      const callback = all[all.length - 1] as (
        err: Error | null,
        stdout?: string,
        stderr?: string,
      ) => void;
      const dest = args[4];
      fs.mkdirSync(dest, { recursive: true });
      envExistedDuringGitAdd = fs.existsSync(path.join(dest, ".env"));
      fs.writeFileSync(
        path.join(dest, ".env"),
        "# existing\nFEATURE_FLAG=old\nUNCHANGED=value\n",
      );
      callback(null, "", "");
    });

    const { createWorktree } = await import("./worktree.js");
    const dest = await createWorktree("acme--widgets", "wt-1");

    expect(dest).toBe(
      path.join(TEST_DIR, "repos", "acme--widgets", "tasks", "wt-1", "repo"),
    );
    expect(envExistedDuringGitAdd).toBe(false);
    expect(fs.readFileSync(path.join(dest, ".env"), "utf-8")).toBe(
      "# existing\nFEATURE_FLAG=enabled\nUNCHANGED=value\n\nAPI_URL=https://api.example.com\n",
    );
  });

  it("creates a new .env file when repo-config env values exist", async () => {
    fs.writeFileSync(
      path.join(TEST_DIR, "repos", "acme--widgets", "repo-config.yml"),
      "env:\n  SECRET_TOKEN: abc123\n",
    );

    execFileMock.mockImplementation((...all: unknown[]) => {
      const args = all[1] as string[];
      const callback = all[all.length - 1] as (
        err: Error | null,
        stdout?: string,
        stderr?: string,
      ) => void;
      fs.mkdirSync(args[4], { recursive: true });
      callback(null, "", "");
    });

    const { createWorktree } = await import("./worktree.js");
    const dest = await createWorktree("acme--widgets", "wt-2");

    expect(fs.readFileSync(path.join(dest, ".env"), "utf-8")).toBe(
      "SECRET_TOKEN=abc123\n",
    );
  });
});
