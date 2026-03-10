import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  normalizeDefaultCodingAgent,
  readRunnerConfig,
  runnerConfigPath,
} from "./runner-config.js";

const TEST_DIR = path.join(os.tmpdir(), "zombieben-runner-config-test");

describe("runner-config", () => {
  beforeEach(() => {
    process.env.ZOMBIEBEN_RUNNER_DIR = TEST_DIR;
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    delete process.env.ZOMBIEBEN_RUNNER_DIR;
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("returns empty config when config.json does not exist", () => {
    expect(readRunnerConfig()).toEqual({});
  });

  it("reads config.json from the runner directory", () => {
    fs.writeFileSync(
      runnerConfigPath(),
      JSON.stringify({ default_coding_agent: "codex" }),
    );
    expect(readRunnerConfig()).toEqual({ default_coding_agent: "codex" });
  });

  it("returns empty config when config.json is invalid", () => {
    fs.writeFileSync(runnerConfigPath(), "{not json");
    expect(readRunnerConfig()).toEqual({});
  });

  it("normalizes valid agent names", () => {
    expect(normalizeDefaultCodingAgent("codex")).toBe("codex");
    expect(normalizeDefaultCodingAgent(" Claude ")).toBe("claude");
  });

  it("rejects unsupported agent names", () => {
    expect(normalizeDefaultCodingAgent("something-else")).toBeUndefined();
    expect(normalizeDefaultCodingAgent(123)).toBeUndefined();
  });
});
