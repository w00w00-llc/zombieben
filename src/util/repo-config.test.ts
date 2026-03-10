import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readRepoConfig, repoConfigPath } from "./repo-config.js";

const TEST_DIR = path.join(os.tmpdir(), "zombieben-repo-config-test");

describe("repo-config", () => {
  beforeEach(() => {
    process.env.ZOMBIEBEN_RUNNER_DIR = TEST_DIR;
    fs.mkdirSync(path.join(TEST_DIR, "repos", "acme--widgets"), {
      recursive: true,
    });
  });

  afterEach(() => {
    delete process.env.ZOMBIEBEN_RUNNER_DIR;
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("returns empty config when repo-config.yml does not exist", () => {
    expect(readRepoConfig("acme--widgets")).toEqual({});
  });

  it("reads github_url and env from repo-config.yml", () => {
    fs.writeFileSync(
      repoConfigPath("acme--widgets"),
      [
        "github_url: https://github.com/acme/widgets",
        "env:",
        "  API_URL: https://api.example.com",
        "  FEATURE_FLAG: true",
        "  EMPTY_VALUE:",
        "  bad-key: skipped",
        "  NESTED:",
        "    nope: skipped",
        "",
      ].join("\n"),
    );

    expect(readRepoConfig("acme--widgets")).toEqual({
      github_url: "https://github.com/acme/widgets",
      env: {
        API_URL: "https://api.example.com",
        FEATURE_FLAG: "true",
        EMPTY_VALUE: "",
      },
    });
  });

  it("returns empty config when repo-config.yml is invalid", () => {
    fs.writeFileSync(repoConfigPath("acme--widgets"), "env: [");
    expect(readRepoConfig("acme--widgets")).toEqual({});
  });
});
