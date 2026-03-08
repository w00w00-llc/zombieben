import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGithubPollChannel } from "./poll.js";

const TEST_DIR = path.join(os.tmpdir(), "zombieben-github-poll-test");

describe("createGithubPollChannel", () => {
  beforeEach(() => {
    process.env.ZOMBIEBEN_RUNNER_DIR = TEST_DIR;
    fs.mkdirSync(path.join(TEST_DIR, "repos"), { recursive: true });
  });

  afterEach(() => {
    delete process.env.ZOMBIEBEN_RUNNER_DIR;
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("is disabled when github pat is missing", () => {
    const repoDir = path.join(TEST_DIR, "repos", "w00w00-llc-ami");
    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(
      path.join(repoDir, "repo-config.yml"),
      "github_url: https://github.com/w00w00-llc/ami\n",
    );
    const channel = createGithubPollChannel();
    expect(channel.isEnabled()).toBe(false);
  });

  it("is enabled when github pat and repos are present", () => {
    fs.writeFileSync(
      path.join(TEST_DIR, "keys.json"),
      JSON.stringify({ github: { pat: "ghp_test" } }),
    );
    const repoDir = path.join(TEST_DIR, "repos", "w00w00-llc-ami");
    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(
      path.join(repoDir, "repo-config.yml"),
      "github_url: https://github.com/w00w00-llc/ami\n",
    );

    const channel = createGithubPollChannel();
    expect(channel.isEnabled()).toBe(true);
  });
});
